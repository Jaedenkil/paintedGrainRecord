// @ts-check

/**
 * @fileoverview 键盘适配器——监听 keydown/keyup，提供逐帧按键状态查询。
 * 使用 KeyboardEvent.code（物理键位），不受键盘布局影响。
 * 窗口 blur 时自动重置所有键位防止粘键。
 * @module input/KeyboardAdapter
 */

import { InputAdapter } from './InputAdapter.mjs';

/**
 * @typedef {Object} KeyState
 * @property {boolean} down 当前帧是否按住
 * @property {boolean} pressed 本帧刚按下（瞬态）
 * @property {boolean} released 本帧刚释放（瞬态）
 */

export class KeyboardAdapter extends InputAdapter {
    constructor() {
        super();
        /** @private @type {Map<string, KeyState>} */ this._keys = new Map();
        /** @private @type {Function} */ this._onKeyDown = null;
        /** @private @type {Function} */ this._onKeyUp = null;
        /** @private @type {Function} */ this._onBlur = null;
    }

    /**
     * @param {EventTarget} target
     */
    startListeners(target) {
        super.startListeners(target);
        this._onKeyDown = (/** @type {KeyboardEvent} */ e) => {
            // 避免页面默认行为（如 Space 滚动、F5 刷新）
            if (e.code.startsWith('Key') || e.code.startsWith('Digit') || e.code === 'Space'
                || e.code.startsWith('Arrow') || e.code.startsWith('Numpad')) {
                e.preventDefault();
            }
            const state = this._getOrCreate(e.code);
            if (!state.down) {
                state.down = true;
                state.pressed = true;
            }
        };
        this._onKeyUp = (/** @type {KeyboardEvent} */ e) => {
            e.preventDefault();
            const state = this._keys.get(e.code);
            if (state && state.down) {
                state.down = false;
                state.released = true;
            }
        };
        this._onBlur = () => { this._resetAll(); };

        this._target.addEventListener('keydown', this._onKeyDown);
        this._target.addEventListener('keyup', this._onKeyUp);
        this._target.addEventListener('blur', this._onBlur);
    }

    stopListeners() {
        if (!this._target) return;
        this._target.removeEventListener('keydown', this._onKeyDown);
        this._target.removeEventListener('keyup', this._onKeyUp);
        this._target.removeEventListener('blur', this._onBlur);
        this._onKeyDown = null;
        this._onKeyUp = null;
        this._onBlur = null;
        super.stopListeners();
    }

    /** 键盘适配器无需 update 阶段额外操作（状态由事件实时驱动）。*/
    update() { /* 事件驱动，无须额外轮询 */ }

    /** 重置瞬态标记。*/
    reset() {
        for (const state of this._keys.values()) {
            state.pressed = false;
            state.released = false;
        }
    }

    /**
     * 指定键当前是否按住。
     * @param {string} code KeyboardEvent.code 格式，如 'KeyA'
     * @returns {boolean}
     */
    isDown(code) {
        const state = this._keys.get(code);
        return state ? state.down : false;
    }

    /**
     * 指定键本帧是否刚按下（瞬态）。
     * @param {string} code
     * @returns {boolean}
     */
    isPressed(code) {
        const state = this._keys.get(code);
        return state ? state.pressed : false;
    }

    /**
     * 指定键本帧是否刚释放（瞬态）。
     * @param {string} code
     * @returns {boolean}
     */
    isReleased(code) {
        const state = this._keys.get(code);
        return state ? state.released : false;
    }

    /**
     * 获取当前所有按下的键名。
     * @returns {string[]}
     */
    getActiveKeys() {
        const active = [];
        for (const [code, state] of this._keys) {
            if (state.down) active.push(code);
        }
        return active;
    }

    /** @private */
    _getOrCreate(code) {
        let state = this._keys.get(code);
        if (!state) {
            state = { down: false, pressed: false, released: false };
            this._keys.set(code, state);
        }
        return state;
    }

    /** @private 窗口失焦时重置全部。*/
    _resetAll() {
        for (const state of this._keys.values()) {
            if (state.down) {
                state.down = false;
                state.released = true;
            }
        }
    }
}
