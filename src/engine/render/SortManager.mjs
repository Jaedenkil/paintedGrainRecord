// @ts-check

/**
 * @fileoverview
 * Y-Sort 排序管理器（T10）。
 *
 * 管理 8 个图层的排序策略，实现"静态层仅脏时排序，动态层每帧自动排序"：
 * - 静态层（Sky/Ground/Structures/Decorations）：关闭 PixiJS 的自动排序，
 *   通过脏标记控制排序时机，避免数千方块每帧 O(n log n) 的开销。
 * - 动态层（Characters/Effects/Shadows）：保持 PixiJS 自动排序，
 *   这些层对象数量少（通常 < 100），排序开销可忽略。
 *
 * 示意图：
 * ```
 * SortManager
 *  ├── static 层: sortableChildren = false → 仅 markDirty() 后触发排序
 *  ├── dynamic 层: sortableChildren = true  → 渲染管线的 sortChildren() 自动排序
 *  └── tick() 在每帧 camera.update() 后、adapter.render() 前调用
 * ```
 *
 * @module render/SortManager
 */

import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('SortManager');

// ==================== 常量 ====================

/**
 * Y-Sort 基数常量。
 * 排序键 = (gx + gy) * Z_BASE + gz
 * 确保 (gx + gy) 差异优先于 gz 差异。
 * @type {number}
 */
export const Z_BASE = 100;

/**
 * 排序键计算（纯函数）。
 *
 * 公式推导：
 * - 在 45° 等轴坐标系中，屏幕 Y 坐标 = (gx + gy) * TILE_HALF_H - gz * (TILE_HALF_H * 2)
 * - 屏幕 Y 越大（越靠下），对象应越晚绘制
 * - 因此排序键 = (gx + gy) * Z_BASE + gz
 * - Z_BASE 应 > 最大可能的 gz 值，使 (gx+gy) 作为主排序键
 *
 * @param {number} gx - 网格 X 坐标
 * @param {number} gy - 网格 Y 坐标
 * @param {number} [gz=0] - 高度层
 * @returns {number} 排序键，用于设置对象的 zIndex
 *
 * @example
 * ```javascript
 * import { getSortKey } from './SortManager.mjs';
 *
 * // 方块在 (3, 5, 0) → sortKey = (3+5)*100 + 0 = 800
 * block.zIndex = getSortKey(3, 5, 0);
 *
 * // 角色在 (10, 7) → sortKey = (10+7)*100 + 0 = 1700
 * character.zIndex = getSortKey(10, 7);
 * ```
 */
export function getSortKey(gx, gy, gz = 0) {
    return (gx + gy) * Z_BASE + gz;
}

/** 图层类型枚举 */
export const LayerType = Object.freeze({
    /** 静态层：仅脏时排序，适用于方块等不经常移动的对象 */
    STATIC: 'static',
    /** 动态层：每帧自动排序，适用于角色、特效等频繁移动的对象 */
    DYNAMIC: 'dynamic'
});

/**
 * 默认层类型分配（索引 0~7 → 类型）。
 *
 * 分配依据：
 * | 索引 | 层名        | 类型      | 理由                         |
 * |------|-------------|-----------|------------------------------|
 * | 0    | Sky         | STATIC    | 远景几乎不动                 |
 * | 1    | Ground      | STATIC    | 数千方块，只排一次           |
 * | 2    | Structures  | STATIC    | 同上                         |
 * | 3    | Decorations | STATIC    | 同上（生长动画可改为dynamic）|
 * | 4    | Characters  | DYNAMIC   | 玩家/NPC 每帧移动            |
 * | 5    | Effects     | DYNAMIC   | 粒子持续生成/消失            |
 * | 6    | Shadows     | DYNAMIC   | 跟随角色移动                 |
 * | 7    | UI          | DYNAMIC   | 固定不动，统一处理           |
 *
 * @type {ReadonlyArray<string>}
 */
export const DEFAULT_LAYER_TYPES = Object.freeze([
    LayerType.STATIC,   // 0  Sky
    LayerType.STATIC,   // 1  Ground
    LayerType.STATIC,   // 2  Structures
    LayerType.STATIC,   // 3  Decorations
    LayerType.DYNAMIC,  // 4  Characters
    LayerType.DYNAMIC,  // 5  Effects
    LayerType.DYNAMIC,  // 6  Shadows
    LayerType.DYNAMIC   // 7  UI
]);

