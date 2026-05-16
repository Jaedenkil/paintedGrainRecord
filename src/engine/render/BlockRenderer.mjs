// @ts-check

/**
 * @fileoverview
 * 方块渲染器 —— 组合桥接层（P0.2 重构版）。
 *
 * 架构：
 * ```
 * BlockRenderer (桥接层, ~220行)
 *   └── extends BlockGridManager (~350行, 核心数据+渲染)
 *   ├── has-a BlockInteractionManager (~180行, hover+click)
 *   └── has-a BlockDebugManager (~150行, 调试日志)
 * ```
 *
 * BlockRenderer 继承 BlockGridManager 以获得所有网格管理能力，
 * 同时 lazy 创建 Interaction 和 Debug 管理器。
 * 这种设计保证了：
 * 1. 向后完全兼容（类名、方法签名、私有属性全部保持一致）
 * 2. 交互/调试功能按需加载（只有调用 bindGridClick/enableBlockDebug 才会实例化子管理器）
 * 3. _createAndPlaceBlock 通过 interactionManager / debugManager 回调自动为新方块绑定事件
 *
 * @module render/BlockRenderer
 */

import { BlockGridManager } from './block/BlockGridManager.mjs';
import { BlockInteractionManager } from './block/BlockInteractionManager.mjs';
import { BlockDebugManager } from './block/BlockDebugManager.mjs';
import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('BlockRenderer');

/**
 * 方块渲染器
 *
 * 2.5D 等轴方块场景的入口 API。
 * 组合了网格管理、hover/click 交互和调试日志功能。
 *
 * @example
 * ```javascript
 * const renderer = new BlockRenderer(renderSystem.layerStack);
 * await renderer.buildFromGrid([['grass', 'stone'], ['dirt', null]]);
 * renderer.bindGridClick(gridOverlay);
 * renderer.enableBlockDebug();
 * ```
 */
export class BlockRenderer extends BlockGridManager {
    /** @private @type {BlockInteractionManager|null} */
    _interaction = null;

    /** @private @type {BlockDebugManager|null} */
    _debug = null;

    /**
     * @param {import('./LayerStack.mjs').LayerStack} layerStack - 图层管理栈实例
     * @param {import('../core/EventBus.mjs').EventBus} [eventBus] - 事件总线（默认使用单例）
     * @param {import('./SceneGraph.mjs').SceneGraph} [sceneGraph] - 场景图管理器（可选，T11 集成）
     */
    constructor(layerStack, eventBus, sceneGraph) {
        super(layerStack, eventBus, sceneGraph);
        // 所有网格管理能力由 BlockGridManager 构造函数完成
    }

    // ==================== 交互能力代理 ====================

    /**
     * 绑定菱形网格 hover 高亮。
     *
     * 延迟创建 BlockInteractionManager，并设置为网格管理器的回调钩子。
     *
     * @param {import('./IsoGridOverlay.mjs').IsoGridOverlay} gridOverlay - 菱形网格覆盖层实例
     * @returns {this} 链式调用
     */
    bindGridHover(gridOverlay) {
        this._ensureInteraction();
        this._interaction.bindGridHover(gridOverlay);
        return this;
    }

    /**
     * 解绑网格 hover 高亮。
     *
     * @returns {this} 链式调用
     */
    unbindGridHover() {
        if (!this._interaction) return this;
        this._interaction.unbindGridHover();
        return this;
    }

    /**
     * 绑定网格点击交互。
     *
     * @param {import('./IsoGridOverlay.mjs').IsoGridOverlay} gridOverlay - 菱形网格覆盖层实例
     * @returns {this} 链式调用
     */
    bindGridClick(gridOverlay) {
        this._ensureInteraction();
        this._interaction.bindGridClick(gridOverlay);
        return this;
    }

    /**
     * 解绑网格点击交互。
     *
     * @returns {this} 链式调用
     */
    unbindGridClick() {
        if (!this._interaction) return this;
        this._interaction.unbindGridClick();
        return this;
    }

    // ==================== 调试能力代理 ====================

    /**
     * 启用方块点击调试日志。
     *
     * 延迟创建 BlockDebugManager，并设置为网格管理器的回调钩子。
     *
     * @returns {this} 链式调用
     */
    enableBlockDebug() {
        this._ensureDebug();
        this._debug.enableBlockDebug();
        return this;
    }

    /**
     * 禁用方块点击调试日志。
     *
     * @returns {this} 链式调用
     */
    disableBlockDebug() {
        if (!this._debug) return this;
        this._debug.disableBlockDebug();
        return this;
    }

    // ==================== 销毁（扩展父类） ====================

    /**
     * 销毁 BlockRenderer，释放所有资源。
     *
     * 扩展父类 destroy：
     * 1. 先销毁交互管理器
     * 2. 再销毁调试管理器
     * 3. 最后让父类清理网格数据和事件订阅
     */
    destroy() {
        // 1. 先销毁子管理器
        if (this._debug) {
            this._debug.destroy();
            this._debug = null;
        }
        if (this._interaction) {
            this._interaction.destroy();
            this._interaction = null;
        }

        // 2. 清空钩子引用（防止 _createAndPlaceBlock 回调已销毁的管理器）
        this.interactionManager = null;
        this.debugManager = null;

        // 3. 父类清理
        super.destroy();
    }

    // ==================== 私有访问器（保证测试向后兼容） ====================

    /**
     * 当前绑定的网格覆盖层引用（委托给交互管理器）。
     * @private @type {import('./IsoGridOverlay.mjs').IsoGridOverlay|null}
     */
    get _gridOverlay() {
        return this._interaction ? this._interaction._gridOverlay : null;
    }

    /**
     * 网格点击是否已启用（委托给交互管理器）。
     * @private @type {boolean}
     */
    get _gridClickEnabled() {
        return this._interaction ? this._interaction._gridClickEnabled : false;
    }

    /**
     * rootContainer 上的点击处理器引用（委托给交互管理器）。
     * @private @type {Function|null}
     */
    get _gridClickHandler() {
        return this._interaction ? this._interaction._gridClickHandler : null;
    }

    /**
     * 方块调试日志是否已启用（委托给调试管理器）。
     * @private @type {boolean}
     */
    get _blockDebugEnabled() {
        return this._debug ? this._debug.isEnabled : false;
    }

    // ==================== 内部方法 ====================

    /**
     * 确保交互管理器已创建，并设置为网格管理器的回调钩子。
     * @private
     */
    _ensureInteraction() {
        if (!this._interaction) {
            this._interaction = new BlockInteractionManager(this);
            // 设置钩子使 _createAndPlaceBlock 能回调交互管理器
            this.interactionManager = this._interaction;
        }
    }

    /**
     * 确保调试管理器已创建，并设置为网格管理器的回调钩子。
     * @private
     */
    _ensureDebug() {
        if (!this._debug) {
            this._debug = new BlockDebugManager(this);
            // 设置钩子使 _createAndPlaceBlock 能回调调试管理器
            this.debugManager = this._debug;
        }
    }
}
