// @ts-check

/**
 * @fileoverview
 * 引擎入口 - 核心控制器的"总电源开关"。
 *
 * Engine 是 GameLoop / EventBus / Time 的编排层，职责：
 * - 协调生命周期：create → init → start → pause/resume → stop → destroy
 * - 暴露统一的 `eventBus`、`loop`、`time` 访问点
 * - 提供插件注册机制（`engine.use(plugin)`）
 * - 发射引擎级生命周期事件
 *
 * 设计原则：
 * - 不包装 GameLoop 的 API，直接委托
 * - 插件系统保持最小接口（一个 install 函数即可）
 * - 核心模块间的依赖通过 Engine 注入，不直接互相引用
 *
 * @module core/Engine
 */

import { EventBus } from './EventBus.js';
import { GameLoop } from './GameLoop.js';

/**
 * 引擎状态枚举
 * @readonly
 * @enum {string}
 */
const EngineState = {
    CREATED: 'created',
    INITIALIZED: 'initialized',
    RUNNING: 'running',
    PAUSED: 'paused',
    STOPPED: 'stopped',
    DESTROYED: 'destroyed'
};

/**
 * 引擎插件
 * @typedef {Object} EnginePlugin
 * @property {(engine: Engine) => void} install - 安装插件（接收引擎实例）
 * @property {string} [name] - 插件名称（调试用）
 */

/**
 * 引擎主控类
 *
 * @example
 * ```javascript
 * import { Engine } from './Engine.js';
 *
 * const engine = new Engine();
 *
 * // 注册系统
 * engine.loop.addSystem({
 *     type: 'fixed',
 *     name: 'Physics',
 *     update: (dt) => { /* 物理更新 *\/ }
 * });
 *
 * // 启动引擎
 * engine.start();
 *
 * // 暂停/恢复
 * engine.pause();
 * engine.resume();
 *
 * // 停止
 * engine.stop();
 * ```
 */
export class Engine {
    constructor() {
        /** @private @type {string} */
        this._state = EngineState.CREATED;

        /**
         * 事件总线实例（只读）
         * @type {EventBus}
         */
        this.eventBus = EventBus.getInstance();

        /**
         * 游戏主循环实例（只读）
         * @type {GameLoop}
         */
        this.loop = new GameLoop();

        /**
         * 已注册的插件列表
         * @private @type {EnginePlugin[]}
         */
        this._plugins = [];

        /**
         * 引擎名称/版本标识
         * @type {{ name: string, version: string }}
         */
        this.info = {
            name: 'PaintedGrainEngine',
            version: '0.1.0'
        };
    }

    /**
     * 初始化引擎（发射 engine:init 事件）
     * 在 start() 前调用，用于插件自注册等准备工作。
     *
     * @returns {this}
     *
     * @example
     * ```javascript
     * const engine = new Engine();
     * engine.init();
     * // 此时可以安全访问 eventBus、loop、time
     * ```
     */
    init() {
        if (this._state !== EngineState.CREATED) {
            console.warn(`[Engine] init() 在状态 "${this._state}" 下调用，忽略`);
            return this;
        }

        this._state = EngineState.INITIALIZED;
        this.eventBus.emit('engine:init', {
            info: this.info
        });

        return this;
    }

    /**
     * 启动游戏循环
     *
     * @returns {this}
     *
     * @example
     * ```javascript
     * engine.start();
     * ```
     */
    start() {
        if (this._state === EngineState.DESTROYED) {
            throw new Error('[Engine] 引擎已销毁，无法启动');
        }

        // 如果尚未 init，自动 init
        if (this._state === EngineState.CREATED) {
            this.init();
        }

        this._state = EngineState.RUNNING;
        this.eventBus.emit('engine:start', {});
        this.loop.start();

        return this;
    }

    /**
     * 停止游戏循环。停止后不可恢复，需重新 start()。
     *
     * @returns {this}
     */
    stop() {
        if (this._state === EngineState.STOPPED || this._state === EngineState.DESTROYED) {
            return this;
        }

        this.loop.stop();
        this._state = EngineState.STOPPED;
        this.eventBus.emit('engine:stop', {});

        return this;
    }

    /**
     * 暂停游戏循环（时间停止推进，但仍接收 RAF 回调）
     *
     * @returns {this}
     */
    pause() {
        if (this._state !== EngineState.RUNNING) return this;

        this.loop.pause();
        this._state = EngineState.PAUSED;

        return this;
    }

    /**
     * 恢复游戏循环
     *
     * @returns {this}
     */
    resume() {
        if (this._state !== EngineState.PAUSED) return this;

        this.loop.resume();
        this._state = EngineState.RUNNING;

        return this;
    }

    /**
     * 注册引擎插件
     *
     * @param {EnginePlugin} plugin - 插件对象（需包含 install 方法）
     * @returns {this}
     *
     * @example
     * ```javascript
     * const myPlugin = {
     *     name: 'StatsPanel',
     *     install: (engine) => {
     *         engine.eventBus.on('engine:tick-end', () => {
     *             // 更新统计面板
     *         });
     *     }
     * };
     *
     * engine.use(myPlugin);
     * ```
     */
    use(plugin) {
        if (typeof plugin.install !== 'function') {
            throw new TypeError('[Engine] 插件必须包含 install() 方法');
        }

        // 防止重复注册
        if (this._plugins.includes(plugin)) {
            console.warn(`[Engine] 插件 "${plugin.name || '(unnamed)'}" 已注册，忽略`);
            return this;
        }

        this._plugins.push(plugin);
        plugin.install(this);

        return this;
    }

    /**
     * 销毁引擎，释放所有资源。销毁后不可再使用。
     */
    destroy() {
        if (this._state === EngineState.DESTROYED) return;

        this.loop.stop();
        this.eventBus.emit('engine:destroy', {});
        this.eventBus.clear();
        this._plugins = [];
        this._state = EngineState.DESTROYED;
    }

    // ==================== 访问器 ====================

    /**
     * 时间管理器（GameLoop 内置的 Time 实例）
     * @type {import('./Time.js').Time}
     */
    get time() { return this.loop.time; }

    /**
     * 当前引擎状态
     * @type {string}
     */
    get state() { return this._state; }

    /**
     * 引擎是否正在运行
     * @type {boolean}
     */
    get isRunning() { return this._state === EngineState.RUNNING; }

    /**
     * 引擎是否已暂停
     * @type {boolean}
     */
    get isPaused() { return this._state === EngineState.PAUSED; }

    /**
     * 引擎是否已销毁
     * @type {boolean}
     */
    get isDestroyed() { return this._state === EngineState.DESTROYED; }
}

export { EngineState };
