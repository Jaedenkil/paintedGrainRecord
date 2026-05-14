// @ts-check

/**
 * @fileoverview
 * 方块渲染器 — 网格数据到 2.5D 等轴场景的批量桥接器（T12）。
 *
 * 职责链：
 * 1. 接收 2D/3D 网格数据（字符串矩阵）
 * 2. 批量加载并等轴变换所有涉及到的方块纹理
 * 3. 为每个非空格创建 BlockSprite，挂载到 LayerStack 的正确图层
 * 4. 维护 gx,gy,gz → BlockSprite 的映射表，支持动态增删查
 * 5. 订阅 block:placed / block:removed 事件，响应外部变化
 *
 * 网格数据格式约定：
 * ```
 * // 2D 平面网格（所有方块在 gz=0 地面层）
 * const flatGrid = [
 *   ['grass', 'grass',  null ],
 *   ['grass', 'stone',  'dirt'],
 *   [ null,   'dirt',   'dirt']
 * ];
 *
 * // 3D 分层网格（支持多高度层）
 * const layeredGrid = [
 *   // gz=0（地面层）
 *   [['grass', 'grass'], ['grass', 'dirt']],
 *   // gz=1（第一层建筑）
 *   [[null, 'stone'],    [null,   null ]]
 * ];
 * ```
 *
 * 图层分流规则：
 * - gz === 0 → Layer 1 (Ground)
 * - gz >= 1 → Layer 2 (Structures)
 *
 * @module render/BlockRenderer
 */

import { BlockSprite, Z_BASE, TILE_HALF_W, TILE_HALF_H, BLOCK_TEXTURE_MAP } from './BlockSprite.mjs';
import { getSortKey } from './SortManager.mjs';
import { EventBus } from '../core/EventBus.mjs';
import { Logger } from '../utils/Logger.mjs';
import { batchLoadAndTransform } from '../loader/IsoTextureTransformer.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('BlockRenderer');

/** 图层索引常量：地面层 (gz=0) */
const LAYER_GROUND = 1;

/** 图层索引常量：建筑/结构层 (gz>=1) */
const LAYER_STRUCTURES = 2;

/** 无效单元格标记（网格中为 null 或 undefined 的格子在渲染时跳过） */

/**
 * BlockRenderer 配置
 * @typedef {Object} BlockRendererOptions
 * @property {boolean} [useIsoTransform=true]
 *     是否使用等轴纹理变换管道。
 *     开启后，16×16 源纹理经过旋转/剪切/压缩变换为等轴透视纹理。
 *     关闭后，纹理以原始正方形 1:1 显示（调试用）。
 * @property {boolean} [useAssembled=false]
 *     是否使用整块装配模式（单精灵替代三面独立 Sprite）。
 *     开启后减少子对象数量，但对纹理 UV 映射要求更高。
 * @property {'nearest'|'bilinear'} [interpolation='nearest']
 *     纹理变换时的采样插值方式。像素风格应保持 'nearest'。
 * @property {function(number, string): void} [onProgress]
 *     进度回调：(percent, label) => void，用于加载画面更新。
 * @property {Object<string, { top: string, left: string, right: string }>} [textureOverrides]
 *     纹理路径覆盖表，key 为方块类型名，value 为三面路径。
 *     可用于临时替换某类方块的贴图而不修改 BLOCK_TEXTURE_MAP。
 */

/**
 * 方块渲染器
 *
 * @example
 * ```javascript
 * import { BlockRenderer } from './BlockRenderer.mjs';
 *
 * const renderer = new BlockRenderer(renderSystem.layerStack);
 *
 * // 2D 网格
 * const grid = [
 *   ['grass', 'grass', 'grass'],
 *   ['grass', null,    'grass'],
 *   ['grass', 'grass', 'grass']
 * ];
 * await renderer.buildFromGrid(grid);
 * // 9 个草地块在屏幕中显示为 3×3 等轴菱形排列
 *
 * // 动态添加/移除
 * renderer.addBlock(1, 1, 0, 'stone');
 * renderer.removeBlock(0, 0, 0);
 *
 * // 清空场景
 * renderer.clear();
 * ```
 */
export class BlockRenderer {
    /** @private @type {import('./LayerStack.mjs').LayerStack|null} */
    _layerStack;

