// @ts-check

/**
 * @fileoverview 鼠标适配器——监听 mousedown/mouseup/mousemove/wheel/contextmenu。
 * 提供位置、delta、滚轮、按钮状态的逐帧查询。
 * @module input/MouseAdapter
 */

import { InputAdapter } from './InputAdapter.mjs';

/**
 * @typedef {Object} MouseButtonState
 * @property {boolean} down
 * @property {boolean} pressed
 * @property {boolean} released
 */

export class MouseAdapter extends InputAdapter {
    constructor() {
        super();
        /** @private */ this._x = 0;
        /** @private */ this._y = 0;
        /** @private */ this._dx = 0;
        /** @private */ this._dy = 0;
        /** @private */ this._scrollX = 0;
        /** @private */ this._scrollY = 0;
        /** @private @type {Map<number, MouseButtonState>} */ this._buttons = new Map();

        /** @private @type {Function|null} */ this._onMouseDown = null;
        /** @private @type {Function|null} */ this._onMouseUp = null;
        /** @private @type {Function|null} */ this._onMouseMove = null;
        /** @private @type {Function|null} */ this._onWheel = null;
        /** @private @type {Function|null} */ this._onContextMenu = null;
    }

    /**
     * @param {EventTarget} target
     */
    startListeners(target) {
        super.startListeners(target);
        this._onMouseDown = (/** @type {MouseEvent} */ e) => {
            const state = this._getOrCreate(e.button);
            if (!state.down) { state.down = true; state.pressed = true; }
        };
        this._onMouseUp = (/** @type {MouseEvent} */ e) => {
            const state = this._buttons.get(e.button);
            if (state && state.down) { state.down = false; state.released = true; }
        };
        this._onMouseMove = (/** @type {MouseEvent} */ e) => {
            this._dx += e.movementX;
            this._dy += e.movementY;
            this._x = e.clientX;
            this._y = e.clientY;
        };
        this._onWheel = (/** @type {WheelEvent} */ e) => {
            e.preventDefault();
            this._scrollX += e.deltaX;
            this._scrollY += e.deltaY;
        };
        this._onContextMenu = (/** @type {MouseEvent} */ e) => { e.preventDefault(); };

        this._target.addEventListener('mousedown', this._onMouseDown);
        this._target.addEventListener('mouseup', this._onMouseUp);
        this._target.addEventListener('mousemove', this._onMouseMove);
        this._target.addEventListener('wheel', this._onWheel, { passive: false });
        this._target.addEventListener('contextmenu', this._onContextMenu);
    }

    stopListeners() {
        if (!this._target) return;
        this._target.removeEventListener('mousedown', this._onMouseDown);
        this._target.removeEventListener('mouseup', this._onMouseUp);
        this._target.removeEventListener('mousemove', this._onMouseMove);
        this._target.removeEventListener('wheel', this._onWheel);
        this._target.removeEventListener('contextmenu', this._onContextMenu);
        this._onMouseDown = null;
        this._onMouseUp = null;
        this._onMouseMove = null;
        this._onWheel = null;
        this._onContextMenu = null;
        super.stopListeners();
    }

    /** 鼠标适配器无需额外轮询。*/
    update() {}

    /** 清除瞬态和 delta 累积。*/
    reset() {
        this._dx = 0;
        this._dy = 0;
        this._scrollX = 0;
        this._scrollY = 0;
        for (const state of this._buttons.values()) {
            state.pressed = false;
            state.released = false;
        }
    }

    /** @returns {number} */ get x() { return this._x; }
    /** @returns {number} */ get y() { return this._y; }
    /** @returns {{ dx: number, dy: number }} */ get delta() { return { dx: this._dx, dy: this._dy }; }
    /** @returns {{ dx: number, dy: number }} */ get scroll() { return { dx: this._scrollX, dy: this._scrollY }; }

    /**
     * 指定鼠标按钮是否按住。
     * @param {number} button 0=左键 1=中键 2=右键
     * @returns {boolean}
     */
    isDown(button) {
        const state = this._buttons.get(button);
        return state ? state.down : false;
    }

    /**
     * 指定鼠标按钮本帧是否刚按下。
     * @param {number} button
     * @returns {boolean}
     */
    isPressed(button) {
        const state = this._buttons.get(button);
        return state ? state.pressed : false;
    }

    /**
     * 指定鼠标按钮本帧是否刚释放。
     * @param {number} button
     * @returns {boolean}
     */
    isReleased(button) {
        const state = this._buttons.get(button);
        return state ? state.released : false;
    }

    /** @private */
    _getOrCreate(button) {
        let state = this._buttons.get(button);
        if (!state) {
            state = { down: false, pressed: false, released: false };
            this._buttons.set(button, state);
        }
        return state;
    }
}
