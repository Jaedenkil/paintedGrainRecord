// @ts-check

/**
 * @fileoverview
 * 方块交互管理器（P3.3 重写版）—— 网格 hover 高亮与 click 操作。
 *
 * ## 架构变化（P3.3）
 *
 * 从基于 PixiJS 精灵级事件（hitArea + pointerenter/pointerleave）改为
 * 基于 ScreenToWorld 的 O(1) 纯数学拾取 + EventBus 事件广播。
 *
 * ### 旧架构（P0.2）：
 * ```
 * bindGridHover → 遍历所有方块 → 设 PIXI.Polygon hitArea
 *   → 每个 sprite 注册 pointerenter/pointerleave
 *   → _onBlockCreated 对新方块重复这一过程
 * ```
 *
 * ### 新架构（P3.3）：
 * ```
 * bindGridHover → rootContainer 注册一个 pointermove
 *   → ScreenToWorld.screenToGridRounded(x, y)
 *   → BlockGridManager 查表 getColumnInfo/hasBlock
 *   → 状态变化时 emit('block:hover') / emit('block:blur')
 *   → IsoGridOverlay.highlightBlockEdges() / clearHighlight()
 * ```
 *
 * 收益：
 * - 拾取从 O(n) 降为 O(1)（n=方块数）
 * - 解耦 PixiJS 精灵级事件（不再依赖 eventMode/hitArea/Polygon）
 * - 事件驱动：外部模块可监听 block:hover/block:click
 *
 * @module render/block/BlockInteractionManager
 */

import { Logger } from '../../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('BlockInteractionManager');

/**
 * 方块交互管理器
 *
 * @example
 * ```javascript
 * const stw = new ScreenToWorld(camera2D);
 * const im = new BlockInteractionManager(gridManager, stw);
 * im.bindGridHover(gridOverlay);
 * im.bindGridClick(gridOverlay);
 * // ... 用户交互 ...
 * im.unbindGridClick();
 * im.unbindGridHover();
 * ```
 */
export class BlockInteractionManager {
    /**
     * 被管理的 BlockGridManager 实例。
     * @private @type {import('./BlockGridManager.mjs').BlockGridManager}
     */
    _grid;

    /**
     * ScreenToWorld 逆变换工具。
     * @private @type {import('../../input/ScreenToWorld.mjs').ScreenToWorld|null}
     */
    _screenToWorld = null;

    /**
     * 事件总线实例。
     * @private @type {import('../../core/EventBus.mjs').EventBus}
     */
    _eventBus;

    /**
     * 菱形网格覆盖层引用（用于 hover 高亮）。
     * @private @type {import('../IsoGridOverlay.mjs').IsoGridOverlay|null}
     */
    _gridOverlay = null;

    /**
     * 网格点击交互是否已启用。
     * @private @type {boolean}
     */
    _gridClickEnabled = false;

    /**
     * 当前 hover 的方块 key（`gx,gy,gz`），用于变化检测。
     * @private @type {string|null}
     */
    _hoveredKey = null;

    /**
     * rootContainer 上的 pointermove 处理器引用（用于解绑）。
     * @private @type {Function|null}
     */
    _hoverHandler = null;

    /**
     * rootContainer 上的 pointerdown 处理器引用（用于解绑）。
     * @private @type {Function|null}
     */
    _clickHandler = null;

    /**
     * @param {import('./BlockGridManager.mjs').BlockGridManager} gridManager - 核心网格管理器
     * @param {import('../../input/ScreenToWorld.mjs').ScreenToWorld} [screenToWorld] - 屏幕→网格逆变换工具
     */
    constructor(gridManager, screenToWorld) {
        this._grid = gridManager;
        this._screenToWorld = screenToWorld || null;
        this._eventBus = gridManager._eventBus;
    }

    // ==================== 相机 / ScreenToWorld 注入 ====================

    /**
     * 设置 ScreenToWorld 实例（注入相机依赖）。
     *
     * 允许在构造后延迟注入，方便 BlockRenderer 的初始化流程。
     *
     * @param {import('../../input/ScreenToWorld.mjs').ScreenToWorld} screenToWorld
     * @returns {this} 链式调用
     */
    setScreenToWorld(screenToWorld) {
        this._screenToWorld = screenToWorld;
        return this;
    }

    // ==================== 网格 hover 高亮 ====================