    /** @private @type {import('../core/EventBus.mjs').EventBus|null} */
    _eventBus;

    /**
     * gx,gy,gz → BlockSprite 的映射表。
     * key 格式: `${gx},${gy},${gz}`
     * @private @type {Map<string, BlockSprite>}
     */
    _blockMap;

    /**
     * 已缓存的等轴变换纹理数据。
     * key: blockType, value: { top, left, right, assembled? }
     * @private @type {Object<string, { top: ImageData, left: ImageData, right: ImageData, assembled?: ImageData }>|null}
     */
    _cachedTextures = null;

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

    /** @private @type {import('./IsoGridOverlay.mjs').IsoGridOverlay|null} 菱形网格覆盖层引用（用于 hover 高亮） */
    _gridOverlay;

    /** @private @type {boolean} 网格点击交互是否已启用（由 bindGridClick 设置） */
    _gridClickEnabled = false;

    /** @private @type {Function|null} rootContainer 上的 pointerdown 处理器引用（用于解绑） */
    _gridClickHandler = null;

    /** @private @type {boolean} 方块调试日志是否已启用（由 enableBlockDebug 设置） */
    _blockDebugEnabled = false;

    /**
     * 场景图管理器引用（可选，T11）。
     * 当注入 SceneGraph 时，方块的 add/remove/clear 走场景图管理层，
     * 自动获得 ID 追踪、事件发射和 SortManager 脏标记。
     * @private @type {import('./SceneGraph.mjs').SceneGraph|null}
     */
    _sceneGraph;

    /**
     * @param {import('./LayerStack.mjs').LayerStack} layerStack - 图层管理栈实例
     * @param {import('../core/EventBus.mjs').EventBus} [eventBus] - 事件总线（默认使用单例）
     * @param {import('./SceneGraph.mjs').SceneGraph} [sceneGraph] - 场景图管理器（可选，T11 集成）
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
     * 流程：
     * 1. 扫描网格收集所有需要的方块类型
     * 2. 批量加载并等轴变换纹理
     * 3. 遍历网格为每个非空格创建 BlockSprite
     * 4. 按高度层分流到 Layer 1 / Layer 2
     *
     * @param {Array<Array<string|null>>|Array<Array<Array<string|null>>>} gridData
     *     网格数据。
     *     2D: `gridData[y][x] = blockType | null`
     *     3D: `gridData[gz][y][x] = blockType | null`
     * @param {BlockRendererOptions} [options={}] - 渲染配置
     * @returns {Promise<this>} 链式调用
     *
     * @example
     * ```javascript
     * // 2D 网格
     * await renderer.buildFromGrid([
     *   ['grass', 'grass'],
     *   ['grass', 'stone']
     * ]);
     *
     * // 3D 网格（带高度层）
     * await renderer.buildFromGrid([
     *   [['grass', 'grass'], ['grass', 'dirt']],  // gz=0
     *   [[null, 'stone'],    [null,    null  ]]   // gz=1
     * ]);
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
        for (let gz of heightLayers) {
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

        // 4. 批量预加载并变换纹理
        if (this._useIsoTransform && typeList.length > 0) {
            progress(0.1, `加载纹理 (${typeList.length} 种)...`);

            // 构建纹理映射（合并覆盖路径）
            const { BLOCK_TEXTURE_MAP } = await import('./BlockSprite.mjs');
            /** @type {Object<string, { top: string, left: string, right: string }>} */
            const textureMap = {};
            for (const type of typeList) {
                if (options.textureOverrides && options.textureOverrides[type]) {
                    textureMap[type] = options.textureOverrides[type];
                } else if (BLOCK_TEXTURE_MAP[type]) {
                    textureMap[type] = BLOCK_TEXTURE_MAP[type];
                } else {
                    log.warn(`方块类型 "${type}" 未注册贴图，使用占位纹理`);
                    // 用第一个已知类型作为 fallback
                    const fallback = BLOCK_TEXTURE_MAP[Object.keys(BLOCK_TEXTURE_MAP)[0]] || BLOCK_TEXTURE_MAP.grass;
                    textureMap[type] = fallback;
                }
            }

