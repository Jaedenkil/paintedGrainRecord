// @ts-check

/**
 * @fileoverview 场景基类——定义标准生命周期钩子。
 * init() → enter() → update()/render() → exit() → destroy()
 * @module scene/Scene
 */

export class Scene {
    /**
     * @param {string} name 场景唯一标识
     */
    constructor(name) {
        /** @type {string} */ this.name = name;
        /** @private @type {boolean} */ this._initialized = false;
        /** @private @type {boolean} */ this._active = false;
    }

    /**
     * 初始化场景资源。仅调用一次，在首次 push 时触发。
     * @param {*} [data] 场景启动参数
     */
    init(data) { this._initialized = true; }

    /** 场景成为活跃时调用。*/
    enter() { this._active = true; }

    /**
     * 每帧 fixedUpdate 调用（固定步长逻辑更新）。
     * @param {number} dt 固定步长（秒）
     */
    update(dt) {}

    /**
     * 每帧 variableUpdate 调用（插值渲染）。
     * @param {number} interp 插值因子 [0,1)
     */
    render(interp) {}

    /** 场景不再活跃时调用。*/
    exit() { this._active = false; }

    /** 销毁场景，释放所有资源。*/
    destroy() { this._initialized = false; this._active = false; }

    /** @returns {boolean} */ get isInitialized() { return this._initialized; }
    /** @returns {boolean} */ get isActive() { return this._active; }
}