    /**
     * 绑定菱形网格 hover 高亮。
     *
     * 在 rootContainer 上注册一个 pointermove 处理器，通过 ScreenToWorld
     * 做 O(1) 纯数学命中检测，取代旧架构的逐精灵 hitArea + pointerenter/leave。
     *
     * @param {import('../IsoGridOverlay.mjs').IsoGridOverlay} gridOverlay - 菱形网格覆盖层实例
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * const gridOverlay = new IsoGridOverlay(5, 5);
     * im.bindGridHover(gridOverlay);
     * ```
     */
    bindGridHover(gridOverlay) {
        // 先解绑已有绑定
        if (this._gridOverlay) {
            this.unbindGridHover();
        }
        this._gridOverlay = gridOverlay;

        const rootContainer = this._grid._layerStack.getRootContainer();

        /** @param {import('pixi.js').FederatedPointerEvent} event */
        const handler = (event) => {
            this._handlePointerMove(event);
        };

        rootContainer.on('pointermove', handler);
        this._hoverHandler = handler;

        log.info(`网格 hover 高亮已绑定 (使用 ScreenToWorld 拾取)`);
        return this;
    }

    /**
     * 解绑网格 hover 高亮，移除 pointermove 处理器。
     *
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * im.unbindGridHover();
     * ```
     */
    unbindGridHover() {
        if (this._hoverHandler) {
            const rootContainer = this._grid._layerStack.getRootContainer();
            rootContainer.removeListener('pointermove', this._hoverHandler);
            this._hoverHandler = null;
        }

        // 发射 blur 事件（如果处于 hover 状态）
        if (this._hoveredKey !== null) {
            this._eventBus.emit('block:blur', {});
        }
        this._hoveredKey = null;

        if (this._gridOverlay) {
            this._gridOverlay.clearHighlight();
            this._gridOverlay = null;
        }

        log.info('网格 hover 高亮已解绑');
        return this;
    }

    // ==================== 网格点击交互 ====================

    /**
     * 绑定网格点击交互。
     *
     * 在 rootContainer 上注册 pointerdown 处理器，通过 ScreenToWorld 拾取：
     * - 点击已有方块 → 移除该方块 + emit('block:click')
     * - 点击空白格点 → 随机添加一个方块 + emit('block:click')
     *
     * 自动调用 bindGridHover（确保 hover 状态就绪）。
     *
     * @param {import('../IsoGridOverlay.mjs').IsoGridOverlay} gridOverlay - 菱形网格覆盖层实例
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * im.bindGridClick(gridOverlay);
     * ```
     */
    bindGridClick(gridOverlay) {
        // 先绑定 hover（确保高亮和状态跟踪就绪）
        this.bindGridHover(gridOverlay);

        this._gridClickEnabled = true;

        const rootContainer = this._grid._layerStack.getRootContainer();
        rootContainer.cursor = 'crosshair';

        /** @param {import('pixi.js').FederatedPointerEvent} event */
        const handler = (event) => {
            this._handlePointerDown(event);
        };

        rootContainer.on('pointerdown', handler);
        this._clickHandler = handler;

        log.info(`网格点击交互已绑定 (使用 ScreenToWorld 拾取)`);
        return this;
    }

    /**
     * 解绑网格点击交互。
     *
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * im.unbindGridClick();
     * ```
     */
    unbindGridClick() {
        if (!this._gridClickEnabled) return this;

        if (this._clickHandler) {
            const rootContainer = this._grid._layerStack.getRootContainer();
            rootContainer.removeListener('pointerdown', this._clickHandler);
            this._clickHandler = null;
        }

        this._gridClickEnabled = false;

        log.info('网格点击交互已解绑');
        return this;
    }

    // ==================== BlockGridOperator 回调钩子 ====================

    /**
     * 由 BlockGridOperator._createAndPlaceBlock 回调。
     *
     * 新架构使用全局 pointermove 拾取，不再需要逐精灵绑定事件。
     * 此方法保留为空操作以保证回调链不中断。
     *
     * @param {import('../BlockSprite.mjs').BlockSprite} block - 新建的方块
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标
     */
    // eslint-disable-next-line no-unused-vars
    _onBlockCreated(block, gx, gy, gz) {
        // 新架构：无需操作（全局拾取覆盖所有方块）
    }

    // ==================== 内部事件处理器 ====================

