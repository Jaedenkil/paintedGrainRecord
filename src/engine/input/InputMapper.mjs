// @ts-check

/**
 * @fileoverview 动作-物理输入映射器。将逻辑动作（如 "move_left"）绑定到物理输入（如 KeyA），
 * 提供 isDown/isPressed/isReleased 的抽象查询。
 * @module input/InputMapper
 */

/**
 * @typedef {'key'|'mouseButton'} InputBindingType
 */

/**
 * 输入绑定描述。
 * @typedef {Object} InputBinding
 * @property {InputBindingType} type
 * @property {string} [code] 仅 type='key' 时使用，KeyboardEvent.code 格式
 * @property {number} [button] 仅 type='mouseButton' 时使用（0=左 1=中 2=右）
 */

export class InputMapper {
    /**
     * @param {import('./KeyboardAdapter.mjs').KeyboardAdapter} keyboard
     * @param {import('./MouseAdapter.mjs').MouseAdapter} mouse
     */
    constructor(keyboard, mouse) {
        /** @private */ this._keyboard = keyboard;
        /** @private */ this._mouse = mouse;
        /** @private @type {Map<string, InputBinding[]>} */ this._bindings = new Map();
    }

    /**
     * 绑定逻辑动作到物理输入。
     * 支持绑定多个物理输入到同一动作（或逻辑或）。
     * @param {string} action 逻辑动作名，如 'move_left'、'jump'
     * @param {InputBinding} binding
     */
    bind(action, binding) {
        if (!this._bindings.has(action)) this._bindings.set(action, []);
        this._bindings.get(action).push(binding);
    }

    /**
     * 解绑指定动作的所有绑定。
     * @param {string} action
     */
    unbind(action) {
        this._bindings.delete(action);
    }

    /**
     * 清除所有绑定。
     */
    clear() {
        this._bindings.clear();
    }

    /**
     * 指定动作当前是否处于按住状态。
     * 支持的多绑定间为"或"关系。
     * @param {string} action
     * @returns {boolean}
     */
    isDown(action) {
        const bindings = this._bindings.get(action);
        if (!bindings || bindings.length === 0) return false;
        for (const b of bindings) {
            if (this._matchBinding(b, 'down')) return true;
        }
        return false;
    }

    /**
     * 指定动作本帧是否刚触发（从释放到按下）。
     * @param {string} action
     * @returns {boolean}
     */
    isPressed(action) {
        const bindings = this._bindings.get(action);
        if (!bindings || bindings.length === 0) return false;
        for (const b of bindings) {
            if (this._matchBinding(b, 'pressed')) return true;
        }
        return false;
    }

    /**
     * 指定动作本帧是否刚释放（从按下到释放）。
     * @param {string} action
     * @returns {boolean}
     */
    isReleased(action) {
        const bindings = this._bindings.get(action);
        if (!bindings || bindings.length === 0) return false;
        for (const b of bindings) {
            if (this._matchBinding(b, 'released')) return true;
        }
        return false;
    }

    /**
     * 获取所有已绑定的动作名。
     * @returns {string[]}
     */
    getActions() {
        return Array.from(this._bindings.keys());
    }

    /**
     * 获取指定动作的所有绑定。
     * @param {string} action
     * @returns {InputBinding[]}
     */
    getBindings(action) {
        return this._bindings.get(action) || [];
    }

    /**
     * @private
     * @param {InputBinding} binding
     * @param {'down'|'pressed'|'released'} state
     * @returns {boolean}
     */
    _matchBinding(binding, state) {
        if (binding.type === 'key') {
            if (state === 'down') return this._keyboard.isDown(binding.code);
            if (state === 'pressed') return this._keyboard.isPressed(binding.code);
            if (state === 'released') return this._keyboard.isReleased(binding.code);
        }
        if (binding.type === 'mouseButton') {
            if (state === 'down') return this._mouse.isDown(binding.button);
            if (state === 'pressed') return this._mouse.isPressed(binding.button);
            if (state === 'released') return this._mouse.isReleased(binding.button);
        }
        return false;
    }
}
