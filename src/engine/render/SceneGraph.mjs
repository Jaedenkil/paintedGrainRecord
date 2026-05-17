// @ts-check

/**
 * @fileoverview
 * 场景图管理器（T11）。在 LayerStack 之上提供"可追踪的渲染对象管理"。
 * 每个渲染对象被包装为 RenderNode，具有唯一 ID、可见性、排序键和移除回调。
 * @module render/SceneGraph
 */

import { EventBus } from '../core/EventBus.mjs';
import { Logger } from '../utils/Logger.mjs';

const log = Logger.for('SceneGraph');

/**
 * @typedef {Object} RenderNode
 * @property {number} id - 全局唯一标识
 * @property {number} layerIndex - 所属图层索引 (0~7)
 * @property {import('pixi.js').Container} container - PIXI 显示对象
 * @property {boolean} visible - 可见性
 * @property {number} sortKey - Y-Sort 排序键
 * @property {(() => void)|null} onRemove - 移除回调
 */

/**
 * 场景图管理器。提供渲染对象的增删改查，自动处理 LayerStack 集成、RenderNode 索引、事件发射。
 */
export class SceneGraph {
    /**
     * @param {import('./LayerStack.mjs').LayerStack} layerStack
     * @param {import('./SortManager.mjs').SortManager} [sortManager]
     */
    constructor(layerStack, sortManager = null) {
        /** @private @type {import('./LayerStack.mjs').LayerStack} */ this._layerStack = layerStack;
        /** @private @type {import('./SortManager.mjs').SortManager|null} */ this._sortManager = sortManager;
        /** @private @type {Map<number, RenderNode>} */ this._nodes = new Map();
        /** @private @type {Map<number, Set<number>>} */ this._layerNodes = new Map();
        for (let i = 0; i < 8; i++) this._layerNodes.set(i, new Set());
        /** @private @type {number} */ this._nextId = 1;
        /** @private */ this._destroyed = false;
    }

    // ==================== 增删改查 ====================

    /**
     * 添加渲染对象到指定图层。
     * @param {number} layerIndex - 图层索引 (0~7)
     * @param {import('pixi.js').Container} container - 显示对象
     * @param {Object} [options]
     * @param {number} [options.sortKey=0] - 初始排序键
     * @param {(() => void)} [options.onRemove] - 移除回调
     * @param {boolean} [options.visible=true] - 初始可见性
     * @returns {number} 新 RenderNode 的唯一 ID
     */
    add(layerIndex, container, options = {}) {
        if (this._destroyed) return -1;
        const id = this._nextId++;
        const { sortKey = 0, onRemove = null, visible = true } = options;
        const node = /** @type {RenderNode} */ ({ id, layerIndex, container, visible, sortKey, onRemove });
        container.visible = visible;
        container.zIndex = sortKey;
        this._layerStack.addToLayer(layerIndex, container);
        this._nodes.set(id, node);
        this._layerNodes.get(layerIndex).add(id);
        EventBus.getInstance().emit('render:node-added', { id, layerIndex, container, sortKey, visible });
        log.debug(`节点 #${id} 添加到 Layer ${layerIndex}`);
        return id;
    }

    /**
     * 通过 ID 移除渲染对象。
     * @param {number} id - RenderNode ID
     * @returns {boolean} 是否成功移除
     */
    remove(id) {
        if (this._destroyed) return false;
        const node = this._nodes.get(id);
        if (!node) return false;
        const { layerIndex, container, onRemove } = node;

        EventBus.getInstance().emit('render:node-will-remove', { id, layerIndex, container });
        if (this._sortManager) this._sortManager.markDirty(layerIndex);

        if (typeof onRemove === 'function') {
            try { onRemove(); } catch (/** @type {unknown} */ err) { log.warn(`节点 #${id} 的 onRemove 回调出错:`, err); }
        }

        try {
            this._layerStack.removeFromLayer(layerIndex, container);
            container.destroy({ children: true });
        } catch (/** @type {unknown} */ err) { log.warn(`节点 #${id} 销毁容器时出错:`, err); }

        this._nodes.delete(id);
        this._layerNodes.get(layerIndex).delete(id);
        EventBus.getInstance().emit('render:node-removed', { id, layerIndex });
        log.debug(`节点 #${id} 从 Layer ${layerIndex} 移除`);
        return true;
    }

    /** @param {number} id @returns {RenderNode|undefined} */
    get(id) {
        if (this._destroyed) return undefined;
        return this._nodes.get(id);
    }

    /**
     * 查询指定图层内的所有 RenderNode。
     * @param {number} layerIndex
     * @returns {RenderNode[]}
     */
    getAllInLayer(layerIndex) {
        if (this._destroyed) return [];
        const ids = this._layerNodes.get(layerIndex);
        if (!ids) return [];
        return Array.from(ids)
            .map(id => this._nodes.get(id))
            .filter(/** @returns {node is RenderNode} */ (node) => node !== undefined);
    }

    /** @param {number} id @returns {boolean} */
    has(id) {
        if (this._destroyed) return false;
        return this._nodes.has(id);
    }

    // ==================== 属性更新 ====================

    /**
     * 移动渲染对象（仅更新 container.x/y）。
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    move(id, x, y) {
        if (this._destroyed) return false;
        const node = this._nodes.get(id);
        if (!node) return false;
        node.container.x = x;
        node.container.y = y;
        return true;
    }

    /**
     * 设置渲染对象的可见性。
     * @param {number} id
     * @param {boolean} visible
     * @returns {boolean}
     */
    setVisible(id, visible) {
        if (this._destroyed) return false;
        const node = this._nodes.get(id);
        if (!node) return false;
        node.visible = visible;
        node.container.visible = visible;
        return true;
    }

    /**
     * 更新渲染对象的排序键。自动标记所在层为脏。
     * @param {number} id
     * @param {number} sortKey
     * @returns {boolean}
     */
    setSortKey(id, sortKey) {
        if (this._destroyed) return false;
        const node = this._nodes.get(id);
        if (!node) return false;
        node.sortKey = sortKey;
        node.container.zIndex = sortKey;
        if (this._sortManager) this._sortManager.markDirty(node.layerIndex);
        return true;
    }

    // ==================== 统计 ====================

    /** @type {number} */ get count() { return this._nodes.size; }

    /** @param {number} layerIndex @returns {number} */
    countInLayer(layerIndex) {
        const ids = this._layerNodes.get(layerIndex);
        return ids ? ids.size : 0;
    }

    // ==================== 清空与销毁 ====================

    /** 清空所有节点。清空后 SceneGraph 仍然可用。*/
    clear() {
        if (this._destroyed) return;
        const ids = Array.from(this._nodes.keys()).sort((a, b) => b - a);
        for (const id of ids) this.remove(id);
        log.info('场景图已清空');
    }

    /** 销毁管理器，释放所有资源。销毁后所有公开方法变为安全空操作。*/
    destroy() {
        if (this._destroyed) return;
        this.clear();
        this._nodes.clear();
        this._layerNodes.clear();
        this._layerStack = /** @type {any} */ (null);
        this._sortManager = null;
        this._destroyed = true;
        log.info('场景图已销毁');
    }
}
