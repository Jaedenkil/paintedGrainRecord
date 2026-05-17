// @ts-check

/**
 * @fileoverview ECS World —— 实体、组件、系统的顶层容器和协调者。
 *
 * World 串联了三者的生命周期：
 * 1. createEntity() → 委托 EntityManager 分配 ID
 * 2. addComponent() / getComponent() / removeComponent() → 委托 ComponentManager
 * 3. addSystem() / update(dt) → 按签名查询实体 → 调用 System.update()
 *
 * 每帧只需调用 world.update(dt)，系统会自动处理所有匹配的实体。
 *
 * @module ecs/World
 */

import { EntityManager } from './EntityManager.mjs';
import { ComponentManager } from './ComponentManager.mjs';

export class World {
    constructor() {
        /** @private @type {EntityManager} */ this._entities = new EntityManager();
        /** @private @type {ComponentManager} */ this._components = new ComponentManager();
        /** @private @type {import('./System.mjs').System[]} */ this._systems = [];
        /** @private @type {boolean} */ this._destroyed = false;
    }

    // ═══════════════ 实体管理 ═══════════════

    /**
     * 创建一个新实体。
     * @returns {number} 实体 ID
     */
    createEntity() { return this._entities.create(); }

    /**
     * 销毁实体，移除其所有组件。
     * @param {number} id
     */
    destroyEntity(id) {
        if (!this._entities.activeEntities.has(id)) return;
        this._components.removeEntity(id);
        this._entities.destroy(id);
    }

    /** @returns {number} 当前活跃实体数 */
    get entityCount() { return this._entities.alive; }

    // ═══════════════ 组件管理 ═══════════════

    /**
     * 为实体添加组件数据。
     * @param {number} entityId
     * @param {string} componentName
     * @param {object} data
     */
    addComponent(entityId, componentName, data) {
        this._components.add(entityId, componentName, data);
    }

    /**
     * 获取实体的组件数据。
     * @param {number} entityId
     * @param {string} componentName
     * @returns {object|null}
     */
    getComponent(entityId, componentName) {
        return this._components.get(entityId, componentName);
    }

    /**
     * 检查实体是否拥有指定组件。
     * @param {number} entityId
     * @param {string} componentName
     * @returns {boolean}
     */
    hasComponent(entityId, componentName) {
        return this._components.has(entityId, componentName);
    }

    /**
     * 移除实体的指定组件。
     * @param {number} entityId
     * @param {string} componentName
     */
    removeComponent(entityId, componentName) {
        this._components.remove(entityId, componentName);
    }

    /**
     * 查询同时拥有所有指定组件的实体 ID 列表。
     * @param {...string} componentNames
     * @returns {number[]}
     */
    query(...componentNames) {
        return this._components.query(...componentNames);
    }

    /** @returns {{ typeCount: number, totalInstances: number }} */
    get componentStats() { return this._components.stats; }

    // ═══════════════ 系统管理 ═══════════════

    /**
     * 注册系统。系统 will 在每帧 update() 中被调用。
     * 自动设置 system.world 引用。
     * @param {import('./System.mjs').System} system
     */
    addSystem(system) {
        if (this._systems.includes(system)) return;
        system.world = this;
        this._systems.push(system);
    }

    /**
     * 移除已注册的系统。
     * @param {import('./System.mjs').System} system
     */
    removeSystem(system) {
        const idx = this._systems.indexOf(system);
        if (idx !== -1) {
            system.world = null;
            this._systems.splice(idx, 1);
        }
    }

    /**
     * 获取所有已注册的系统（只读）。
     * @returns {ReadonlyArray<import('./System.mjs').System>}
     */
    get systems() { return this._systems; }

    // ═══════════════ 生命周期 ═══════════════

    /**
     * 每帧调用一次，驱动所有系统。
     * 对每个系统，先按签名查询匹配实体，再调用 system.update()。
     * @param {number} dt 固定步长时间增量（秒）
     */
    update(dt) {
        if (this._destroyed) return;
        for (const system of this._systems) {
            const entities = this._components.query(...system.signature);
            system.update(entities, dt);
        }
    }

    /** 销毁 World，清空所有实体、组件和系统。*/
    destroy() {
        this._destroyed = true;
        for (const system of this._systems) {
            system.world = null;
        }
        this._systems = [];
        this._components.reset();
        this._entities.reset();
    }
}
