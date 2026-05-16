// @ts-check

/**
 * @fileoverview
 * 核心网格管理器 —— 2.5D 等轴方块场景的数据层与渲染层（P0.2）。
 *
 * 职责链：
 * 1. 接收 2D/3D 网格数据（字符串矩阵）
 * 2. 批量加载并等轴变换所有涉及到的方块纹理
 * 3. 为每个非空格创建 BlockSprite，挂载到 LayerStack 的正确图层
 * 4. 维护 gx,gy,gz → BlockSprite 的映射表，支持动态增删查
 * 5. 订阅 block:placed / block:removed 事件，响应外部变化
 *
 * 交互与调试职责委托给 BlockInteractionManager / BlockDebugManager。
 * 当这些管理器被设置到 `interactionManager` / `debugManager` 属性后，
 * `_createAndPlaceBlock` 会在新建方块时自动回调它们的 `_onBlockCreated` 方法。
 *
 * @module render/block/BlockGridManager
 */

import { BlockSprite, TILE_HALF_W, TILE_HALF_H, BLOCK_TEXTURE_MAP } from '../BlockSprite.mjs';
import { getSortKey } from '../SortManager.mjs';
import { EventBus } from '../../core/EventBus.mjs';
import { Logger } from '../../utils/Logger.mjs';
import { batchLoadAndTransform } from '../../loader/IsoTextureTransformer.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('BlockGridManager');

/** 图层索引常量：地面层 (gz=0) */
const LAYER_GROUND = 1;

/** 图层索引常量：建筑/结构层 (gz>=1) */
const LAYER_STRUCTURES = 2;

/**
 * BlockGridManager 配置（同旧 BlockRendererOptions）
 * @typedef {Object} BlockGridOptions
 * @property {boolean} [useIsoTransform=true]
 *     是否使用等轴纹理变换管道。
 * @property {boolean} [useAssembled=false]
 *     是否使用整块装配模式（单精灵替代三面独立 Sprite）。
 * @property {'nearest'|'bilinear'} [interpolation='nearest']
 *     纹理变换时的采样插值方式。
 * @property {function(number, string): void} [onProgress]
 *     进度回调：(percent, label) => void。
 * @property {Object<string, { top: string, left: string, right: string }>} [textureOverrides]
 *     纹理路径覆盖表。
 */

