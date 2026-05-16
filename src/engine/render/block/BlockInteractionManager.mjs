// @ts-check

/**
 * @fileoverview
 * 方块交互管理器 —— 网格 hover 高亮与 click 操作（P0.2）。
 *
 * 职责：
 * 1. bindGridHover / unbindGridHover — 为方块附着 pointerenter/pointerleave，
 *    联动 IsoGridOverlay 实现菱形格高亮。
 * 2. bindGridClick / unbindGridClick — 在 rootContainer 上注册全局 pointerdown，
 *    通过等轴逆投影将屏幕坐标转为网格坐标，实现"点击删除/点击空白添加"。
 *
 * 与 BlockGridManager 的协作：
 * - 构造函数接收 BlockGridManager 实例并持有引用
 * - _onBlockCreated(block, gx, gy) 由 BlockGridManager._createAndPlaceBlock 回调，
 *   为新创建的方块自动附着 hover 事件（如果已绑定）
 * - 不持有纹理缓存或网格数据，全部委派给 gridManager
 *
 * @module render/block/BlockInteractionManager
 */

import { Logger } from '../../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('BlockInteractionManager');

/** @type {number} 等轴菱形半宽 */
const HALF_W = 12;

/** @type {number} 等轴菱形半高 */
const HALF_H = 6;

/**
 * 方块交互管理器
 *
 * @example
 * ```javascript
 * const im = new BlockInteractionManager(gridManager);
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
     * rootContainer 上的 pointerdown 处理器引用（用于解绑）。
     * @private @type {Function|null}
     */
    _gridClickHandler = null;

    /**
     * @param {import('./BlockGridManager.mjs').BlockGridManager} gridManager - 核心网格管理器
     */
    constructor(gridManager) {
        this._grid = gridManager;
    }

    // ==================== 网格 hover 高亮 ====================

    /**
     * 绑定菱形网格 hover 高亮。
     *
     * 为所有已有方块设置 eventMode='static'、菱形 hitArea，
     * 并注册 pointerenter → highlightCell / pointerleave → clearHighlight。
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
        // 先解绑已有绑定，防止重复
        if (this._gridOverlay) {
            this.unbindGridHover();
        }
        this._gridOverlay = gridOverlay;

        for (const [key, block] of this._grid._blockMap) {
            const [gx, gy, gz] = key.split(',').map(Number);

            block.eventMode = 'static';
            block.hitArea = new PIXI.Polygon(
                0, -6,   // 顶
                12, 0,   // 右
                0, 6,    // 底
                -12, 0   // 左
            );

            block.on('pointerenter', () => {
                // 查询该列所有高度层的方块信息
                const columnInfo = this._grid.getColumnInfo(gx, gy);
                // 金角描边：显示当前方块顶面的两条可见棱边
                gridOverlay.highlightBlockEdges(gx, gy, gz);
                // 高度列切片：显示各层方块轮廓
                gridOverlay.highlightColumn(gx, gy, columnInfo);
            });
            block.on('pointerleave', () => {
                gridOverlay.clearHighlight();
            });
        }

        log.info(`网格 hover 高亮已绑定 (${this._grid._blockMap.size} 个方块)`);
        return this;
    }

    /**
     * 解绑网格 hover 高亮，移除所有事件监听。
     *
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * im.unbindGridHover();
     * ```
     */
    unbindGridHover() {
        if (!this._gridOverlay) return this;

        for (const [, block] of this._grid._blockMap) {
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
     * 绑定网格点击交互。
     *
     * - 点击已有方块 → 移除该方块
     * - 点击空白格点 → 随机添加一个方块
     *
     * 自动调用 bindGridHover（确保 hitArea 和 eventMode 就绪）。
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
        // 先绑定 hover（确保 hitArea 和 eventMode 就绪）
        this.bindGridHover(gridOverlay);

        // 标记启用
        this._gridClickEnabled = true;

        // 获取 rootContainer（即 cameraContainer）并确保其可交互
        const rootContainer = this._grid._layerStack.getRootContainer();
        rootContainer.eventMode = 'static';
        rootContainer.cursor = 'crosshair';

        /**
         * 全局 pointerdown 处理器。
         * @param {import('pixi.js').FederatedPointerEvent} event
         */
        const handler = (event) => {
            const pos = event.getLocalPosition(rootContainer);

            // 等轴逆投影：screen → grid
            const gx = Math.round((pos.x / HALF_W + pos.y / HALF_H) / 2);
            const gy = Math.round((pos.y / HALF_H - pos.x / HALF_W) / 2);

            // 边界保护
            if (gx < 0 || gy < 0) return;

            // 检查 (gx, gy, 0) 是否有方块
            if (this._grid.hasBlock(gx, gy, 0)) {
                this._grid.removeBlock(gx, gy, 0);
            } else {
                // 空白格点 → 随机新建
                this._grid.addBlock(gx, gy, 0, this._getRandomBlockType()).catch(err => {
                    log.error('随机添加方块失败:', err);
                });
            }
        };

        rootContainer.on('pointerdown', handler);
        this._gridClickHandler = handler;

        log.info(`网格点击交互已绑定 (${this._grid._blockMap.size} 个方块)`);
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

        const rootContainer = this._grid._layerStack.getRootContainer();
        if (this._gridClickHandler) {
            rootContainer.removeListener('pointerdown', this._gridClickHandler);
        }

        this._gridClickEnabled = false;
        this._gridClickHandler = null;

        log.info('网格点击交互已解绑');
        return this;
    }

    /**
     * 由 BlockGridManager._createAndPlaceBlock 回调。
     * 当交互已启用（_gridOverlay 非 null）时，为新创建的方块附着 hover 事件。
     *
     * @param {import('../BlockSprite.mjs').BlockSprite} block - 新建的方块
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标
     */
    _onBlockCreated(block, gx, gy, gz) {
        if (!this._gridOverlay) return;

        block.eventMode = 'static';
        block.hitArea = new PIXI.Polygon(0, -6, 12, 0, 0, 6, -12, 0);
        block.on('pointerenter', () => {
            const columnInfo = this._grid.getColumnInfo(gx, gy);
            this._gridOverlay.highlightBlockEdges(gx, gy, gz);
            this._gridOverlay.highlightColumn(gx, gy, columnInfo);
        });
        block.on('pointerleave', () => {
            this._gridOverlay.clearHighlight();
        });
    }

    /**
     * 随机选择一个已注册的方块类型。
     * @private
     * @returns {string}
     */
    _getRandomBlockType() {
        // 从 _grid._blockTypes 或全局 BLOCK_TEXTURE_MAP 中选取
        if (this._grid._blockTypes.size > 0) {
            const types = Array.from(this._grid._blockTypes);
            return types[Math.floor(Math.random() * types.length)];
        }
        return 'grass';
    }

    /**
     * 销毁交互管理器，解绑所有事件。
     */
    destroy() {
        this.unbindGridClick();
        this.unbindGridHover();
        this._grid = null;
    }
}
