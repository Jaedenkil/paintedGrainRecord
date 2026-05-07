// @ts-check

/**
 * @fileoverview
 * 图层管理栈 - 渲染管线的"交通警察"。
 *
 * 维护 8 个固定语义化图层容器，按固定顺序叠加。
 * 层间顺序固定（0 最下，7 最上），层内排序由 Y-sort 动态决定。
 *
 * 图层索引对照：
 * | 索引 | 名称        | 内容                         | 受相机影响 |
 * |------|-------------|------------------------------|-----------|
 * | 0    | Sky         | 远景山脉、天空、云层         | 是（视差） |
 * | 1    | Ground      | 地面方块 (gz=0)              | 是         |
 * | 2    | Structures  | 建筑/墙壁/高地 (gz≥1)        | 是         |
 * | 3    | Decorations | 花草、作物、装饰物           | 是         |
 * | 4    | Characters  | 玩家、NPC、敌人              | 是         |
 * | 5    | Effects     | 粒子特效、符箓光芒、伤害数字 | 是         |
 * | 6    | Shadows     | 角色/方块阴影                | 是         |
 * | 7    | UI          | HUD、菜单、对话              | 否         |
 *
 * @module render/LayerStack
 */

import { EventBus } from '../core/EventBus.mjs';

/** 图层定义 */
class LayerDefinition {
    /**
     * @param {number} index - 层索引 (0~7)
     * @param {string} name - 语义化名称
     */
    constructor(index, name) {
        /** @type {number} */
        this.index = index;
        /** @type {string} */
        this.name = name;
    }
}

/** 所有图层的定义（固定 8 层） */
const LAYER_DEFINITIONS = Object.freeze([
    new LayerDefinition(0, 'Sky'),
    new LayerDefinition(1, 'Ground'),
    new LayerDefinition(2, 'Structures'),
    new LayerDefinition(3, 'Decorations'),
    new LayerDefinition(4, 'Characters'),
    new LayerDefinition(5, 'Effects'),
    new LayerDefinition(6, 'Shadows'),
    new LayerDefinition(7, 'UI')
]);

/** 图层数量 */
export const LAYER_COUNT = LAYER_DEFINITIONS.length;

/** 最小层索引 */
export const LAYER_MIN = 0;

/** 最大层索引 */
export const LAYER_MAX = LAYER_COUNT - 1;

/**
 * 图层管理栈
 *
 * @example
 * ```javascript
 * import { LayerStack } from './LayerStack.mjs';
 *
 * const layerStack = new LayerStack();
 *
 * // 将精灵添加到 Characters 层 (4)
 * layerStack.addToLayer(4, characterSprite);
 *
 * // 从 Characters 层移除
 * layerStack.removeFromLayer(4, characterSprite);
 *
 * // 获取 Ground 层的 Container
 * const groundLayer = layerStack.getLayer(1);
 *
 * // 清空所有层
 * layerStack.clear();
 * ```
 */
export class LayerStack {
    /** @private @type {import('pixi.js').Container[]} */
    _layers;

    /** @private @type {import('pixi.js').Container} */
    _rootContainer;

    /** @private @type {import('pixi.js').Container} */
    _uiContainer;

    /**
     * 创建 LayerStack。
     *
     * @param {import('pixi.js').Container} rootContainer - 受相机影响的根容器（Layer 0~6 的父容器）
     * @param {import('pixi.js').Container} uiContainer - 不受相机影响的 UI 容器（Layer 7）
     */
    constructor(rootContainer, uiContainer) {
        /**
         * 图层容器数组（索引 0~6 挂载在 rootContainer 下，索引 7 挂载在 uiContainer 下）
         * @private @type {import('pixi.js').Container[]}
         */
        this._layers = [];

        this._rootContainer = rootContainer;
        this._uiContainer = uiContainer;

        // 创建 8 个图层容器
        for (let i = 0; i < LAYER_COUNT; i++) {
            const layerContainer = new PIXI.Container();
            layerContainer.name = `Layer_${i}_${LAYER_DEFINITIONS[i].name}`;

            // Layer 0~6 挂载到 rootContainer（受相机影响）
            // Layer 7 (UI) 挂载到 uiContainer（不受相机影响）
            if (i < 7) {
                rootContainer.addChild(layerContainer);
            } else {
                uiContainer.addChild(layerContainer);
            }

            this._layers.push(layerContainer);
        }
    }

