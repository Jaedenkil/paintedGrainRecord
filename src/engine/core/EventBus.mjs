// @ts-check

/**
 * @fileoverview
 * 全局事件总线 - 引擎内所有模块间通信的唯一通道。
 *
 * 设计原则：
 * 1. 单例模式，全局唯一实例。
 * 2. 事件名采用命名空间格式：`module:action`（如 `player:damaged`、`block:placed`）。
 * 3. 支持通配符监听：`block:*` 监听某模块所有事件，`*` 监听全局所有事件。
 * 4. 监听器可绑定 `context`（上下文对象），支持按上下文批量清理。
 * 5. 所有监听器必须在模块销毁时解绑，防止幽灵回调。
 *
 * @module core/EventBus
 */

/**
 * 监听器条目
 * @typedef {Object} ListenerEntry
 * @property {Function} callback - 回调函数
 * @property {Object|null} context - 绑定的上下文对象
 */

/**
 * 全局事件总线
 *
 * @example
 * ```javascript
 * import { EventBus } from './EventBus.js';
 *
 * // 监听
 * const unsub = EventBus.instance.on('player:damaged', (data) => {
 *     console.log(`玩家受到 ${data.amount} 点伤害`);
 * }, this);
 *
 * // 发射
 * EventBus.instance.emit('player:damaged', { amount: 10 });
 *
 * // 单次监听
 * EventBus.instance.once('scene:ready', () => startGame());
 *
 * // 批量清理（场景销毁时调用）
 * EventBus.instance.removeContext(this);
 * ```
 */
import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('EventBus');

export class EventBus {
    /** @type {EventBus | null} */
    static #instance = null;

    /** @type {Map<string, Set<ListenerEntry>>} */
    #listeners;

    /** @type {Map<Object, Set<string>>} context → 事件名反向索引 */
    #contextBindings;

    /** @type {boolean} */
    #isDestroyed;

    constructor() {
        this.#listeners = new Map();
        this.#contextBindings = new Map();
        this.#isDestroyed = false;
    }

    /**
     * 获取 EventBus 唯一实例
     * @returns {EventBus}
     */
    static getInstance() {
        if (!EventBus.#instance) {
            EventBus.#instance = new EventBus();
        }
        return EventBus.#instance;
    }

