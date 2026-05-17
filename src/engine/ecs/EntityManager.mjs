// @ts-check

/**
 * @fileoverview 实体 ID 管理器 —— 负责分配和回收实体 ID。
 *
 * Entity 仅仅是整数 ID，不包含任何数据。
 * 实体被销毁时 ID 进入回收池，优先复用。
 *
 * @module ecs/EntityManager
 */

export class EntityManager {
    constructor() {
        /** @private @type {number} */ this._nextId = 1;
        /** @private @type {number[]} */ this._freeIds = [];
        /** @private @type {Set<number>} */ this._active = new Set();
    }

    /**
     * 创建一个新实体，返回唯一 ID。
     * 优先复用已销毁实体的 ID。
     * @returns {number} 新实体 ID
     * @example
     * const em = new EntityManager();
     * const e1 = em.create(); // 1
     * const e2 = em.create(); // 2
     */
    create() {
        const id = this._freeIds.length > 0
            ? /** @type {number} */ (this._freeIds.pop())
            : this._nextId++;
        this._active.add(id);
        return id;
    }

    /**
     * 销毁实体，回收 ID。
     * @param {number} id
     * @example
     * em.destroy(e1);
     * const e3 = em.create(); // 复用 e1 的 ID
     */
    destroy(id) {
        if (!this._active.has(id)) return;
        this._active.delete(id);
        this._freeIds.push(id);
    }

    /**
     * 当前活跃实体数。
     * @returns {number}
     */
    get alive() { return this._active.size; }

    /**
     * 当前所有活跃实体 ID 的集合（只读视图）。
     * @returns {ReadonlySet<number>}
     */
    get activeEntities() { return this._active; }

    /** 清空所有实体和回收池。*/
    reset() {
        this._nextId = 1;
        this._freeIds = [];
        this._active.clear();
    }
}