    // ==================== 公共 API ====================

    /**
     * 向指定图层添加显示对象。
     *
     * @param {number} layerIndex - 图层索引 (0~7)
     * @param {import('pixi.js').Container} child - 要添加的显示对象
     * @throws {RangeError} layerIndex 超出 0~7 范围
     *
     * @example
     * ```javascript
     * const sprite = PIXI.Sprite.from('texture.png');
     * layerStack.addToLayer(4, sprite);
     * ```
     */
    addToLayer(layerIndex, child) {
        this._validateLayerIndex(layerIndex);
        const container = this._layers[layerIndex];
        container.addChild(child);
        EventBus.getInstance().emit('render:layer-changed', {
            layerIndex,
            action: 'add',
            child
        });
    }

    /**
     * 从指定图层移除显示对象。
     *
     * @param {number} layerIndex - 图层索引 (0~7)
     * @param {import('pixi.js').Container} child - 要移除的显示对象
     * @throws {RangeError} layerIndex 超出 0~7 范围
     *
     * @example
     * ```javascript
     * layerStack.removeFromLayer(4, characterSprite);
     * ```
     */
    removeFromLayer(layerIndex, child) {
        this._validateLayerIndex(layerIndex);
        const container = this._layers[layerIndex];
        if (container.removeChild(child)) {
            EventBus.getInstance().emit('render:layer-changed', {
                layerIndex,
                action: 'remove',
                child
            });
        }
    }

    /**
     * 获取指定图层的 PIXI.Container 引用。
     *
     * @param {number} layerIndex - 图层索引 (0~7)
     * @returns {import('pixi.js').Container} 对应的图层容器
     * @throws {RangeError} layerIndex 超出 0~7 范围
     *
     * @example
     * ```javascript
     * const groundContainer = layerStack.getLayer(1);
     * groundContainer.children.forEach(child => {
     *     // 遍历地面层所有对象
     * });
     * ```
     */
    getLayer(layerIndex) {
        this._validateLayerIndex(layerIndex);
        return this._layers[layerIndex];
    }

    /**
     * 清空所有图层的子对象。
     *
     * 遍历 0~7 层，销毁每个子对象并从父容器移除。
     * 清空后发射 'render:layer-changed' 事件。
     *
     * @example
     * ```javascript
     * // 场景切换时调用
     * layerStack.clear();
     * ```
     */
    clear() {
        for (let i = 0; i < LAYER_COUNT; i++) {
            const container = this._layers[i];
            // 从后往前销毁，避免索引偏移
            while (container.children.length > 0) {
                const child = container.children[container.children.length - 1];
                container.removeChild(child);
                if (typeof child.destroy === 'function') {
                    child.destroy(true);
                }
            }
        }

        EventBus.getInstance().emit('render:layer-changed', {
            action: 'clear',
            layers: this._layers.map(c => c.name)
        });
    }

    /**
     * 销毁所有图层容器，释放资源。
     */
    destroy() {
        this.clear();

        for (let i = 0; i < LAYER_COUNT; i++) {
            const container = this._layers[i];
            const parent = container.parent;
            if (parent) {
                parent.removeChild(container);
            }
            container.destroy({ children: true });
        }

        this._layers = [];
    }

    /**
     * 获取受相机影响的根容器（Layer 0~6 的父容器）。
     * @returns {import('pixi.js').Container}
     */
    getRootContainer() {
        return this._rootContainer;
    }

    /**
     * 获取 UI 容器（Layer 7）。
     * @returns {import('pixi.js').Container}
     */
    getUIContainer() {
        return this._uiContainer;
    }

    /**
     * 获取图层数量。
     * @returns {number}
     */
    get layerCount() {
        return LAYER_COUNT;
    }

    // ==================== 内部方法 ====================

    /**
     * 校验图层索引是否在有效范围内。
     * @private
     * @param {number} index
     * @throws {RangeError}
     */
    _validateLayerIndex(index) {
        if (!Number.isInteger(index) || index < LAYER_MIN || index > LAYER_MAX) {
            throw new RangeError(
                `[LayerStack] 图层索引必须为 ${LAYER_MIN}~${LAYER_MAX} 的整数，收到: ${index}`
            );
        }
    }
}
