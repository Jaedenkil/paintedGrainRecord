// @ts-check

/**
 * @fileoverview
 * 核心网格管理器 —— 2.5D 等轴方块场景的数据层与渲染层（P0.2）。
 *
 * 架构（三分拆分）：
 * ```
 * BlockGridManager (数据核心 + 公共 API)
 *   ├── has-a BlockGridOperator (批量构建+纹理预加载+方块创建)
 *   └── has-a BlockGridEventBinder (事件订阅)
 * ```
 *
 * 对外部管理器可见的字段（BlockInteractionManager / BlockDebugManager 直接访问）：
 * _blockMap, _blockTypes, _layerStack
 *
 * @module render/block/BlockGridManager
 */

import { EventBus } from '../../core/EventBus.mjs';
import { Logger } from '../../utils/Logger.mjs';
import { BlockGridOperator } from './BlockGridOperator.mjs';
import { subscribeEvents } from './BlockGridEventBinder.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('BlockGridManager');

import { FrustumCuller } from './FrustumCuller.mjs';

/** 地面层索引 (gz=0) */
const LAYER_GROUND = 1;
/** 结构层索引 (gz>=1) */
const LAYER_STRUCTURES = 2;

/**
 * @typedef {Object} BlockGridOptions
 * @property {boolean} [useIsoTransform=true]
 * @property {boolean} [useAssembled=false]
 * @property {'nearest'|'bilinear'} [interpolation='nearest']
 * @property {function(number, string): void} [onProgress]
 * @property {Object<string, {top: string, left: string, right: string}>} [textureOverrides]
 */

/**
 * 核心网格管理器。
 *
 * @example
 * ```javascript
 * const grid = new BlockGridManager(layerStack);
 * await grid.buildFromGrid([['grass', 'grass'], ['grass', 'stone']]);
 * grid.addBlock(5, 3, 0, 'dirt');
 * grid.removeBlock(0, 0, 0);
 * grid.clear();
 * ```
 */
export class BlockGridManager {
    /** @private @type {import('../LayerStack.mjs').LayerStack|null} */
    _layerStack;
    /** @private @type {import('../../core/EventBus.mjs').EventBus|null} */
    _eventBus;
    /**
     * `gx,gy,gz` → BlockSprite 映射表。
     * @private @type {Map<string, import('../../render/BlockSprite.mjs').BlockSprite>}
     */
    _blockMap;
    /**
     * 等轴变换纹理缓存。key: blockType。
     * @private @type {Object<string, {top: ImageData, left: ImageData, right: ImageData, assembled?: ImageData}>|null}
     */
    _cachedTextures = null;
    /**
     * getColumnInfo() 的 LRU 缓存。
     * @private @type {Map<string, Array<{gz: number, blockType: string}>>|null}
     */
    _columnCache = null;
    /** @private @type {number} */
    _columnCacheMax = 128;
    /** @private @type {boolean} */
    _useIsoTransform;
    /** @private @type {boolean} */
    _useAssembled;
    /** @private @type {'nearest'|'bilinear'} */
    _interpolation;
    /** @private @type {Set<string>} */
    _blockTypes;
    /** @private @type {import('../SceneGraph.mjs').SceneGraph|null} */
    _sceneGraph;
    /** @private @type {BlockGridOperator|null} */
    _operator;
    /** @private @type {Array<() => void>} */
    _unsubscribers;

    /**
     * 当前裁剪范围快照（null = 全部可见）。
     * @private @type {import('./FrustumCuller.mjs').VisibleGridBounds|null}
     */
    _culledBounds = null;

    /** @type {import('./BlockInteractionManager.mjs').BlockInteractionManager|null} */
    interactionManager = null;
    /** @type {import('./BlockDebugManager.mjs').BlockDebugManager|null} */
    debugManager = null;

