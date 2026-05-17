// @ts-check

/**
 * @fileoverview 输入适配器抽象基类。定义 DOM 事件绑定/解绑、帧状态快照/重置的生命周期。
 * @module input/InputAdapter
 */

export class InputAdapter {
    /**
     * 绑定 DOM 事件监听。
     * 子类应在此中调用 target.addEventListener()。
     * @param {EventTarget} target
     */
    startListeners(target) {
        if (this._target) return; // 防止重复绑定
        this._target = target;
    }

    /**
     * 移除 DOM 事件监听。
     * 子类应在此中调用 target.removeEventListener()。
     */
    stopListeners() {
        this._target = null;
    }

    /**
     * 快照当前帧的原始输入状态。
     * 在 fixedUpdate 之前由 InputModule 调用。
     */
    update() {}

    /**
     * 清空瞬态状态（pressed / released）。
     * 在 fixedUpdate 之后由 InputModule 调用。
     */
    reset() {}

    /** 销毁适配器，移除所有监听。*/
    destroy() {
        this.stopListeners();
    }
}
