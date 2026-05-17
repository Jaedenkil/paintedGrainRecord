// @ts-check

/**
 * @fileoverview 场景管理器——栈式场景管理。
 * 支持懒加载工厂（register）、压栈（push）、出栈（pop）、替换（replace）。
 * 通过 EventBus 发射 scene:entered / scene:exited 事件。
 * 由 Engine 注册为 GameSystem，每帧 fixedUpdate 驱动当前场景。
 * @module scene/SceneManager
 */

import { EventBus } from '../core/EventBus.mjs';
import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('SceneManager');

export class SceneManager {
    /**
     * @param {import('../core/Engine.mjs').Engine} engine
     */
    constructor(engine) {
        /** @private @type {import('../core/Engine.mjs').Engine} */ this._engine = engine;
        /** @private @type {Array<import('./Scene.mjs').Scene>} */ this._stack = [];
        /** @private @type {Map<string, () => import('./Scene.mjs').Scene>} */ this._factories = new Map();
        /** @private @type {Map<string, import('./Scene.mjs').Scene>} */ this._cache = new Map();
        /** @private */ this._destroyed = false;
    }

    /**
     * 注册场景工厂。场景在首次 push 时通过工厂创建。
     * @param {string} name
     * @param {() => import('./Scene.mjs').Scene} factory
     */
    register(name, factory) {
        if (this._factories.has(name)) { log.warn(`场景 "${name}" 已注册，覆盖`); }
        this._factories.set(name, factory);
    }

    /**
     * 切换到指定场景（压栈，当前场景暂停）。
     * @param {string} name
     * @param {*} [data]
     */
    push(name, data) {
        if (this._destroyed) return;
        const scene = this._getOrCreate(name);
        if (!scene) { log.error(`场景 "${name}" 未注册`); return; }

        if (this._stack.length > 0) {
            const current = this._stack[this._stack.length - 1];
            current.exit();
            EventBus.getInstance().emit('scene:exited', { name: current.name, next: name });
        }

        if (!scene.isInitialized) scene.init(data);

        this._stack.push(scene);
        scene.enter();
        EventBus.getInstance().emit('scene:entered', { name, data });
        log.info(`场景进入: "${name}" (栈深度 ${this._stack.length})`);
    }

    /**
     * 返回上一个场景（当前场景出栈并销毁）。
     */
    pop() {
        if (this._destroyed) return;
        if (this._stack.length <= 1) { log.warn('pop() 失败：栈中仅剩一个场景'); return; }

        const current = this._stack.pop();
        current.exit();
        current.destroy();
        this._cache.delete(current.name);
        EventBus.getInstance().emit('scene:exited', { name: current.name });

        const previous = this._stack[this._stack.length - 1];
        previous.enter();
        EventBus.getInstance().emit('scene:entered', { name: previous.name });
        log.info(`场景返回: "${current.name}" → "${previous.name}"`);
    }

    /**
     * 替换栈顶场景（不保留历史）。
     * @param {string} name
     * @param {*} [data]
     */
    replace(name, data) {
        if (this._destroyed) return;
        if (this._stack.length === 0) { this.push(name, data); return; }

        const current = this._stack.pop();
        current.exit();
        current.destroy();
        this._cache.delete(current.name);
        EventBus.getInstance().emit('scene:exited', { name: current.name });

        this.push(name, data);
        log.info(`场景替换: "${current.name}" → "${name}"`);
    }

    /**
     * 每帧由 GameLoop 的 fixedUpdate 调用，委托给当前活跃场景。
     * @param {number} dt
     */
    update(dt) {
        if (this._destroyed) return;
        const current = this._stack[this._stack.length - 1];
        if (current && current.isActive) current.update(dt);
    }

    /** 清空所有场景，释放资源。*/
    destroy() {
        this._destroyed = true;
        for (const scene of this._stack) {
            if (scene.isActive) scene.exit();
            scene.destroy();
        }
        this._stack = [];
        this._factories.clear();
        this._cache.clear();
        log.info('场景管理器已销毁');
    }

    /** @returns {import('./Scene.mjs').Scene|null} */ get current() {
        return this._stack.length > 0 ? this._stack[this._stack.length - 1] : null;
    }
    /** @returns {number} */ get depth() { return this._stack.length; }

    /** @private @param {string} name @returns {import('./Scene.mjs').Scene|null} */
    _getOrCreate(name) {
        if (this._cache.has(name)) return this._cache.get(name);
        const factory = this._factories.get(name);
        if (!factory) return null;
        const scene = factory();
        this._cache.set(name, scene);
        return scene;
    }
}
