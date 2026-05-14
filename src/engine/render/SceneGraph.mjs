// @ts-check

/**
 * @fileoverview
 * 场景图管理器（T11 — RenderNode 数据结构与场景图管理）。
 *
 * 在 LayerStack 之上提供一层"可追踪的渲染对象管理"。
 * 每个添加到场景中的渲染对象都被包装为一个 RenderNode，
 * 具有唯一 ID、可见性、排序键和移除回调。
 *
 * 职责边界：
 * - LayerStack：低层，仅管理 PIXI.Container 的增删
 * - SceneGraph：高层，管理 RenderNode 的增删改查
 * - 业务代码通过 SceneGraph 操作，LayerStack 作为内部实现细节
 *
 * @module render/SceneGraph
 */

import { EventBus } from '../core/EventBus.mjs';
import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('SceneGraph');

// ==================== RenderNode 类型定义 ====================

/**
 * 渲染节点数据结构。
 *
 * 代表场景图中一个可追踪的渲染对象。
 * 每个 RenderNode 都唯一映射到一个 PIXI.Container 实例。
 *
 * @typedef {Object} RenderNode
 * @property {number} id - 全局唯一标识（自动递增）
 * @property {number} layerIndex - 所属图层索引 (0~7)
 * @property {import('pixi.js').Container} container - 实际的 PIXI 显示对象
 * @property {boolean} visible - 可见性（同步到 container.visible）
 * @property {number} sortKey - Y-Sort 排序键（同步到 container.zIndex）
 * @property {(() => void)|null} onRemove - 移除时的回调，用于外部资源清理
 */

// ==================== SceneGraph 类 ====================

/**
 * 场景图管理器。
 *
 * 提供渲染对象的增删改查管理，自动处理：
 * - 通过 LayerStack 将容器添加到正确的图层
 * - 维护 RenderNode 的 Map 索引（id → RenderNode）
 * - 移除时自动调用 container.destroy() 释放 GPU 纹理引用
 * - 发射 'render:node-added' / 'render:node-removed' 事件供 SortManager 和外部使用
 *
 * @example
 * ```javascript
 * import { SceneGraph } from './SceneGraph.mjs';
 *
 * const sceneGraph = new SceneGraph(layerStack, sortManager);
 *
 * // 添加一个方块到 Ground 层，返回唯一 ID
 * const block = new BlockSprite({ blockType: 'grass' });
 * const nodeId = sceneGraph.add(1, block, { sortKey: getSortKey(5, 3, 0) });
 *
 * // 按 ID 查询
 * const node = sceneGraph.get(nodeId);
 *
 * // 移动（仅更新 x/y，轻量操作）
 * sceneGraph.move(nodeId, 100, 200);
 *
 * // 移除（自动调用 destroy）
 * sceneGraph.remove(nodeId);
 * ```
 */
export class SceneGraph {
    /**
     * @param {import('./LayerStack.mjs').LayerStack} layerStack - 图层管理栈
     * @param {import('./SortManager.mjs').SortManager} [sortManager] - 排序管理器（可选）
     */
    constructor(layerStack, sortManager = null) {
        /** @private @type {import('./LayerStack.mjs').LayerStack} */
        this._layerStack = layerStack;

        /** @private @type {import('./SortManager.mjs').SortManager|null} */
        this._sortManager = sortManager;

        /**
         * 节点索引 Map（id → RenderNode）。
         * @private @type {Map<number, RenderNode>}
         */
        this._nodes = new Map();

        /**
         * 层内节点索引（layerIndex → Set<id>）。
         * @private @type {Map<number, Set<number>>}
         */
        this._layerNodes = new Map();

        // 初始化 8 个层的 Set
        for (let i = 0; i < 8; i++) {
            this._layerNodes.set(i, new Set());
        }

        /**
         * 自增 ID 计数器。
         * @private @type {number}
         */
        this._nextId = 1;

        /**
         * 是否已销毁。
         * @private @type {boolean}
         */
        this._destroyed = false;
    }

    // ==================== 增删改查 ====================

