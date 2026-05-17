// @ts-check

/**
 * @fileoverview 引擎入口——GameLoop/EventBus 的编排层。协调生命周期、插件注册、引擎级事件。
 * @module core/Engine
 */
import { EventBus } from './EventBus.mjs';
import { GameLoop } from './GameLoop.mjs';
import { InputModule } from '../input/InputModule.mjs';
import { SceneManager } from '../scene/SceneManager.mjs';
import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('Engine');

/**
 * 引擎状态枚举
 * @readonly @enum {string}
 */
const EngineState = {
    CREATED: 'created', INITIALIZED: 'initialized', RUNNING: 'running',
    PAUSED: 'paused', STOPPED: 'stopped', DESTROYED: 'destroyed'
};

/**
 * 引擎插件
 * @typedef {Object} EnginePlugin
 * @property {(engine: Engine) => void} install
 * @property {string} [name]
 */

export class Engine {
    constructor() {
        /** @private @type {string} */ this._state = EngineState.CREATED;
        /** @type {EventBus} */ this.eventBus = EventBus.getInstance();
        /** @type {GameLoop} */ this.loop = new GameLoop();
        /** @type {InputModule} */ this.input = new InputModule();
        /** @type {SceneManager} */ this.scenes = new SceneManager(this);
        /** @private @type {EnginePlugin[]} */ this._plugins = [];
        /** @private @type {Object<string, Promise<any>>} */ this._pluginInitPromises = {};
        /** @type {{ name: string, version: string }} */ this.info = { name: 'PaintedGrainEngine', version: '0.1.0' };
        /** @private @type {Function} */ this._onBeforeFixedUpdate = null;
        /** @private @type {Function} */ this._onAfterFixedUpdate = null;
        log.info(`引擎实例已创建 (${this.info.name} v${this.info.version})`);
    }

    /** 初始化引擎，启动输入监听，注册 tick 钩子。@returns {this} */
    init() {
        if (this._state !== EngineState.CREATED) { log.warn(`init() 在 "${this._state}" 下调⽤，忽忽略`); return this; }
        this._state = EngineState.INITIALIZED;
        this.loop.addSystem({ type: 'fixed', name: 'SceneManager', update: (dt) => this.scenes.update(dt) });
        this.input.start();
        this._onBeforeFixedUpdate = () => { this.input.update(); };
        this._onAfterFixedUpdate = () => { this.input.endFrame(); };
        this.eventBus.on('engine:before-fixed-update', this._onBeforeFixedUpdate);
        this.eventBus.on('engine:after-fixed-update', this._onAfterFixedUpdate);
        log.info('引擎初始化完成，状态 → INITIALIZED');
        this.eventBus.emit('engine:init', { info: this.info });
        return this;
    }

    /** 启动游戏循环。@returns {this} */
    start() {
        if (this._state === EngineState.DESTROYED) throw new Error('[Engine] 引擎已销毁，无法启动');
        if (this._state === EngineState.CREATED) this.init();
        this._state = EngineState.RUNNING;
        log.info('引擎启动，状态 → RUNNING');
        this.eventBus.emit('engine:start', {});
        this.loop.start();
        return this;
    }

    /** 停止游戏循环。@returns {this} */
    stop() {
        if (this._state === EngineState.STOPPED || this._state === EngineState.DESTROYED) return this;
        this.loop.stop();
        this._state = EngineState.STOPPED;
        log.info('引擎已停止，状态 → STOPPED');
        this.eventBus.emit('engine:stop', {});
        return this;
    }

    /** 暂停游戏循环。@returns {this} */
    pause() {
        if (this._state !== EngineState.RUNNING) return this;
        this.loop.pause();
        this._state = EngineState.PAUSED;
        log.info('引擎已暂停，状态 → PAUSED');
        return this;
    }

    /** 恢复游戏循环。@returns {this} */
    resume() {
        if (this._state !== EngineState.PAUSED) return this;
        this.loop.resume();
        this._state = EngineState.RUNNING;
        log.info('引擎已恢复，状态 → RUNNING');
        return this;
    }

    /**
     * 注册引擎插件。
     * @param {EnginePlugin} plugin 需含 install() 方法
     * @returns {this}
     */
    use(plugin) {
        if (typeof plugin.install !== 'function') throw new TypeError('[Engine] 插件须含 install()');
        if (this._plugins.includes(plugin)) { log.warn(`插件 "${plugin.name || '(unnamed)'}" 已注册，忽略`); return this; }
        this._plugins.push(plugin);
        log.info(`插件已注册: "${plugin.name || '(unnamed)'}"`);
        plugin.install(this);
        return this;
    }

    /** @param {string} name @param {Promise<any>} promise @returns {this} */
    registerPluginInitPromise(name, promise) { this._pluginInitPromises[name] = promise; return this; }

    /** @param {string} name @returns {Promise<any>|undefined} */
    getPluginInitPromise(name) { return this._pluginInitPromises[name]; }

    /** 销毁引擎，释放所有资源（包括输入监听、场景管理器）。销毁后不可再用。 */
    destroy() {
        if (this._state === EngineState.DESTROYED) return;
        log.info('引擎正在销毁...');
        this.loop.stop();
        if (this._onBeforeFixedUpdate) { this.eventBus.off('engine:before-fixed-update', this._onBeforeFixedUpdate); this._onBeforeFixedUpdate = null; }
        if (this._onAfterFixedUpdate) { this.eventBus.off('engine:after-fixed-update', this._onAfterFixedUpdate); this._onAfterFixedUpdate = null; }
        this.scenes.destroy();
        this.input.destroy();
        this.eventBus.emit('engine:destroy', {});
        this.eventBus.clear();
        this._plugins = [];
        this._state = EngineState.DESTROYED;
        log.info('引擎已销毁');
    }

    /** @type {import('./Time.mjs').Time} */ get time() { return this.loop.time; }
    /** @type {string} */ get state() { return this._state; }
    /** @type {boolean} */ get isRunning() { return this._state === EngineState.RUNNING; }
    /** @type {boolean} */ get isPaused() { return this._state === EngineState.PAUSED; }
    /** @type {boolean} */ get isDestroyed() { return this._state === EngineState.DESTROYED; }
}

export { EngineState };