    /**
     * @param {import('../LayerStack.mjs').LayerStack} layerStack
     * @param {import('../../core/EventBus.mjs').EventBus} [eventBus]
     * @param {import('../SceneGraph.mjs').SceneGraph} [sceneGraph]
     */
    constructor(layerStack, eventBus, sceneGraph) {
        this._layerStack = layerStack;
        this._eventBus = eventBus || EventBus.getInstance();
        this._sceneGraph = sceneGraph || null;
        this._blockMap = new Map();
        this._blockTypes = new Set();
        this._useIsoTransform = true;
        this._useAssembled = false;
        this._interpolation = 'nearest';
        this._operator = new BlockGridOperator(this);
        this._unsubscribers = subscribeEvents(this, this._eventBus);
    }

    // ==================== 构建 API（委托） ====================

    /**
     * 从网格数据批量构建 2.5D 方块场景。
     * @param {Array<Array<string|null>>|Array<Array<Array<string|null>>>>} gridData
     * @param {BlockGridOptions} [options={}]
     * @returns {Promise<this>}
     */
    async buildFromGrid(gridData, options = {}) {
        return this._operator.buildFromGrid(gridData, options);
    }

    /**
     * 预加载方块类型的等轴变换纹理到缓存。
     * @param {string[]} blockTypes
     * @param {Object} [options={}]
     * @param {Object<string, {top: string, left: string, right: string}>} [options.textureOverrides]
     * @returns {Promise<this>}
     */
    async preloadTextures(blockTypes, options = {}) {
        return this._operator.preloadTextures(blockTypes, options);
    }

    // ==================== 动态操作 ====================

    /**
     * 添加一个方块（覆盖模式：若已有则先移除）。
     * @param {number} gx
     * @param {number} gy
     * @param {number} gz
     * @param {string} blockType
     * @returns {Promise<import('../../render/BlockSprite.mjs').BlockSprite|null>}
     */
    async addBlock(gx, gy, gz, blockType) {
        const existing = this._blockMap.get(`${gx},${gy},${gz}`);
        if (existing) this._operator._removeFromLayer(gx, gy, gz, existing);
        const block = await this._operator._createAndPlaceBlock(gx, gy, gz, blockType);
        this._clearColumnCache(gx, gy);
        return block;
    }

    /**
     * 移除指定位置的方块。
     * @param {number} gx
     * @param {number} gy
     * @param {number} gz
     * @returns {boolean}
     */
    removeBlock(gx, gy, gz) {
        const key = `${gx},${gy},${gz}`;
        const block = this._blockMap.get(key);
        if (!block) return false;
        this._operator._removeFromLayer(gx, gy, gz, block);
        this._clearColumnCache(gx, gy);
        return true;
    }

    // ==================== 列查询 ====================

    /**
     * 获取 (gx,gy) 位置所有高度层的方块信息（LRU 缓存加速）。
     * @param {number} gx
     * @param {number} gy
     * @returns {Array<{gz: number, blockType: string}>}
     */
    getColumnInfo(gx, gy) {
        const cacheKey = `${gx},${gy}`;
        if (this._columnCache && this._columnCache.has(cacheKey)) {
            const val = this._columnCache.get(cacheKey);
            this._columnCache.delete(cacheKey);
            this._columnCache.set(cacheKey, val);
            return val;
        }
        const prefix = `${gx},${gy},`;
        const results = [];
        for (const [mapKey, block] of this._blockMap) {
            if (mapKey.startsWith(prefix)) {
                results.push({ gz: parseInt(mapKey.split(',')[2], 10), blockType: block.blockType });
            }
        }
        results.sort((a, b) => a.gz - b.gz);
        if (!this._columnCache) this._columnCache = new Map();
        this._columnCache.set(cacheKey, results);
        if (this._columnCache.size > this._columnCacheMax) {
            const firstKey = this._columnCache.keys().next().value;
            if (firstKey !== undefined) this._columnCache.delete(firstKey);
        }
        return results;
    }

    /** @private */
    _clearColumnCache(gx, gy) {
        if (this._columnCache) this._columnCache.delete(`${gx},${gy}`);
    }

    /** @param {number} gx @param {number} gy @param {number} gz @returns {boolean} */
    hasBlock(gx, gy, gz) {
        return this._blockMap.has(`${gx},${gy},${gz}`);
    }