    /**
     * 添加一个渲染对象到指定图层。
     *
     * 执行流程：
     * 1. 生成唯一 ID
     * 2. 创建 RenderNode 记录
     * 3. 同步 visible/sortKey 到 container
     * 4. 调用 layerStack.addToLayer() 放入对应图层
     * 5. 索引节点
     * 6. 发射 'render:node-added' 事件
     *
     * @param {number} layerIndex - 图层索引 (0~7)
     * @param {import('pixi.js').Container} container - 显示对象
     * @param {Object} [options]
     * @param {number} [options.sortKey=0] - 初始排序键（同步到 container.zIndex）
     * @param {(() => void)} [options.onRemove] - 移除时的清理回调
     * @param {boolean} [options.visible=true] - 初始可见性
     * @returns {number} 新 RenderNode 的唯一 ID
     *
     * @example
     * ```javascript
     * const id = sceneGraph.add(1, blockSprite, {
     *     sortKey: getSortKey(5, 3, 0),
     *     onRemove: () => console.log('block removed')
     * });
     * ```
     */
    add(layerIndex, container, options = {}) {
        if (this._destroyed) return -1;

        const id = this._nextId++;
        const { sortKey = 0, onRemove = null, visible = true } = options;

        // 创建 RenderNode
        /** @type {RenderNode} */
        const node = {
            id,
            layerIndex,
            container,
            visible,
            sortKey,
            onRemove
        };

        // 同步属性到 PIXI 容器
        container.visible = visible;
        container.zIndex = sortKey;

        // 添加到 LayerStack
        this._layerStack.addToLayer(layerIndex, container);

        // 索引节点
        this._nodes.set(id, node);
        this._layerNodes.get(layerIndex).add(id);

        // 发射事件
        EventBus.getInstance().emit('render:node-added', {
            id,
            layerIndex,
            container,
            sortKey,
            visible
        });

        log.debug(`节点 #${id} 添加到 Layer ${layerIndex}`);
        return id;
    }

    /**
     * 通过 ID 移除渲染对象。
     *
     * 清理链：
     * 1. 发射 'render:node-will-remove' 事件（供 SortManager 标记脏层）
     * 2. 调用 onRemove 回调（外部资源清理）
     * 3. 调用 container.destroy()（释放 GPU 纹理）
     * 4. 从索引中删除
     * 5. 发射 'render:node-removed' 事件
     *
     * @param {number} id - RenderNode ID
     * @returns {boolean} 是否成功移除
     *
     * @example
     * ```javascript
     * const removed = sceneGraph.remove(nodeId);
     * if (!removed) console.warn('节点不存在');
     * ```
     */
    remove(id) {
        if (this._destroyed) return false;

        const node = this._nodes.get(id);
        if (!node) return false;

        const { layerIndex, container, onRemove } = node;

        // 1. 发射即将移除事件
        EventBus.getInstance().emit('render:node-will-remove', {
            id,
            layerIndex,
            container
        });

        // 标记 SortManager 脏层
        if (this._sortManager) {
            this._sortManager.markDirty(layerIndex);
        }

        // 2. 调用 onRemove 回调
        if (typeof onRemove === 'function') {
            try {
                onRemove();
            } catch (/** @type {unknown} */ err) {
                log.warn(`节点 #${id} 的 onRemove 回调出错:`, err);
            }
        }

        // 3. 从 LayerStack 移除并销毁容器
        //    container.destroy() 自动从父容器中剥离
        try {
            this._layerStack.removeFromLayer(layerIndex, container);
            container.destroy({ children: true });
        } catch (/** @type {unknown} */ err) {
            log.warn(`节点 #${id} 销毁容器时出错:`, err);
        }

        // 4. 从索引中删除
        this._nodes.delete(id);
        this._layerNodes.get(layerIndex).delete(id);

        // 5. 发射已移除事件
        EventBus.getInstance().emit('render:node-removed', {
            id,
            layerIndex
        });

        log.debug(`节点 #${id} 从 Layer ${layerIndex} 移除`);
        return true;
    }

    /**
     * 获取 RenderNode 数据。
     *
     * @param {number} id - RenderNode ID
     * @returns {RenderNode|undefined} 节点对象，不存在时返回 undefined
     *
     * @example
     * ```javascript
     * const node = sceneGraph.get(42);
     * if (node) console.log(`可见性: ${node.visible}`);
     * ```
     */
    get(id) {
        if (this._destroyed) return undefined;
        return this._nodes.get(id);
    }

