// @ts-check

/**
 * @fileoverview
 * 渲染适配器接口定义 - 引擎核心与 PixiJS（或其他渲染后端）之间的依赖倒置层。
 *
 * 设计意图：
 * RendererAdapter 是"引擎核心不依赖第三方渲染库"这一原则的具体实现。
 * 所有渲染操作通过此接口调遣，具体实现（PixiJS / Canvas2D / Three.js）在适配器中封装。
 *
 * 契约：
 * - 实现者必须覆盖所有方法，否则抛出 Error
 * - init() 必须发射 'render:initialized' 事件（通过 EventBus）
 * - destroy() 必须释放所有 GPU 资源和 DOM 引用
 *
 * @module render/RendererAdapter
 */

/**
 * 渲染适配器配置
 * @typedef {Object} RendererOptions
 * @property {number} [width=960] - 画布宽度（像素）
 * @property {number} [height=540] - 画布高度（像素）
 * @property {number} [backgroundColor=0x1a1a2e] - 背景色（十六进制，如 0x1a1a2e）
 * @property {boolean} [antialias=false] - 是否抗锯齿（像素风格应关闭）
 * @property {boolean} [roundPixels=true] - 像素对齐，防止子像素偏移导致的模糊
 * @property {number} [resolution=1] - 分辨率倍数
 * @property {number} [internalWidth=320] - 内部分辨率宽（像素风格缩放用）
 * @property {number} [internalHeight=180] - 内部分辨率高
 */

/**
 * 渲染适配器 - 抽象基类
 *
 * 定义渲染后端必须实现的接口契约。所有方法均为抽象方法，
 * 子类必须覆盖实现。
 *
 * @example
 * ```javascript
 * import { PixiRendererAdapter } from './PixiRendererAdapter.mjs';
 *
 * const adapter = new PixiRendererAdapter();
 * await adapter.init(document.getElementById('game-container'), {
 *     width: 960,
 *     height: 540,
 *     backgroundColor: 0x1a1a2e
 * });
 * adapter.render(stage);
 * ```
 */
export class RendererAdapter {
    /** @type {RendererOptions} */
    _options;

    /** @type {boolean} */
    _initialized = false;

    constructor() {
        if (this.constructor === RendererAdapter) {
            throw new Error(
                '[RendererAdapter] RendererAdapter 是抽象基类，不能直接实例化。请使用 PixiRendererAdapter。'
            );
        }
        /**
         * 适配器配置
         * @type {RendererOptions}
         * @protected
         */
        this._options = {};
    }

    /**
     * 初始化渲染上下文。
     *
     * 职责链：
     * 1. 创建渲染后端实例（PIXI.Application / Canvas2D 等）
     * 2. 绑定到传入的 canvas 元素或 DOM 容器
     * 3. 应用配置（roundPixels / antialias / resolution）
     * 4. 设置背景色
     * 5. 发射 'render:initialized' 事件
     *
     * @param {HTMLElement} container - DOM 容器元素（canvas 将挂载到此元素下）
     * @param {RendererOptions} [options={}] - 渲染配置
     * @returns {Promise<void>}
     * @throws {Error} 初始化失败时抛出
     *
     * @example
     * ```javascript
     * const adapter = new PixiRendererAdapter();
     * await adapter.init(document.getElementById('game-container'), {
     *     width: 960,
     *     height: 540,
     *     backgroundColor: 0x1a1a2e
     * });
     * ```
     */
    async init(container, options = {}) {
        throw new Error(
            `[RendererAdapter] ${this.constructor.name} 未实现 init() 方法`
        );
    }

    /**
     * 渲染一帧。
     *
     * 触发实际的 GPU draw call。对于 PixiJS，这对应
     * `app.renderer.render(stage)`。
     *
     * @param {*} stage - 舞台根节点（PIXI.Container 或其他渲染后端对应的根对象）
     * @throws {Error} 渲染过程中出错
     *
     * @example
     * ```javascript
     * adapter.render(app.stage);
     * ```
     */
    render(stage) {
        throw new Error(
            `[RendererAdapter] ${this.constructor.name} 未实现 render() 方法`
        );
    }

    /**
     * 调整渲染尺寸。
     *
     * 在窗口大小变化或分辨率切换时调用。
     * 应同步更新渲染后端的宽高和视口。
     *
     * @param {number} width - 新宽度（像素）
     * @param {number} height - 新高度（像素）
     *
     * @example
     * ```javascript
     * adapter.resize(640, 360);
     * ```
     */
    resize(width, height) {
        throw new Error(
            `[RendererAdapter] ${this.constructor.name} 未实现 resize() 方法`
        );
    }

    /**
     * 销毁渲染上下文，释放所有资源。
     *
     * 清理链：
     * 1. 销毁渲染后端实例（释放 WebGL 上下文）
     * 2. 从 DOM 中移除 canvas
     * 3. 清空内部引用
     * 4. 标记为未初始化
     *
     * 调用后，适配器不可再使用，需重新 init()。
     *
     * @returns {Promise<void>}
     *
     * @example
     * ```javascript
     * await adapter.destroy();
     * ```
     */
    async destroy() {
        throw new Error(
            `[RendererAdapter] ${this.constructor.name} 未实现 destroy() 方法`
        );
    }

    /**
     * 获取底层渲染器实例。
     *
     * 返回具体的渲染后端对象（如 PixiJS 的 Renderer），
     * 用于需要直接访问底层 API 的高级操作（如手动创建纹理）。
     *
     * @returns {*} 底层渲染器实例
     */
    getRenderer() {
        throw new Error(
            `[RendererAdapter] ${this.constructor.name} 未实现 getRenderer() 方法`
        );
    }

    /**
     * 获取当前挂载的 Canvas 元素。
     *
     * @returns {HTMLCanvasElement|null} Canvas 元素，未初始化时返回 null
     */
    getCanvas() {
        throw new Error(
            `[RendererAdapter] ${this.constructor.name} 未实现 getCanvas() 方法`
        );
    }

    /**
     * 适配器是否已完成初始化。
     * @returns {boolean}
     */
    get isInitialized() {
        return this._initialized;
    }
}