    /** @param {number} gx @param {number} gy @param {number} gz @returns {import('../../render/BlockSprite.mjs').BlockSprite|undefined} */
    getBlock(gx, gy, gz) {
        return this._blockMap.get(`${gx},${gy},${gz}`);
    }

    // ==================== 生命周期 ====================

    /** 清空所有方块，保留纹理缓存。 */
    clear() {
        log.info(`清空场景: ${this._blockMap.size} 个方块`);
        if (this._sceneGraph) {
            this._sceneGraph.clear();
        } else {
            for (const [key, block] of this._blockMap) {
                const layerIndex = this._determineLayer(block.gridZ);
                try {
                    this._layerStack.removeFromLayer(layerIndex, block);
                    block.destroy({ children: true });
                } catch (err) {
                    log.warn(`销毁方块 ${key} 时出错:`, err);
                }
            }
        }
        this._blockMap.clear();
        this._columnCache = null;
    }

    /** 强制清除纹理缓存。 */
    clearTextureCache() { this._cachedTextures = null; }

    /**
     * 批量控制所有方块的可见性。
     * @param {boolean} visible
     * @returns {this}
     */
    setBlocksVisible(visible) {
        for (const [, block] of this._blockMap) {
            block.visible = visible;
            block.eventMode = visible ? 'auto' : 'none';
        }
        this._culledBounds = null; // 全部可见 → 清除裁剪状态
        log.info(`所有方块已${visible ? '显示' : '隐藏'} (${this._blockMap.size} 个)`);
        return this;
    }

    /**
     * 视锥体裁剪：仅显示相机视口内的方块。
     *
     * 使用 FrustumCuller 计算当前相机的可见网格范围，
     * 然后遍历 _blockMap，范围内的方块设为可见，范围外的隐藏。
     *
     * **增量优化**（P4.2）：
     * - 首次裁剪（`_culledBounds === null`）→ 全量遍历
     * - 后续增量裁剪 → 通过 `getDeltaRegions()` 计算新旧可见范围的差值区域，
     *   构建坐标集合，单遍遍历 _blockMap 但只对可见性变化的块执行属性赋值，
     *   **跳过重叠区域中可见性不变的块**（约 80%~90%）。
     *
     * @param {import('./FrustumCuller.mjs').CameraSnapshot} camera - 相机快照
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * // 每帧或相机移动后调用
     * gridManager.cull({ x: 0, y: 0, zoom: 1, viewWidth: 960, viewHeight: 540 });
     * ```
     */
    cull(camera) {
        const bounds = FrustumCuller.getVisibleGridBounds(camera);

        // 防抖：若范围未变化则跳过
        if (FrustumCuller.boundsEqual(this._culledBounds, bounds)) {
            return this;
        }

        const oldBounds = this._culledBounds;
        this._culledBounds = bounds;

        if (oldBounds === null) {
            // 首次裁剪：全量遍历
            this._fullCull(bounds);
        } else {
            // 增量裁剪：只处理可见性变化的边界区域
            this._incrementalCull(oldBounds, bounds);
        }

        return this;
    }

    /**
     * **首次全量遍历**（_culledBounds === null 时调用）。
     * @private
     * @param {import('./FrustumCuller.mjs').VisibleGridBounds} bounds
     */
    _fullCull(bounds) {
        let visibleCount = 0;
        let hiddenCount = 0;

        for (const [key, block] of this._blockMap) {
            // 优化：用 indexOf + substring 代替 split，避免数组分配
            const comma1 = key.indexOf(',');
            const comma2 = key.indexOf(',', comma1 + 1);
            const gx = parseInt(key.substring(0, comma1), 10);
            const gy = parseInt(key.substring(comma1 + 1, comma2), 10);

            const inBounds = FrustumCuller.isInBounds(gx, gy, bounds);
            block.visible = inBounds;
            block.eventMode = inBounds ? 'auto' : 'none';

            if (inBounds) {
                visibleCount++;
            } else {
                hiddenCount++;
            }
        }

        log.debug(`首次裁剪完成: 可见 ${visibleCount} / 隐藏 ${hiddenCount} 个方块`);
    }