// ==================== SortManager 类 ====================

/**
 * Y-Sort 排序管理器。
 *
 * 管理 8 个图层的排序策略，优化大面积静态场景（数千方块）的排序性能。
 *
 * @example
 * ```javascript
 * import { SortManager, getSortKey, DEFAULT_LAYER_TYPES } from './SortManager.mjs';
 *
 * const sortManager = new SortManager(layerStack);
 *
 * // 应用层类型
 * for (let i = 0; i < DEFAULT_LAYER_TYPES.length; i++) {
 *     layerStack.setLayerType(i, DEFAULT_LAYER_TYPES[i]);
 * }
 *
 * // 每帧渲染前调用
 * sortManager.tick();
 *
 * // 方块放置或移动后标记脏
 * sortManager.markDirty(1); // Ground 层
 * ```
 */
export class SortManager {
    /**
     * 绑定 LayerStack 并初始化脏标记数组。
     *
     * @param {import('./LayerStack.mjs').LayerStack} layerStack - 图层管理栈
     * @param {ReadonlyArray<string>} [layerTypes=DEFAULT_LAYER_TYPES] - 每层的类型
     */
    constructor(layerStack, layerTypes = DEFAULT_LAYER_TYPES) {
        /** @private @type {import('./LayerStack.mjs').LayerStack} */
        this._layerStack = layerStack;

        /** @private @type {ReadonlyArray<string>} */
        this._layerTypes = layerTypes;

        /**
         * 脏标记数组（true 表示该层需要重排）。
         * @private @type {boolean[]}
         */
        this._dirty = new Array(layerTypes.length).fill(false);

        /**
         * 是否已销毁。
         * @private @type {boolean}
         */
        this._destroyed = false;
    }

    /**
     * 标记指定图层为"脏"——内容发生变化，需要重新排序。
     *
     * 仅对 STATIC 层有效；DYNAMIC 层忽略此调用（它们每帧自动排序）。
     *
     * @param {number} layerIndex - 图层索引 (0~7)
     *
     * @example
     * ```javascript
     * // 在 BlockRenderer 放置方块后标记 Ground 层为脏
     * sortManager.markDirty(1);
     * ```
     */
    markDirty(layerIndex) {
        if (this._destroyed) return;

        const type = this._layerTypes[layerIndex];
        if (type === LayerType.STATIC) {
            this._dirty[layerIndex] = true;
        }
        // DYNAMIC 层忽略——它们已经在 render 阶段自动排序
    }

    /**
     * 在每帧渲染前调用，执行排序。
     *
     * 排序时机在 camera.update() 之后、adapter.render() 之前，
     * 确保渲染时所有图层内容按正确的 Y 顺序排列。
     *
     * - STATIC 层：仅当 `_dirty[i] === true` 时调用 `sortChildren()`
     *   然后清除脏标记。实现上临时启用 sortableChildren 以调用原生排序，
     *   排序后立即恢复为 false 以防 render 阶段重复排序。
     * - DYNAMIC 层：由 PixiJS 的 `sortableChildren = true` 在 render 阶段
     *   自动处理，tick() 中不做额外操作。
     *
     * 性能说明：
     * - 静态层（~5000 方块）：仅方块放置/破坏时排序一次，正常帧 O(1)
     * - 动态层（~50 角色/特效）：PixiJS 每帧自动排序，O(n log n) ~ 微秒级
     */
    tick() {
        if (this._destroyed) return;

        const count = this._dirty.length;

        for (let i = 0; i < count; i++) {
            const type = this._layerTypes[i];

            if (type === LayerType.STATIC && this._dirty[i]) {
                // 静态层脏时：临时启用排序 → 排序 → 恢复禁用
                const container = this._layerStack.getLayer(i);
                container.sortableChildren = true;
                container.sortChildren();
                container.sortableChildren = false;
                this._dirty[i] = false;
            }
            // DYNAMIC 层：sortableChildren = true 已在 setLayerType 中设置，
            // PixiJS 在 render 阶段的 updateTransform() 中自动排序
        }
    }

    /**
     * 销毁管理器，清空脏标记。
     *
     * 销毁后所有公开方法变为安全空操作。
     */
    destroy() {
        this._dirty = [];
        this._destroyed = true;
    }
}
