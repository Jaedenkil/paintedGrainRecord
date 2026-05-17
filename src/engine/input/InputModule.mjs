// @ts-check

/**
 * @fileoverview 输入系统编排器——整合 KeyboardAdapter、MouseAdapter、InputMapper。
 * 提供统一生命周期管理（update/endFrame/destroy），对外暴露 isDown/isPressed/isReleased API。
 * @module input/InputModule
 */

import { KeyboardAdapter } from './KeyboardAdapter.mjs';
import { MouseAdapter } from './MouseAdapter.mjs';
import { InputMapper } from './InputMapper.mjs';

export class InputModule {
    /**
     * @param {EventTarget} [target] 事件监听目标，默认使用 window（仅在浏览器/Electron 渲染进程中可用）
     */
    constructor(target = (typeof window !== 'undefined' ? window : null)) {
        /** @private @type {EventTarget|null} */ this._target = target;

        /** @type {KeyboardAdapter} */ this.keyboard = new KeyboardAdapter();
        /** @type {MouseAdapter} */ this.mouse = new MouseAdapter();
        /** @type {InputMapper} */ this.mapper = new InputMapper(this.keyboard, this.mouse);

        this._started = false;
    }

    /**
     * 启动输入监听。在 Engine.init() 或 start() 后调用。
     * 若无有效目标（Node.js 环境），静默跳过。
     */
    start() {
        if (this._started) return;
        if (!this._target) { this._started = true; return; }
        this.keyboard.startListeners(this._target);
        this.mouse.startListeners(this._target);
        this._started = true;
    }

    /**
     * 每帧在 fixedUpdate 之前调用。
     * 适配器无须额外轮询（事件驱动），但保留接口以支持未来 GamepadAdapter 等需要轮询的适配器。
     */
    update() {
        this.keyboard.update();
        this.mouse.update();
    }

    /**
     * 每帧在 fixedUpdate 之后调用。
     * 清空适配器的瞬态标记（pressed/released）。
     */
    endFrame() {
        this.keyboard.reset();
        this.mouse.reset();
    }

    /**
     * 绑定逻辑动作到物理输入。
     * 委托给 InputMapper。
     * @param {string} action
     * @param {import('./InputMapper.mjs').InputBinding} binding
     */
    bind(action, binding) { this.mapper.bind(action, binding); }

    /**
     * 解绑指定动作的所有绑定。
     * @param {string} action
     */
    unbind(action) { this.mapper.unbind(action); }

    /**
     * 清除所有绑定。
     */
    clearBindings() { this.mapper.clear(); }

    /**
     * 指定动作当前是否按住。
     * @param {string} action
     * @returns {boolean}
     */
    isDown(action) { return this.mapper.isDown(action); }

    /**
     * 指定动作本帧是否刚按下。
     * @param {string} action
     * @returns {boolean}
     */
    isPressed(action) { return this.mapper.isPressed(action); }

    /**
     * 指定动作本帧是否刚释放。
     * @param {string} action
     * @returns {boolean}
     */
    isReleased(action) { return this.mapper.isReleased(action); }

    /**
     * 销毁输入系统，移除所有 DOM 监听器。
     */
    destroy() {
        this.keyboard.destroy();
        this.mouse.destroy();
        this.mapper.clear();
        this._started = false;
    }
}