    /**
     * 查询指定图层内的所有 RenderNode。
     *
     * @param {number} layerIndex - 图层索引 (0~7)
     * @returns {RenderNode[]} 该层的节点数组（按添加顺序）
     *
     * @example
     * ```javascript
     * const groundNodes = sceneGraph.getAllInLayer(1);
     * console.log(`Ground 层有 ${groundNodes.length} 个对象`);
     * ```
     */
    getAllInLayer(layerIndex) {
        if (this._destroyed) return [];

        const ids = this._layerNodes.get(layerIndex);
        if (!ids) return [];

        return Array.from(ids)
            .map(id => this._nodes.get(id))
            .filter(/** @returns {node is RenderNode} */ (node) => node !== undefined);
    }

    /**
     * 检查指定 ID 是否存在。
     *
     * @param {number} id - RenderNode ID
     * @returns {boolean} 是否存在
     */
    has(id) {
        if (this._destroyed) return false;
        return this._nodes.has(id);
    }

    // ==================== 属性更新 ====================

    /**
     * 移动渲染对象（仅更新 container.x/y）。
     *
     * 这是最轻量的操作——不涉及场景图结构变更、不发射事件、不触发排序。
     * 仅更新 PixiJS 容器的位置属性，由渲染管线自然处理。
     *
     * @param {number} id - RenderNode ID
     * @param {number} x - 新的屏幕 X 坐标
     * @param {number} y - 新的屏幕 Y 坐标
     * @returns {boolean} 是否成功更新
     *
     * @example
     * ```javascript
     * // 角色从 (100, 200) 移动到 (150, 250)
     * sceneGraph.move(characterId, 150, 250);
     * ```
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
     *
     * @param {number} id - RenderNode ID
     * @param {boolean} visible - 可见性
     * @returns {boolean} 是否成功更新
     *
     * @example
     * ```javascript
     * sceneGraph.setVisible(npcId, false); // 隐藏 NPC
     * ```
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
     * 更新渲染对象的排序键。
     *
     * 更新后自动标记所在层为脏（供 SortManager 在下一帧重新排序）。
     *
     * @param {number} id - RenderNode ID
     * @param {number} sortKey - 新的排序键
     * @returns {boolean} 是否成功更新
     *
     * @example
     * ```javascript
     * // 角色移动到新的网格位置后更新排序键
     * sceneGraph.setSortKey(heroId, getSortKey(10, 7, 0));
     * ```
     */
    setSortKey(id, sortKey) {
        if (this._destroyed) return false;

        const node = this._nodes.get(id);
        if (!node) return false;

        node.sortKey = sortKey;
        node.container.zIndex = sortKey;

        // 标记所在层为脏
        if (this._sortManager) {
            this._sortManager.markDirty(node.layerIndex);
        }

        return true;
    }

    // ==================== 统计 ====================

    /**
     * 当前活跃的 RenderNode 总数。
     *
     * @type {number}
     *
     * @example
     * ```javascript
     * console.log(`场景中现有 ${sceneGraph.count} 个渲染对象`);
     * ```
     */
    get count() {
        return this._nodes.size;
    }

    /**
     * 指定图层内的 RenderNode 数量。
     *
     * @param {number} layerIndex - 图层索引
     * @returns {number} 该层节点数
     */
    countInLayer(layerIndex) {
        const ids = this._layerNodes.get(layerIndex);
        return ids ? ids.size : 0;
    }

    // ==================== 清空与销毁 ====================

    /**
     * 清空所有节点。
     *
     * 遍历所有活跃节点并逐个调用 remove()。
     * 清空后 SceneGraph 仍然可用（可继续添加新节点）。
     *
     * @example
     * ```javascript
     * // 场景切换时清空
     * sceneGraph.clear();
     * ```
     */
    clear() {
        if (this._destroyed) return;

        // 从后往前遍历，避免遍历过程中修改 Map 的问题
        // 从最大 ID 开始删除
        const ids = Array.from(this._nodes.keys()).sort((a, b) => b - a);
        for (const id of ids) {
            this.remove(id);
        }

        log.info('场景图已清空');
    }

    /**
     * 销毁管理器，释放所有资源。
     *
     * 先清空所有节点，然后释放内部 Map 引用。
     * 销毁后所有公开方法变为安全空操作或返回 undefined/false。
     */
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