    /**
     * pointermove 事件处理核心。
     * @private
     * @param {import('pixi.js').FederatedPointerEvent} event
     */
    _handlePointerMove(event) {
        if (!this._screenToWorld) return;

        const sx = event.global.x;
        const sy = event.global.y;

        // 1. 屏幕 → 网格（O(1) 逆变换）
        const { gx, gy } = this._screenToWorld.screenToGridRounded(sx, sy);

        // 2. 查找该列被击中的方块
        const hit = this._getHitBlock(sx, sy, gx, gy);
        const newKey = hit ? `${gx},${gy},${hit.gz}` : null;

        // 3. 状态无变化 → 跳过
        if (newKey === this._hoveredKey) return;

        // 4. 离开旧方块
        if (this._hoveredKey !== null) {
            this._eventBus.emit('block:blur', {});
        }

        // 5. 进入新方块
        if (hit) {
            this._hoveredKey = newKey;
            this._hoveredGx = gx;
            this._hoveredGy = gy;
            this._hoveredGz = hit.gz;

            this._eventBus.emit('block:hover', {
                gx,
                gy,
                gz: hit.gz,
                face: hit.face,
                screenX: sx,
                screenY: sy
            });

            if (this._gridOverlay) {
                const columnInfo = this._grid.getColumnInfo(gx, gy);
                this._gridOverlay.highlightBlockEdges(gx, gy, hit.gz);
                this._gridOverlay.highlightColumn(gx, gy, columnInfo);
            }
        } else {
            this._hoveredKey = null;

            if (this._gridOverlay) {
                this._gridOverlay.clearHighlight();
            }
        }
    }

    /**
     * pointerdown 事件处理核心。
     * @private
     * @param {import('pixi.js').FederatedPointerEvent} event
     */
    _handlePointerDown(event) {
        if (!this._screenToWorld) return;

        const sx = event.global.x;
        const sy = event.global.y;

        // 1. 屏幕 → 网格（O(1) 逆变换）
        const { gx, gy } = this._screenToWorld.screenToGridRounded(sx, sy);

        // 2. 边界保护（旧行为兼容）
        if (gx < 0 || gy < 0) return;

        // 3. 查找被击中的方块
        const hit = this._getHitBlock(sx, sy, gx, gy);

        if (hit) {
            // 点击已有方块 → 移除 + 事件广播
            this._eventBus.emit('block:click', {
                gx,
                gy,
                gz: hit.gz,
                face: hit.face,
                button: event.button,
                screenX: sx,
                screenY: sy
            });

            this._grid.removeBlock(gx, gy, hit.gz);
        } else {
            // 空白格点 → 随机添加 + 事件广播
            this._eventBus.emit('block:click', {
                gx,
                gy,
                gz: 0,
                face: null,
                button: event.button,
                screenX: sx,
                screenY: sy
            });

            this._grid.addBlock(gx, gy, 0, this._getRandomBlockType()).catch(err => {
                log.error('随机添加方块失败:', err);
            });
        }
    }

    // ==================== 内部工具 ====================

    /**
     * 在 (gx, gy) 列中找到被点击的最上层方块。
     *
     * 从上到下检查各高度层：
     * - 如果点击在顶面菱形内（getFace 返回 'top'），立即返回该层
     * - 否则返回最上层的侧面信息
     *
     * @private
     * @param {number} sx - 屏幕 X
     * @param {number} sy - 屏幕 Y
     * @param {number} gx - 网格 X
     * @param {number} gy - 网格 Y
     * @returns {{ gz: number, face: 'top'|'left'|'right', blockType: string }|null}
     */
    _getHitBlock(sx, sy, gx, gy) {
        const columnInfo = this._grid.getColumnInfo(gx, gy);
        if (columnInfo.length === 0) return null;

        // 从上往下遍历：高层的方块在屏幕上更靠前（遮挡低层）
        for (let i = columnInfo.length - 1; i >= 0; i--) {
            const { gz } = columnInfo[i];
            const face = this._screenToWorld.getFace(sx, sy, gx, gy, gz);
            if (face === 'top') {
                return { gz, face, blockType: columnInfo[i].blockType };
            }
        }

        // 没有顶面命中，返回最上层的侧面
        const top = columnInfo[columnInfo.length - 1];
        const face = this._screenToWorld.getFace(sx, sy, gx, gy, top.gz);
        return { gz: top.gz, face, blockType: top.blockType };
    }

    /**
     * 随机选择一个已注册的方块类型。
     * @private
     * @returns {string}
     */
    _getRandomBlockType() {
        if (this._grid._blockTypes.size > 0) {
            const types = Array.from(this._grid._blockTypes);
            return types[Math.floor(Math.random() * types.length)];
        }
        return 'grass';
    }

    // ==================== 生命周期 ====================

    /**
     * 销毁交互管理器，解绑所有事件。
     */
    destroy() {
        this.unbindGridClick();
        this.unbindGridHover();
        this._screenToWorld = null;
        this._grid = null;
    }
}