            // 批量加载 + 等轴变换
            this._cachedTextures = await batchLoadAndTransform(textureMap, {
                interpolation: this._interpolation,
                fixEdges: false,
                includeAssembled: this._useAssembled
            });

            log.info(`纹理加载完成: ${Object.keys(this._cachedTextures).length} 种`);
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

    // ==================== 动态操作 API ====================

    /**
     * 动态添加一个方块到场景中。
     *
     * 如果指定位置已有方块，先移除旧的，再添加新的（覆盖模式）。
     * 新方块使用已缓存的纹理数据（如果可用），否则实时加载。
     *
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标（高度层）
     * @param {string} blockType - 方块类型标识
     * @returns {Promise<BlockSprite|null>} 创建的 BlockSprite，失败返回 null
     *
     * @example
     * ```javascript
     * await renderer.addBlock(5, 3, 0, 'stone');
     * await renderer.addBlock(5, 3, 1, 'brick');
     * ```
     */
    async addBlock(gx, gy, gz, blockType) {
        // 如果已有方块，先移除
        const existing = this._blockMap.get(`${gx},${gy},${gz}`);
        if (existing) {
            this._removeFromLayer(gx, gy, gz, existing);
        }

        const block = await this._createAndPlaceBlock(gx, gy, gz, blockType);
        return block;
    }