    /**
     * **增量裁剪**：只处理新旧可见范围差值区域中的块。
     *
     * 流程：
     * 1. 调用 `FrustumCuller.getDeltaRegions()` 获取差值矩形列表
     * 2. 构建 `Set<"gx,gy">` 坐标集合（O(1) 查找）
     * 3. 单遍遍历 `_blockMap`，用 `Set.has()` 快速跳过不变块
     *
     * @private
     * @param {import('./FrustumCuller.mjs').VisibleGridBounds} oldBounds
     * @param {import('./FrustumCuller.mjs').VisibleGridBounds} bounds
     */
    _incrementalCull(oldBounds, bounds) {
        const { newlyVisible, newlyHidden } = FrustumCuller.getDeltaRegions(oldBounds, bounds);

        // 构建增量坐标集合
        /** @type {Set<string>} */
        const deltaSet = new Set();
        for (const rect of newlyVisible) {
            for (let gy = rect.minY; gy <= rect.maxY; gy++) {
                for (let gx = rect.minX; gx <= rect.maxX; gx++) {
                    deltaSet.add(`${gx},${gy}`);
                }
            }
        }
        for (const rect of newlyHidden) {
            for (let gy = rect.minY; gy <= rect.maxY; gy++) {
                for (let gx = rect.minX; gx <= rect.maxX; gx++) {
                    deltaSet.add(`${gx},${gy}`);
                }
            }
        }

        let visCount = 0;
        let hidCount = 0;

        for (const [key, block] of this._blockMap) {
            // 从 key "gx,gy,gz" 中提取 "gx,gy" 坐标前缀
            const comma1 = key.indexOf(',');
            const comma2 = key.indexOf(',', comma1 + 1);
            const coordKey = key.substring(0, comma2); // "gx,gy"

            // 快速跳过可见性未变化的块
            if (!deltaSet.has(coordKey)) continue;

            // 只有 delta 区域的块需要更新
            const gx = parseInt(key.substring(0, comma1), 10);
            const gy = parseInt(key.substring(comma1 + 1, comma2), 10);
            const inBounds = FrustumCuller.isInBounds(gx, gy, bounds);

            block.visible = inBounds;
            block.eventMode = inBounds ? 'auto' : 'none';

            if (inBounds) {
                visCount++;
            } else {
                hidCount++;
            }
        }

        log.debug(`增量裁剪完成: 坐标集 ${deltaSet.size} 个，影响可见 ${visCount} / 隐藏 ${hidCount} 个方块`);
    }

    // ==================== 可见性查询 ====================

    /**
     * 获取当前可见方块数量（受裁剪影响）。
     * @returns {number}
     */
    get visibleBlockCount() {
        let count = 0;
        for (const [, block] of this._blockMap) {
            if (block.visible) count++;
        }
        return count;
    }

    /**
     * 销毁管理器，释放所有资源。
     * 注：不处理 interactionManager / debugManager，由 BlockRenderer 协调。
     */
    destroy() {
        for (const unsub of this._unsubscribers) {
            try { unsub(); } catch (_) {}
        }
        this._unsubscribers = [];
        this.clear();
        this._cachedTextures = null;
        this._operator = null;
        this._layerStack = null;
        this._eventBus = null;
        this._sceneGraph = null;
        this.interactionManager = null;
        this.debugManager = null;
    }

    // ==================== 访问器 ====================

    /** @returns {number} */
    get blockCount() { return this._blockMap.size; }

    /** @returns {string[]} */
    get blockTypes() { return Array.from(this._blockTypes); }

    // ==================== 内部 ====================

    /**
     * 根据高度层确定图层索引。
     * @private @param {number} gz @returns {number}
     */
    _determineLayer(gz) {
        return gz === 0 ? LAYER_GROUND : LAYER_STRUCTURES;
    }
}
