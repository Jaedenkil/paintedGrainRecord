// @ts-check

/**
 * @fileoverview 组件数据管理器 —— 按组件类型存储实体组件数据。
 *
 * 存储结构：Map<componentName, Map<entityId, data>>
 * - 外层 key = 组件类型名称（如 'Position', 'Velocity'）
 * - 内层 key = 实体 ID
 * - 内层 value = 组件数据（POJO）
 *
 * query(...names) 采用「取最小集合遍历」策略优化交集运算性能。
 *
 * @module ecs/ComponentManager
 */

export class ComponentManager {
    constructor() {
        /** @private @type {Map<string, Map<number, object>>} */
        this._stores = new Map();
    }

    /**
     * 注册组件类型。通常不必须（add 时会自动注册），
     * 但显式注册可提前建立存储结构。
     * @param {string} name
     */
    register(name) {
        if (!this._stores.has(name)) {
            this._stores.set(name, new Map());
        }
    }

    /**
     * 为实体添加（或更新）组件数据。
     * @param {number} entityId
     * @param {string} name 组件类型名
     * @param {object} data 组件数据
     * @example
     * cm.add(e1, 'Position', { x: 10, y: 20 });
     * cm.add(e1, 'Velocity', { vx: 5, vy: 0 });
     */
    add(entityId, name, data) {
        if (!this._stores.has(name)) {
            this._stores.set(name, new Map());
        }
        const store = /** @type {Map<number, object>} */ (this._stores.get(name));
        store.set(entityId, data);
    }

    /**
     * 获取实体的组件数据。
     * @param {number} entityId
     * @param {string} name
     * @returns {object|null} 组件数据的引用，不存在时返回 null
     */
    get(entityId, name) {
        const store = this._stores.get(name);
        if (!store) return null;
        return store.get(entityId) ?? null;
    }

    /**
     * 检查实体是否拥有某组件。
     * @param {number} entityId
     * @param {string} name
     * @returns {boolean}
     */
    has(entityId, name) {
        const store = this._stores.get(name);
        return store ? store.has(entityId) : false;
    }

    /**
     * 移除实体的组件。
     * @param {number} entityId
     * @param {string} name
     */
    remove(entityId, name) {
        const store = this._stores.get(name);
        if (store) store.delete(entityId);
    }

    /**
     * 移除实体的所有组件（实体销毁时调用）。
     * @param {number} entityId
     */
    removeEntity(entityId) {
        for (const store of this._stores.values()) {
            store.delete(entityId);
        }
    }

    /**
     * 查询同时拥有所有指定组件的实体 ID 列表。
     * 使用「取最小 Map 遍历」策略减少迭代次数。
     * @param {...string} names 组件类型名列表
     * @returns {number[]} 匹配的实体 ID 数组
     * @example
     * const moving = cm.query('Position', 'Velocity');
     * for (const id of moving) {
     *   const pos = cm.get(id, 'Position');
     *   const vel = cm.get(id, 'Velocity');
     *   pos.x += vel.vx;
     * }
     */
    query(...names) {
        if (names.length === 0) return [];

        const maps = /** @type {Map<number, object>[]} */ (
            names.map(n => this._stores.get(n)).filter(Boolean)
        );
        if (maps.length < names.length) return []; // 有未注册的组件类型

        // 取最小的 Map 作为遍历基准
        const smallestMap = maps.reduce((a, b) => (a.size <= b.size ? a : b));

        /** @type {number[]} */
        const result = [];
        for (const id of smallestMap.keys()) {
            if (names.every(n => /** @type {Map<number, object>} */ (this._stores.get(n)).has(id))) {
                result.push(id);
            }
        }
        return result;
    }

    /**
     * 获取某组件类型的所有实例。
     * @param {string} name
     * @returns {Map<number, object>} entityId → data 的 Map（只读引用）
     */
    getAll(name) {
        return this._stores.get(name) ?? new Map();
    }

    /** 清空所有组件数据。*/
    reset() {
        this._stores.clear();
    }

    /** @returns {{ typeCount: number, totalInstances: number }} */
    get stats() {
        let totalInstances = 0;
        for (const store of this._stores.values()) {
            totalInstances += store.size;
        }
        return { typeCount: this._stores.size, totalInstances };
    }
}