    /**
     * 监听事件
     *
     * @param {string} event - 事件名，支持精确匹配（`player:damaged`）和通配符（`block:*`、`*`）
     * @param {Function} callback - 回调函数 `(data: any) => void`
     * @param {Object|null} [context=null] - 绑定的上下文对象，用于 `removeContext()` 批量清理
     * @returns {() => void} 取消监听的函数，调用后该监听器立即失效
     *
     * @example
     * ```javascript
     * // 精确监听
     * const unsub = EventBus.instance.on('player:damaged', onDamaged);
     *
     * // 通配符监听（所有资源事件）
     * EventBus.instance.on('resource:*', onResourceEvent);
     *
     * // 带上下文的监听（推荐）
     * EventBus.instance.on('block:placed', onBlockPlaced, this);
     *
     * // 取消监听
     * unsub();
     * ```
     */
    on(event, callback, context = null) {
        if (this.#isDestroyed) {
            log.warn('实例已销毁，无法注册新监听器');
            return () => {};
        }

        if (typeof callback !== 'function') {
            throw new TypeError('[EventBus] callback 必须是函数');
        }

        if (!this.#listeners.has(event)) {
            this.#listeners.set(event, new Set());
        }

        const listeners = /** @type {Set<ListenerEntry>} */ (this.#listeners.get(event));
        /** @type {ListenerEntry} */
        const entry = { callback, context };
        listeners.add(entry);

        // 记录上下文反向索引
        if (context !== null) {
            if (!this.#contextBindings.has(context)) {
                this.#contextBindings.set(context, new Set());
            }
            const binding = /** @type {Set<string>} */ (this.#contextBindings.get(context));
            binding.add(event);
        }

        // 返回解绑函数
        return () => this.off(event, callback);
    }

    /**
     * 一次性监听事件。触发后自动取消注册。
     *
     * @param {string} event - 事件名
     * @param {Function} callback - 回调函数 `(data: any) => void`
     * @param {Object|null} [context=null] - 绑定的上下文对象
     * @returns {() => void} 取消监听的函数
     *
     * @example
     * ```javascript
     * EventBus.instance.once('scene:ready', () => {
     *     console.log('场景加载完成，只触发一次');
     * });
     * ```
     */
    once(event, callback, context = null) {
        const wrapper = (/** @type {*} */ data) => {
            this.off(event, wrapper);
            callback(data);
        };
        return this.on(event, wrapper, context);
    }

    /**
     * 取消指定事件上的某个监听器。
     *
     * @param {string} event - 事件名
     * @param {Function} callback - 要移除的回调函数
     *
     * @example
     * ```javascript
     * EventBus.instance.off('player:damaged', onDamaged);
     * ```
     */
    off(event, callback) {
        const listeners = this.#listeners.get(event);
        if (!listeners) return;

        for (const entry of listeners) {
            if (entry.callback === callback) {
                listeners.delete(entry);
                break;
            }
        }

        // 清理空集合
        if (listeners.size === 0) {
            this.#listeners.delete(event);
        }
    }

    /**
     * 发射事件。同时触发：
     * 1. 精确匹配的监听器（`block:placed`）
     * 2. 模块通配符监听器（`block:*`）
     * 3. 全局通配符监听器（`*`）
     *
     * @param {string} event - 事件名
     * @param {*} [data=null] - 事件数据
     *
     * @example
     * ```javascript
     * EventBus.instance.emit('player:damaged', { amount: 10, source: 'goblin' });
     * ```
     */
    emit(event, data = null) {
        if (this.#isDestroyed) return;

        if (typeof event !== 'string' || event.length === 0) {
            log.warn('事件名必须是非空字符串');
            return;
        }

        // 1. 精确匹配
        this.#dispatch(event, data);

        // 2. 模块通配符匹配：将 'block:placed' 映射为 'block:*'
        if (event.includes(':')) {
            const namespace = event.split(':')[0];
            const wildcard = `${namespace}:*`;
            if (wildcard !== event) {
                this.#dispatch(wildcard, { originalEvent: event, data });
            }
        }

        // 3. 全局通配符
        if (event !== '*') {
            this.#dispatch('*', { originalEvent: event, data });
        }
    }

    /**
     * 检查指定事件是否有任何监听器。
     *
     * @param {string} event - 事件名
     * @returns {boolean} 是否有监听器
     */
    hasListener(event) {
        const listeners = this.#listeners.get(event);
        return listeners !== undefined && listeners.size > 0;
    }

    /**
     * 获取指定事件的监听器数量。
     *
     * @param {string} event - 事件名
     * @returns {number} 监听器数量
     */
    listenerCount(event) {
        const listeners = this.#listeners.get(event);
        return listeners ? listeners.size : 0;
    }

    /**
     * 移除指定上下文对象关联的所有监听器。
     * 适用于场景/实体销毁时的批量清理。
     *
     * @param {Object} context - 注册监听器时传入的上下文对象
     *
     * @example
     * ```javascript
     * // 在场景的 destroy() 中
     * EventBus.instance.removeContext(this);
     * ```
     */
    removeContext(context) {
        const events = this.#contextBindings.get(context);
        if (!events) return;

        for (const event of events) {
            const listeners = this.#listeners.get(event);
            if (!listeners) continue;

            // 收集所有属于该上下文的条目，逐个移除
            // 注意：Set 使用引用相等比较，必须直接删除原条目对象
            const toRemove = [];
            for (const entry of listeners) {
                if (entry.context === context) {
                    toRemove.push(entry);
                }
            }
            for (const entry of toRemove) {
                listeners.delete(entry);
            }

            if (listeners.size === 0) {
                this.#listeners.delete(event);
            }
        }

        this.#contextBindings.delete(context);
    }

    /**
     * 清空所有监听器和上下文索引。
     * 通常只在引擎销毁时调用。
     */
    clear() {
        this.#listeners.clear();
        this.#contextBindings.clear();
    }

    /**
     * 销毁 EventBus 实例。
     * 清空所有监听器，标记为已销毁。
     * 销毁后不能再注册新监听器。
     */
    destroy() {
        this.clear();
        this.#isDestroyed = true;
        EventBus.#instance = null;
    }

    /**
     * 内部分发：遍历指定事件的所有监听器并调用。
     * 捕获回调中的异常，防止单个监听器崩溃影响其他监听器。
     *
     * @param {string} event - 事件名
     * @param {*} data - 事件数据
     */
    #dispatch(event, data) {
        const listeners = this.#listeners.get(event);
        if (!listeners) return;

        for (const entry of listeners) {
            try {
                entry.callback.call(entry.context, data);
            } catch (err) {
                log.error(`事件 "${event}" 的回调执行出错:`, err);
            }
        }
    }
}