    /**
     * 从场景中移除指定位置的方块。
     *
     * 如果该位置没有方块，静默忽略。
     *
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标（高度层）
     * @returns {boolean} 是否成功移除
     *
     * @example
     * ```javascript
     * renderer.removeBlock(3, 2, 0);
     * ```
     */
    removeBlock(gx, gy, gz) {
        const key = `${gx},${gy},${gz}`;
        const block = this._blockMap.get(key);
        if (!block) return false;

        this._removeFromLayer(gx, gy, gz, block);
        return true;
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
     * @returns {BlockSprite|undefined}
     */
    getBlock(gx, gy, gz) {
        return this._blockMap.get(`${gx},${gy},${gz}`);
    }

    /**
     * 清空所有方块，释放资源。
     *
     * 当 this._sceneGraph 存在时，走 SceneGraph.clear() 路径（自动触发清理链），
     * 否则遍历映射表手动从图层移除并销毁每个 BlockSprite。
     * 无论哪种路径，都保留纹理缓存（场景切换时可能复用）。
     */
    clear() {
        log.info(`清空场景: ${this._blockMap.size} 个方块`);

        if (this._sceneGraph) {
            // SceneGraph.clear() 内部逐个 remove()，处理所有 destroy + 事件
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
        // 保留纹理缓存（场景切换时可能复用）
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
     * 遍历 _blockMap 中的所有 BlockSprite，统一设置 visible 和 eventMode。
     * 当隐藏时同时禁用交互（eventMode = 'none'），
     * 显示时恢复为 'auto'（由 PIXI 默认的穿透检测决定）。
     * 菱形网格 (IsoGridOverlay) 不受此方法影响。
     *
     * @param {boolean} visible - true 显示所有方块，false 隐藏所有方块
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * // 隐藏所有方块（用于仅显示菱形网格的场景）
     * renderer.setBlocksVisible(false);
     *
     * // 恢复显示
     * renderer.setBlocksVisible(true);
     * ```
     */
    setBlocksVisible(visible) {
        for (const [key, block] of this._blockMap) {
            block.visible = visible;
            // 隐藏时禁用交互，显示时恢复默认
            block.eventMode = visible ? 'auto' : 'none';
        }
        log.info(`所有方块已${visible ? '显示' : '隐藏'} (${this._blockMap.size} 个)`);
        return this;
    }

    // ==================== 网格 hover 高亮 ====================

    /**
     * 绑定菱形网格 hover 高亮。
     *
     * 为 _blockMap 中所有 BlockSprite 设置：
     * - eventMode = 'static'（启用 PIXI 事件交互）
     * - hitArea = 菱形 Polygon（精确拾取，避免矩形误触发）
     * - pointerenter → gridOverlay.highlightCell(gx, gy)
     * - pointerleave → gridOverlay.clearHighlight()
     *
     * 当 _gridOverlay 已绑定时再次调用不会重复绑定（先解绑再绑定）。
     *
     * @param {import('./IsoGridOverlay.mjs').IsoGridOverlay} gridOverlay - 菱形网格覆盖层实例
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * const gridOverlay = new IsoGridOverlay(5, 5);
     * renderer.bindGridHover(gridOverlay);
     *
     * // 鼠标移入方块 → 对应网格线高亮
     * // 鼠标移出方块 → 高亮消失
     * ```
     */
    bindGridHover(gridOverlay) {
        // 先解绑已有绑定，防止重复
        if (this._gridOverlay) {
            this.unbindGridHover();
        }
        this._gridOverlay = gridOverlay;

        for (const [key, block] of this._blockMap) {
            const [gx, gy] = key.split(',').map(Number);

            // 启用交互
            block.eventMode = 'static';

            // 菱形 hitArea（局部坐标）
            // 容器原点 = 顶面菱形中心
            // 菱形半宽 12，半高 6
            block.hitArea = new PIXI.Polygon(
                0, -6,   // 顶
                12, 0,   // 右
                0, 6,    // 底
                -12, 0   // 左
            );

            // hover 事件
            block.on('pointerenter', () => {
                gridOverlay.highlightCell(gx, gy);
            });
            block.on('pointerleave', () => {
                gridOverlay.clearHighlight();
            });
        }

        log.info(`网格 hover 高亮已绑定 (${this._blockMap.size} 个方块)`);
        return this;
    }

    /**
     * 解绑网格 hover 高亮，移除所有事件监听。
     *
     * 清理顺序：
     * 1. 移除所有方块的 pointerenter/pointerleave 监听
     * 2. 将 eventMode 恢复为 'auto'
     * 3. 清除当前高亮
     * 4. 清空 _gridOverlay 引用
     *
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * renderer.unbindGridHover();
     * ```
     */
    unbindGridHover() {
        if (!this._gridOverlay) return this;

        for (const [, block] of this._blockMap) {
            block.removeAllListeners('pointerenter');
            block.removeAllListeners('pointerleave');
            block.eventMode = 'auto';
            block.hitArea = null;
        }

        this._gridOverlay.clearHighlight();
        this._gridOverlay = null;

        log.info('网格 hover 高亮已解绑');
        return this;
    }

    // ==================== 网格点击交互 ====================

    /**
     * 绑定网格点击交互——测试用。
     *
     * 在现有的 bindGridHover 基础上增加点击能力：
     * - 点击已有方块 → 移除该方块
     * - 点击空白格点 → 在点击位置随机添加一个方块
     *
     * 实现机制：
     * - 在 rootContainer（即 cameraContainer）上绑定唯一的 pointerdown 监听器
     * - 通过等轴逆投影将屏幕坐标转换为网格坐标 (gx, gy)
     * - 检查目标位置是否有方块：有则删除，无则随机添加
     * - 不依赖 per-block 事件监听（经诊断：IsoGridOverlay 非 PIXI 容器，
     *   且 cameraContainer 默认 eventMode='none' 阻断事件传播）
     *
     * 自动调用 bindGridHover（确保 hitArea 和 eventMode 就绪）。
     *
     * @param {import('./IsoGridOverlay.mjs').IsoGridOverlay} gridOverlay - 菱形网格覆盖层实例
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * const gridOverlay = new IsoGridOverlay(5, 5);
     * renderer.bindGridClick(gridOverlay);
     * // 点击方块 → 删除
     * // 点击空白 → 随机生成
     * ```
     */
    bindGridClick(gridOverlay) {
        // 先绑定 hover（确保 hitArea 和 eventMode 就绪）
        this.bindGridHover(gridOverlay);

        // 标记启用
        this._gridClickEnabled = true;

        // 获取 rootContainer（即 cameraContainer）并确保其可交互
        const rootContainer = this._layerStack.getRootContainer();
        rootContainer.eventMode = 'static';
        rootContainer.cursor = 'crosshair';

        /**
         * 全局 pointerdown 处理器。
         * 通过等轴逆投影将点击坐标转为网格坐标 (gx, gy)，
         * 有方块→删除，无方块→随机添加。
         * @param {import('pixi.js').FederatedPointerEvent} event
         */
        const handler = (event) => {
            // 获取相对于 rootContainer 的局部坐标（已考虑相机变换）
            const pos = event.getLocalPosition(rootContainer);
            // 等轴逆投影：screen → grid
            //   正向: screenX = (gx - gy) * TILE_HALF_W
            //         screenY = (gx + gy) * TILE_HALF_H
            //   逆向: gx = (screenX/TILE_HALF_W + screenY/TILE_HALF_H) / 2
            //         gy = (screenY/TILE_HALF_H - screenX/TILE_HALF_W) / 2
            const gx = Math.round((pos.x / TILE_HALF_W + pos.y / TILE_HALF_H) / 2);
            const gy = Math.round((pos.y / TILE_HALF_H - pos.x / TILE_HALF_W) / 2);

            // 边界保护
            if (gx < 0 || gy < 0) return;

            // 检查 (gx, gy, 0) 是否有方块
            if (this.hasBlock(gx, gy, 0)) {
                this.removeBlock(gx, gy, 0);
            } else {
                // 空白格点 → 随机新建
                const types = Object.keys(BLOCK_TEXTURE_MAP);
                const type = types[Math.floor(Math.random() * types.length)];
                this.addBlock(gx, gy, 0, type).catch(err => {
                    log.error('随机添加方块失败:', err);
                });
            }
        };

        rootContainer.on('pointerdown', handler);
        this._gridClickHandler = handler;

        log.info(`网格点击交互已绑定 (${this._blockMap.size} 个方块)`);
        return this;
    }

    /**
     * 解绑网格点击交互。
     *
     * 清理顺序：
     * 1. 移除 rootContainer 上的 pointerdown 监听
     * 2. 清空引用
     *
     * 注：不重置 rootContainer.eventMode（由 RenderSystem 或其它系统管理）。
     *
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * renderer.unbindGridClick();
     * ```
     */
    unbindGridClick() {
        if (!this._gridClickEnabled) return this;

        // 移除 rootContainer 上的 pointerdown 监听
        const rootContainer = this._layerStack.getRootContainer();
        if (this._gridClickHandler) {
            rootContainer.removeListener('pointerdown', this._gridClickHandler);
        }

        this._gridClickEnabled = false;
        this._gridClickHandler = null;

        log.info('网格点击交互已解绑');
        return this;
    }

    // ==================== 方块调试日志 ====================

    /**
     * 启用方块点击调试日志。
     *
     * 为所有现有和新建的 BlockSprite 绑定 pointerdown 事件监听，
     * 点击方块时在控制台输出完整调试信息（纹理配置、位置、网格坐标、属性等）。
     *
     * 实现机制：
     * - 遍历已有方块，确保其 eventMode='static' + 菱形 hitArea，绑定 pointerdown
     * - 新建方块在 _createAndPlaceBlock 中利用 _blockDebugEnabled 标志绑定
     * - 使用 PIXI 原生事件系统，自动兼容缩放/平移后的坐标映射
     * - 与 bindGridHover / bindGridClick 无冲突（独立管理指针事件）
     *
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * renderer.enableBlockDebug();
     * // 点击任意方块，控制台输出完整调试快照
     * ```
     */
    enableBlockDebug() {
        if (this._blockDebugEnabled) {
            log.warn('方块调试日志已启用，跳过重复绑定');
            return this;
        }
        this._blockDebugEnabled = true;

        // 为所有已有方块绑定 pointerdown 调试监听
        for (const [, block] of this._blockMap) {
            this._ensureBlockInteractive(block);

            block.on('pointerdown', (event) => {
                this._logBlockDebugInfo(block, event);
            });
        }

        log.info(`方块调试日志已启用 (${this._blockMap.size} 个方块已绑定)`);
        return this;
    }

    /**
     * 禁用方块点击调试日志，移除所有 pointerdown 监听。
     *
     * 清理顺序：
     * 1. 移除所有方块的 pointerdown 监听
     * 2. 不清除 eventMode / hitArea（可能被 bindGridHover 管理）
     * 3. 重置标志位
     *
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * renderer.disableBlockDebug();
     * ```
     */
    disableBlockDebug() {
        if (!this._blockDebugEnabled) return this;

        for (const [, block] of this._blockMap) {
            block.removeAllListeners('pointerdown');
        }

        this._blockDebugEnabled = false;

        log.info('方块调试日志已禁用');
        return this;
    }

    /**
     * 确保方块具备交互能力（eventMode + hitArea）。
     * 仅在方块尚未设置 hitArea 时补充，避免覆盖已有设置。
     *
     * @private
     * @param {BlockSprite} block - 目标方块
     */
    _ensureBlockInteractive(block) {
        if (!block.eventMode || block.eventMode === 'none') {
            block.eventMode = 'static';
        }
        if (!block.hitArea) {
            block.hitArea = new PIXI.Polygon(
                0, -6,   // 顶
                12, 0,   // 右
                0, 6,    // 底
                -12, 0   // 左
            );
        }
    }

    /**
     * 编译并输出方块的完整调试信息到控制台。
     *
     * 输出内容包括：
     * - 纹理配置：方块类型名、三面贴图路径、UV 坐标帧信息、图集引用
     * - 位置信息：世界坐标、局部坐标、zIndex
     * - 网格坐标：列 (gx)、行 (gy)、层 (gz)
     * - 物块 ID：全局唯一编号
     * - 区块 ID：标记 N/A（当前无区块系统）
     * - 附加属性：旋转、缩放、颜色叠加、透明度
     * - 渲染状态：可见、选中
     *
     * @private
     * @param {import('./BlockSprite.mjs').BlockSprite} block - 被点击的方块
     * @param {import('pixi.js').FederatedPointerEvent} event - 原始指针事件
     */
    _logBlockDebugInfo(block, event) {
        const type = block.blockType;
        const entry = BLOCK_TEXTURE_MAP[type];

        /**
         * 从 Sprite 的纹理提取 UV 帧信息。
         * 使用 PIXI.Texture 公共 API（frame / orig / baseTexture），
         * 避免访问私有属性 _uvs。
         * @param {import('pixi.js').Sprite} sprite - 面精灵
         * @returns {string} 格式化后的 UV/帧描述
         */
        const getUVInfo = (sprite) => {
            const tex = sprite && sprite.texture;
            if (!tex || !tex.frame) return 'N/A';
            const f = tex.frame;
            const bw = (tex.baseTexture && tex.baseTexture.width) || 1;
            const bh = (tex.baseTexture && tex.baseTexture.height) || 1;
            const u = (f.x / bw).toFixed(3);
            const v = (f.y / bh).toFixed(3);
            const u2 = ((f.x + f.width) / bw).toFixed(3);
            const v2 = ((f.y + f.height) / bh).toFixed(3);
            return `UV[(${u},${v})-(${u2},${v2})] Frame(${f.x},${f.y},${f.width}×${f.height})`;
        };

        // 转换 tint（数字 → 十六进制色号）
        const tintStr = typeof block.tint === 'number'
            ? `#${block.tint.toString(16).padStart(6, '0')}`
            : String(block.tint);

        // 编译调试对象
        const info = {
            // ── 纹理配置 ──
            '纹理类型': type,
            '顶面贴图': (entry && entry.top) || 'N/A',
            '左面贴图': (entry && entry.left) || 'N/A',
            '右面贴图': (entry && entry.right) || 'N/A',
            '顶面 UV/帧': getUVInfo(block._topSprite),
            '左面 UV/帧': getUVInfo(block._leftSprite),
            '右面 UV/帧': getUVInfo(block._rightSprite),
            '图集引用': 'N/A（当前架构无纹理图集系统）',

            // ── 位置信息 ──
            '世界 X': block.position.x,
            '世界 Y': block.position.y,
            '局部 X': block.position.x,
            '局部 Y': block.position.y,
            'zIndex': block.zIndex,

            // ── 网格坐标 ──
            '网格列 (gx)': block.gridX,
            '网格行 (gy)': block.gridY,
            '高度层 (gz)': block.gridZ,

            // ── 物块 ID ──
            '物块 ID': block.blockId,

            // ── 区块 ID ──
            '所属区块 ID': 'N/A（当前架构无区块系统）',

            // ── 附加属性 ──
            '旋转 (rad)': block.rotation,
            '缩放 X': block.scale.x,
            '缩放 Y': block.scale.y,
            '颜色叠加': tintStr,
            '透明度': block.alpha,

            // ── 渲染状态 ──
            '可见': block.visible,
            '选中': block.selected,
        };

        console.group(
            `%c🔲 Block #${block.blockId} [${type}] @ (${block.gridX},${block.gridY},${block.gridZ})`,
            'color: #d4a847; font-weight: bold;'
        );
        console.table(info);
        console.groupEnd();
    }

    /**
     * 销毁 BlockRenderer，释放所有资源。
     *
     * 清理顺序：
     * 1. 解绑网格点击交互
     * 2. 解绑网格 hover 高亮
     * 3. 取消事件订阅
     * 4. 清空场景
     * 5. 释放纹理缓存引用
     */
    destroy() {
        // 0. 禁用方块调试日志（移除所有 pointerdown 监听）
        this.disableBlockDebug();
        // 1. 解绑网格点击交互
        this.unbindGridClick();
        // 2. 解绑网格 hover 高亮
        this.unbindGridHover();

        // 3. 取消事件订阅
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
     * @returns {Promise<BlockSprite|null>}
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

            // 如果已绑定网格高亮，对新方块也应用 hover 设置
            if (this._gridOverlay) {
                block.eventMode = 'static';
                block.hitArea = new PIXI.Polygon(0, -6, 12, 0, 0, 6, -12, 0);
                block.on('pointerenter', () => {
                    this._gridOverlay.highlightCell(gx, gy);
                });
                block.on('pointerleave', () => {
                    this._gridOverlay.clearHighlight();
                });
            }

            // 如果已启用调试日志，对新方块绑定 pointerdown 监听
            if (this._blockDebugEnabled) {
                this._ensureBlockInteractive(block);
                block.on('pointerdown', (event) => {
                    this._logBlockDebugInfo(block, event);
                });
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
     * 当 this._sceneGraph 存在时，走场景图移除路径（自动处理 container.destroy + 事件发射），
     * 否则直接操作 LayerStack 并手动销毁。
     *
     * @private
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标
     * @param {BlockSprite} block - 要移除的 BlockSprite
     */
    _removeFromLayer(gx, gy, gz, block) {
        const key = `${gx},${gy},${gz}`;

        if (this._sceneGraph) {
            const nodeId = /** @type {number|undefined} */ (block._sceneNodeId);
            if (nodeId) {
                this._sceneGraph.remove(nodeId);
            }
            // SceneGraph.remove 内部已处理 layerStack.removeFromLayer + container.destroy
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
     * 规则：
     * - gz === 0 → Layer 1 (Ground)
     * - gz >= 1 → Layer 2 (Structures)
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
     * 自动检测输入是 2D 还是 3D 网格，并统一返回规范格式。
     *
     * @private
     * @param {Array|Array<Array>} gridData - 原始网格数据
     * @returns {{ grid: Array<Array<string|null>>, heightLayers: number[] }}
     *     grid: 2D 网格引用（如果输入是 3D，则指向第一个高度层）
     *     heightLayers: 包含的高度层索引数组
     */
    _normalizeGrid(gridData) {
        // 检测维度：如果第一行第一列是数组，则是 3D
        const is3D = Array.isArray(gridData) &&
                     gridData.length > 0 &&
                     Array.isArray(gridData[0]) &&
                     gridData[0].length > 0 &&
                     Array.isArray(gridData[0][0]);

        if (is3D) {
            // 3D 网格：gridData[gz][y][x]
            const heightLayers = [];
            for (let gz = 0; gz < gridData.length; gz++) {
                if (gridData[gz] && gridData[gz].length > 0) {
                    heightLayers.push(gz);
                }
            }
            return {
                grid: gridData[0],  // 指向第一层用于维度参考
                heightLayers
            };
        }

        // 2D 网格：gridData[y][x]，默认 gz=0
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
     * 使 BlockRenderer 能响应外部系统的方块变更。
     *
     * @private
     */
    _subscribeEvents() {
        const bus = this._eventBus;

        // 响应方块放置事件
        const onPlaced = (/** @type {{ gx: number, gy: number, gz: number, blockType: string }} */ data) => {
            if (data && typeof data.gx === 'number' && typeof data.gy === 'number' && data.blockType) {
                const gz = data.gz || 0;
                // 异步执行但不阻塞事件循环
                this.addBlock(data.gx, data.gy, gz, data.blockType).catch(err => {
                    log.error(`事件 block:placed 响应失败:`, err);
                });
            }
        };

        // 响应方块移除事件
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
