// @ts-check

/**
 * @fileoverview 系统基类 —— 定义 ECS 系统的标准接口。
 *
 * System 的职责是处理拥有特定组件签名（signature）的实体集合。
 * 子类覆盖 update(entities, dt) 实现具体逻辑。
 *
 * 典型用法：
 * ```js
 * class MovementSystem extends System {
 *   constructor() { super('Movement', ['Position', 'Velocity']); }
 *   update(entities, dt) {
 *     for (const id of entities) {
 *       const pos = this.world.getComponent(id, 'Position');
 *       const vel = this.world.getComponent(id, 'Velocity');
 *       pos.x += vel.vx * dt;
 *       pos.y += vel.vy * dt;
 *     }
 *   }
 * }
 * ```
 *
 * @module ecs/System
 */

export class System {
    /**
     * @param {string} name 系统唯一标识
     * @param {string[]} signature 组件签名——系统处理的实体必须拥有所有这些组件
     */
    constructor(name, signature) {
        /** @readonly @type {string} */ this.name = name;
        /** @readonly @type {string[]} */ this.signature = Object.freeze([...signature]);
        /**
         * 系统所属的 World 引用，由 World.addSystem() 自动设置。
         * @type {import('./World.mjs').World|null}
         */
        this.world = null;
    }

    /**
     * 每帧更新——处理匹配组件签名的实体集合。
     * 子类应覆盖此方法实现具体逻辑。
     * @param {number[]} entities 匹配组件签名的实体 ID 数组
     * @param {number} dt 固定步长时间增量（秒）
     */
    update(entities, dt) {
        // 默认空实现，子类覆盖
    }
}