/**
 * 核心网格管理器
 *
 * 管理方块网格数据（_blockMap: Map<`gx,gy,gz`, BlockSprite>）、
 * 纹理缓存、等轴场景构建与动态增删。
 * 不持有交互/调试状态；这些由外部管理器通过回调注入。
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
     * gx,gy,gz → BlockSprite 的映射表。
     * key 格式: `${gx},${gy},${gz}`
     * @private @type {Map<string, import('../BlockSprite.mjs').BlockSprite>}
     */
    _blockMap;

    /**
     * 已缓存的等轴变换纹理数据。
     * key: blockType, value: { top, left, right, assembled? }
     * @private @type {Object<string, { top: ImageData, left: ImageData, right: ImageData, assembled?: ImageData }>|null}
     */
    _cachedTextures = null;

    /**
     * getColumnInfo() 的 LRU 缓存。
     * key: `${gx},${gy}`, value: Array<{gz, blockType}>
     * 防止连续悬停同一位置时的重复遍历。
     * @private @type {Map<string, Array<{gz: number, blockType: string}>>|null}
     */
    _columnCache = null;

    /** @private @type {number} LRU 缓存最大条目数 */
    _columnCacheMax = 128;

    /** @private @type {boolean} */
    _useIsoTransform;

    /** @private @type {boolean} */
    _useAssembled;

    /** @private @type {'nearest'|'bilinear'} */
    _interpolation;

    /** @private @type {Set<string>} 当前网格涉及的所有方块类型集合 */
    _blockTypes;

    /** @private @type {Array<() => void>} 事件解绑函数列表 */
    _unsubscribers;

    /**
     * 场景图管理器引用（可选，T11）。
     * @private @type {import('../SceneGraph.mjs').SceneGraph|null}
     */
    _sceneGraph;

    // ──────────────────────────────────────────────
    // 外部管理器引用（由 BlockRenderer 桥接层设置）
    // ──────────────────────────────────────────────

    /**
     * 交互管理器引用（由 BlockRenderer 设置）。
     * 当存在时，`_createAndPlaceBlock` 会在新建方块后调用
     * `this.interactionManager._onBlockCreated(block, gx, gy, gz)`。
     * @type {import('./BlockInteractionManager.mjs').BlockInteractionManager|null}
     */
    interactionManager = null;

    /**
     * 调试管理器引用（由 BlockRenderer 设置）。
     * 当存在时，`_createAndPlaceBlock` 会在新建方块后调用
     * `this.debugManager._onBlockCreated(block, gx, gy, gz)`。
     * @type {import('./BlockDebugManager.mjs').BlockDebugManager|null}
     */
    debugManager = null;

    /**
     * @param {import('../LayerStack.mjs').LayerStack} layerStack - 图层管理栈实例
     * @param {import('../../core/EventBus.mjs').EventBus} [eventBus] - 事件总线（默认使用单例）
     * @param {import('../SceneGraph.mjs').SceneGraph} [sceneGraph] - 场景图管理器（可选，T11 集成）
     */
    constructor(layerStack, eventBus, sceneGraph) {
        this._layerStack = layerStack;
        this._eventBus = eventBus || EventBus.getInstance();
        this._sceneGraph = sceneGraph || null;
        this._blockMap = new Map();
        this._blockTypes = new Set();
        this._unsubscribers = [];

        // 默认配置
        this._useIsoTransform = true;
        this._useAssembled = false;
        this._interpolation = 'nearest';

        // 订阅外部事件
        this._subscribeEvents();
    }

    // ==================== 公共构建 API ====================

    /**
     * 从网格数据批量构建 2.5D 方块场景。
     *
     * @param {Array<Array<string|null>>|Array<Array<Array<string|null>>>} gridData
     *     网格数据。2D: `gridData[y][x] = blockType | null`
     *     3D: `gridData[gz][y][x] = blockType | null`
     * @param {BlockGridOptions} [options={}] - 渲染配置
     * @returns {Promise<this>} 链式调用
     *
     * @example
     * ```javascript
     * await grid.buildFromGrid([['grass', 'stone'], ['dirt', null]]);
     * ```
     */
    async buildFromGrid(gridData, options = {}) {
        // 1. 合并配置
        this._useIsoTransform = options.useIsoTransform !== false;
        this._useAssembled = options.useAssembled === true;
        this._interpolation = options.interpolation || 'nearest';

        const progress = options.onProgress || (() => {});

        // 2. 解析网格维度
        const { grid, heightLayers } = this._normalizeGrid(gridData);
        const layerCount = heightLayers.length;
        const gridH = grid.length;
        const gridW = grid[0] ? grid[0].length : 0;

        if (gridH === 0 || gridW === 0) {
            log.warn('网格为空，跳过构建');
            return this;
        }

        log.info(`开始构建场景: ${gridW}×${gridH}×${layerCount} (W×H×Z)`);
        progress(0.0, '扫描方块类型...');

        // 3. 扫描所有需要的方块类型
        this._blockTypes.clear();
        for (const gz of heightLayers) {
            const layer = layerCount === 1 ? grid : gridData[gz];
            for (let gy = 0; gy < layer.length; gy++) {
                const row = layer[gy];
                for (let gx = 0; gx < row.length; gx++) {
                    const cell = row[gx];
                    if (cell !== null && cell !== undefined && cell !== '') {
                        this._blockTypes.add(cell);
                    }
                }
            }
        }

        const typeList = Array.from(this._blockTypes);
        log.info(`检测到方块类型: [${typeList.join(', ')}]`);

        // 4. 批量预加载并变换纹理（委托给公共方法 preloadTextures）
        if (this._useIsoTransform && typeList.length > 0) {
            progress(0.1, `加载纹理 (${typeList.length} 种)...`);
            await this.preloadTextures(typeList, {
                textureOverrides: options.textureOverrides
            });
        } else {
            this._cachedTextures = null;
        }

        progress(0.4, '构建方块...');

        // 5. 遍历网格创建方块
        let blockIndex = 0;
        const totalBlocks = this._countNonEmpty(grid, heightLayers, layerCount);

        for (let zi = 0; zi < heightLayers.length; zi++) {
            const gz = heightLayers[zi];
            const layer = layerCount === 1 ? grid : gridData[gz];

            for (let gy = 0; gy < layer.length; gy++) {
                const row = layer[gy];
                for (let gx = 0; gx < row.length; gx++) {
                    const cell = row[gx];
                    if (cell === null || cell === undefined || cell === '') continue;

                    await this._createAndPlaceBlock(gx, gy, gz, cell);

                    blockIndex++;
                    if (totalBlocks > 0 && blockIndex % 10 === 0) {
                        const pct = 0.4 + (blockIndex / totalBlocks) * 0.5;
                        progress(pct, `放置方块 ${blockIndex}/${totalBlocks}...`);
                    }
                }
            }
        }

        progress(0.9, '场景构建完成');
        log.info(`场景构建完成: ${this._blockMap.size} 个方块, ${typeList.length} 种类型`);

        return this;
    }

    /**
     * 预加载指定方块类型的等轴变换纹理到缓存。
     *
     * 调用此方法后，后续所有 `addBlock` / `_createAndPlaceBlock` 调用
     * 对于已预加载的类型将走**高效路径**（直接使用缓存的 ImageData），
     * 无需逐个加载图片和执行等轴变换。
     *
     * 该方法与 `buildFromGrid` 内部使用的纹理加载逻辑完全一致，
     * 包括纹理路径映射（`BLOCK_TEXTURE_MAP` + `textureOverrides`）、
     * 降级占位、插值模式等。
     *
     * ## 典型用法
     *
     * ```javascript
     * // 两阶段流程：先预加载，再逐块添加
     * await grid.preloadTextures(['grass', 'stone', 'dirt']);
     * for (const {wx, wy, wz, type} of blocks) {
     *     await grid.addBlock(wx, wy, wz, type); // 全走快速路径
     * }
     * ```
     *
     * @param {string[]} blockTypes - 需要预加载的方块类型标识数组
     * @param {Object} [options={}] - 预加载选项
     * @param {Object<string, { top: string, left: string, right: string }>} [options.textureOverrides]
     *     纹理路径覆盖表。当需要为某些类型使用非标准纹理文件时提供，
     *     覆盖 `BLOCK_TEXTURE_MAP` 中的默认路径。
     * @returns {Promise<this>} 链式调用
     */
    async preloadTextures(blockTypes, options = {}) {
        if (!this._useIsoTransform || blockTypes.length === 0) {
            this._cachedTextures = null;
            return this;
        }

        // 构建纹理映射（合并覆盖路径）
        const { BLOCK_TEXTURE_MAP: btm } = await import('../BlockSprite.mjs');
        /** @type {Object<string, { top: string, left: string, right: string }>} */
        const textureMap = {};
        for (const type of blockTypes) {
            if (options.textureOverrides && options.textureOverrides[type]) {
                textureMap[type] = options.textureOverrides[type];
            } else if (btm[type]) {
                textureMap[type] = btm[type];
            } else {
                log.warn(`方块类型 "${type}" 未注册贴图，使用占位纹理`);
                const fallback = btm[Object.keys(btm)[0]] || btm.grass;
                textureMap[type] = fallback;
            }
        }

        // 批量加载 + 等轴变换
        this._cachedTextures = await batchLoadAndTransform(textureMap, {
            interpolation: this._interpolation,
            fixEdges: false,
            includeAssembled: this._useAssembled
        });

        log.info(`纹理预加载完成: ${Object.keys(this._cachedTextures).length} 种`);
        return this;
    }

    // ==================== 动态操作 API ====================

    /**
     * 动态添加一个方块到场景中。
     *
     * 如果指定位置已有方块，先移除旧的，再添加新的（覆盖模式）。
     *
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标（高度层）
     * @param {string} blockType - 方块类型标识
     * @returns {Promise<import('../BlockSprite.mjs').BlockSprite|null>} 创建的 BlockSprite，失败返回 null
     *
     * @example
     * ```javascript
     * await grid.addBlock(5, 3, 0, 'stone');
     * ```
     */
    async addBlock(gx, gy, gz, blockType) {
        // 如果已有方块，先移除
        const existing = this._blockMap.get(`${gx},${gy},${gz}`);
        if (existing) {
            this._removeFromLayer(gx, gy, gz, existing);
        }

        const block = await this._createAndPlaceBlock(gx, gy, gz, blockType);
        this._clearColumnCache(gx, gy);
        return block;
    }

    /**
     * 从场景中移除指定位置的方块。
     *
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标（高度层）
     * @returns {boolean} 是否成功移除
     *
     * @example
     * ```javascript
     * grid.removeBlock(3, 2, 0);
     * ```
     */
    removeBlock(gx, gy, gz) {
        const key = `${gx},${gy},${gz}`;
        const block = this._blockMap.get(key);
        if (!block) return false;

        this._removeFromLayer(gx, gy, gz, block);
        this._clearColumnCache(gx, gy);
        return true;
    }

    // ==================== 列信息查询 ====================

    /**
     * 获取指定 (gx, gy) 位置的所有高度层方块信息。
     *
     * 遍历 _blockMap，匹配 `${gx},${gy},` 前缀的键，返回按 gz 升序排列的数组。
     * 结果由 LRU 缓存加速，避免连续悬停同一位置时的重复遍历。
     *
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @returns {Array<{gz: number, blockType: string}>}
     *     按 gz 升序的列方块信息数组，若无方块则返回空数组
     *
     * @example
     * ```javascript
     * const col = grid.getColumnInfo(3, 2);
     * // col = [{gz: 0, blockType: 'grass'}, {gz: 1, blockType: 'stone'}]
     * ```
     */
    getColumnInfo(gx, gy) {
        const cacheKey = `${gx},${gy}`;

        // ── LRU 缓存命中 ──
        if (this._columnCache && this._columnCache.has(cacheKey)) {
            const val = this._columnCache.get(cacheKey);
            // 重新插入以刷新 LRU 顺序
            this._columnCache.delete(cacheKey);
            this._columnCache.set(cacheKey, val);
            return val;
        }

        // ── 遍历 _blockMap ──
        const prefix = `${gx},${gy},`;
        /** @type {Array<{gz: number, blockType: string}>} */
        const results = [];
        for (const [mapKey, block] of this._blockMap) {
            if (mapKey.startsWith(prefix)) {
                const gz = parseInt(mapKey.split(',')[2], 10);
                results.push({ gz, blockType: block.blockType });
            }
        }

        // 按 gz 升序排列
        results.sort((a, b) => a.gz - b.gz);

        // ── 写入 LRU 缓存 ──
        if (!this._columnCache) {
            this._columnCache = new Map();
        }
        this._columnCache.set(cacheKey, results);
        if (this._columnCache.size > this._columnCacheMax) {
            // 移除最久未使用的条目（Map 的第一个 key）
            const firstKey = this._columnCache.keys().next().value;
            if (firstKey !== undefined) this._columnCache.delete(firstKey);
        }

        return results;
    }

    /**
     * 清除指定 (gx, gy) 的列缓存。
     * 在方块增删后调用，保证下次查询结果准确。
     *
     * @private
     * @param {number} gx
     * @param {number} gy
     */
    _clearColumnCache(gx, gy) {
        if (this._columnCache) {
            this._columnCache.delete(`${gx},${gy}`);
        }
    }

    /**
     * 检查指定位置是否有方块。
     *
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标（高度层）
     * @returns {boolean}
     */
    hasBlock(gx, gy, gz) {
        return this._blockMap.has(`${gx},${gy},${gz}`);
    }

    /**
     * 获取指定位置的 BlockSprite 引用。
     *
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标（高度层）
     * @returns {import('../BlockSprite.mjs').BlockSprite|undefined}
     */
    getBlock(gx, gy, gz) {
        return this._blockMap.get(`${gx},${gy},${gz}`);
    }

    /**
     * 清空所有方块，释放资源。
     *
     * 当 this._sceneGraph 存在时，走 SceneGraph.clear() 路径，
     * 否则遍历映射表手动从图层移除并销毁每个 BlockSprite。
     * 无论哪种路径，都保留纹理缓存（场景切换时可能复用）。
     */
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

    /**
     * 强制清除纹理缓存。
     * 通常在场景切换且新旧场景的方块类型完全不同时调用。
     */
    clearTextureCache() {
        this._cachedTextures = null;
    }

    /**
     * 批量控制所有方块的可见性与交互性。
     *
     * @param {boolean} visible - true 显示所有方块，false 隐藏所有方块
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * grid.setBlocksVisible(false);
     * ```
     */
    setBlocksVisible(visible) {
        for (const [, block] of this._blockMap) {
            block.visible = visible;
            block.eventMode = visible ? 'auto' : 'none';
        }
        log.info(`所有方块已${visible ? '显示' : '隐藏'} (${this._blockMap.size} 个)`);
        return this;
    }

    /**
     * 销毁 BlockGridManager，释放所有资源。
     *
     * 清理顺序：
     * 1. 取消事件订阅
     * 2. 清空场景
     * 3. 释放缓存与引用
     *
     * 注：不处理 interactionManager / debugManager 的销毁，
     * 由外层 BlockRenderer.destroy() 统一协调。
     */
    destroy() {
        // 1. 取消事件订阅
        for (const unsub of this._unsubscribers) {
            try { unsub(); } catch (_) { /* 忽略解绑错误 */ }
        }
        this._unsubscribers = [];

        // 2. 清空场景
        this.clear();

        // 3. 释放缓存与引用
        this._cachedTextures = null;
        this._layerStack = null;
        this._eventBus = null;
        this._sceneGraph = null;
        this.interactionManager = null;
        this.debugManager = null;
    }

    // ==================== 访问器 ====================

    /**
     * 当前方块数量。
     * @returns {number}
     */
    get blockCount() {
        return this._blockMap.size;
    }

    /**
     * 当前涉及的方块类型列表。
     * @returns {string[]}
     */
    get blockTypes() {
        return Array.from(this._blockTypes);
    }

    // ==================== 内部方法 ====================

    /**
     * 创建并放置单个方块。
     *
     * @private
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标
     * @param {string} blockType - 方块类型
     * @returns {Promise<import('../BlockSprite.mjs').BlockSprite|null>}
     */
    async _createAndPlaceBlock(gx, gy, gz, blockType) {
        try {
            const key = `${gx},${gy},${gz}`;

            // 如果已有方块，跳过（不覆盖）
            if (this._blockMap.has(key)) {
                log.warn(`位置 (${gx},${gy},${gz}) 已有方块，跳过`);
                return null;
            }

            // 创建 BlockSprite
            let block;
            if (this._useIsoTransform && this._cachedTextures && this._cachedTextures[blockType]) {
                // 使用缓存的等轴变换纹理（高效路径）
                block = new BlockSprite({
                    blockType,
                    useIsoTransform: true
                });
                const cached = this._cachedTextures[blockType];
                if (this._useAssembled && cached.assembled) {
                    block.setAssembledTexture(cached.assembled);
                } else {
                    block.setIsoFaces(cached.top, cached.left, cached.right);
                }
            } else {
                // 实时加载路径（兜底）
                block = await BlockSprite.createWithIsoTransform({
                    blockType,
                    useAssembled: this._useAssembled,
                    useIsoTransform: this._useIsoTransform
                });
            }

            // 设置坐标
            block.setGridPosition(gx, gy, gz);

            // 添加到正确图层 —— 走 SceneGraph 或直接 LayerStack
            const layerIndex = this._determineLayer(gz);
            if (this._sceneGraph) {
                const sortKey = getSortKey(gx, gy, gz);
                const nodeId = this._sceneGraph.add(layerIndex, block, { sortKey });
                /** @type {number|undefined} */ (block._sceneNodeId) = nodeId;
            } else {
                this._layerStack.addToLayer(layerIndex, block);
            }

            // 记录映射
            this._blockMap.set(key, block);

            // ── 回调外部管理器 ──
            if (this.interactionManager) {
                this.interactionManager._onBlockCreated(block, gx, gy, gz);
            }
            if (this.debugManager) {
                this.debugManager._onBlockCreated(block);
            }

            log.debug(`放置方块: ${blockType} @ (${gx},${gy},${gz}) → Layer ${layerIndex}`);
            return block;

        } catch (err) {
            log.error(`创建方块失败: ${blockType} @ (${gx},${gy},${gz}):`, err);
            return null;
        }
    }

    /**
     * 从图层中移除并销毁方块。
     *
     * @private
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标
     * @param {import('../BlockSprite.mjs').BlockSprite} block - 要移除的 BlockSprite
     */
    _removeFromLayer(gx, gy, gz, block) {
        const key = `${gx},${gy},${gz}`;

        if (this._sceneGraph) {
            const nodeId = /** @type {number|undefined} */ (block._sceneNodeId);
            if (nodeId) {
                this._sceneGraph.remove(nodeId);
            }
        } else {
            const layerIndex = this._determineLayer(gz);
            try {
                this._layerStack.removeFromLayer(layerIndex, block);
                block.destroy({ children: true });
            } catch (err) {
                log.warn(`移除方块 ${key} 时出错:`, err);
            }
        }

        this._blockMap.delete(key);
        log.debug(`移除方块 @ (${gx},${gy},${gz})`);
    }

    /**
     * 根据高度层确定所属图层索引。
     *
     * @private
     * @param {number} gz - 网格 Z 坐标（高度层）
     * @returns {number} 图层索引
     */
    _determineLayer(gz) {
        return gz === 0 ? LAYER_GROUND : LAYER_STRUCTURES;
    }

    /**
     * 标准化网格数据格式。
     *
     * @private
     * @param {Array|Array<Array>} gridData - 原始网格数据
     * @returns {{ grid: Array<Array<string|null>>, heightLayers: number[] }}
     */
    _normalizeGrid(gridData) {
        const is3D = Array.isArray(gridData) &&
                     gridData.length > 0 &&
                     Array.isArray(gridData[0]) &&
                     gridData[0].length > 0 &&
                     Array.isArray(gridData[0][0]);

        if (is3D) {
            const heightLayers = [];
            for (let gz = 0; gz < gridData.length; gz++) {
                if (gridData[gz] && gridData[gz].length > 0) {
                    heightLayers.push(gz);
                }
            }
            return {
                grid: gridData[0],
                heightLayers
            };
        }

        return {
            grid: gridData,
            heightLayers: [0]
        };
    }

    /**
     * 统计网格中非空格的数量（用于进度计算）。
     *
     * @private
     * @param {Array<Array<string|null>>} grid - 2D 网格
     * @param {number[]} heightLayers - 高度层索引
     * @param {number} layerCount - 层数
     * @returns {number}
     */
    _countNonEmpty(grid, heightLayers, layerCount) {
        let count = 0;
        for (const gz of heightLayers) {
            const layer = layerCount === 1 ? grid : grid[gz];
            if (!layer) continue;
            for (const row of layer) {
                for (const cell of row) {
                    if (cell !== null && cell !== undefined && cell !== '') {
                        count++;
                    }
                }
            }
        }
        return count;
    }

    /**
     * 订阅 block:placed 和 block:removed 事件。
     *
     * @private
     */
    _subscribeEvents() {
        const bus = this._eventBus;

        const onPlaced = (/** @type {{ gx: number, gy: number, gz: number, blockType: string }} */ data) => {
            if (data && typeof data.gx === 'number' && typeof data.gy === 'number' && data.blockType) {
                const gz = data.gz || 0;
                this.addBlock(data.gx, data.gy, gz, data.blockType).catch(err => {
                    log.error(`事件 block:placed 响应失败:`, err);
                });
            }
        };

        const onRemoved = (/** @type {{ gx: number, gy: number, gz: number }} */ data) => {
            if (data && typeof data.gx === 'number' && typeof data.gy === 'number') {
                const gz = data.gz || 0;
                this.removeBlock(data.gx, data.gy, gz);
            }
        };

        this._unsubscribers.push(bus.on('block:placed', onPlaced, this));
        this._unsubscribers.push(bus.on('block:removed', onRemoved, this));
    }
}
