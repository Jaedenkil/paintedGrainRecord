// @ts-check

/**
 * @fileoverview
 * PixiJS 渲染适配器 - RendererAdapter 接口的 PixiJS v8+ 实现。
 *
 * 封装 PIXI.Application 的创建与管理，配置像素风格渲染参数：
 * - roundPixels: true（像素对齐，防止子像素偏移模糊）
 * - antialias: false（像素风格不需要抗锯齿）
 * - resolution: 3（320×180 内部分辨率 → 960×540 输出）
 * - backgroundColor: 0x1a1a2e（夜色调）
 *
 * 核心引擎代码通过此适配器访问渲染能力，不直接 import PixiJS。
 *
 * @module render/PixiRendererAdapter
 */

import { RendererAdapter } from './RendererAdapter.mjs';
import { EventBus } from '../core/EventBus.mjs';
import { getErrorMessage } from '../utils/error.mjs';
import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('PixiRendererAdapter');

/**
 * PixiJS 渲染适配器默认配置
 * @type {Readonly<import('./RendererAdapter.mjs').RendererOptions>}
 */
const DEFAULT_OPTIONS = Object.freeze({
    width: 960,
    height: 540,
    internalWidth: 320,
    internalHeight: 180,
    backgroundColor: 0x0d0d0d,
    antialias: false,
    roundPixels: true,
    resolution: 1
});

/**
 * PixiJS 渲染适配器
 *
 * @example
 * ```javascript
 * import { PixiRendererAdapter } from './PixiRendererAdapter.mjs';
 *
 * const adapter = new PixiRendererAdapter();
 * await adapter.init(document.getElementById('game-container'), {
 *     width: 960,
 *     height: 540
 * });
 *
 * // 每帧调用
 * adapter.render(app.stage);
 * ```
 */
export class PixiRendererAdapter extends RendererAdapter {
    /** @private @type {import('pixi.js').Application|null} */
    _app = null;

    /** @private @type {HTMLElement|null} */
    _container = null;

    constructor() {
        super();
    }

    /**
     * 初始化 PixiJS Application。
     *
     * 执行顺序：
     * 1. 校验 PIXI 全局是否可用
     * 2. 合并用户配置与默认值
     * 3. 创建 PIXI.Application（v8 异步初始化）
     * 4. 挂载 canvas 到目标容器
     * 5. 发射 'render:initialized' 事件
     *
     * @param {HTMLElement} container - DOM 容器元素
     * @param {import('./RendererAdapter.mjs').RendererOptions} [options={}] - 渲染配置
     * @returns {Promise<void>}
     * @throws {Error} PIXI 全局不可用或初始化失败
     */
    async init(container, options = {}) {
        if (this._initialized) {
            log.warn('适配器已初始化，跳过');
            return;
        }

        // 1. 合并配置
        /** @type {import('./RendererAdapter.mjs').RendererOptions} */
        this._options = { ...DEFAULT_OPTIONS, ...options };

        // 2. 校验 PIXI 依赖
        if (typeof PIXI === 'undefined') {
            throw new Error(
                '[PixiRendererAdapter] PIXI 全局对象不存在。请确保 pixi.js 脚本在适配器初始化之前加载。'
            );
        }

        // 3. 创建 PIXI Application
        try {
            const app = new PIXI.Application();

            await app.init({
                width: this._options.width,
                height: this._options.height,
                backgroundColor: this._options.backgroundColor,
                antialias: this._options.antialias,
                roundPixels: this._options.roundPixels,
                resolution: this._options.resolution
            });

            this._app = app;
            this._container = container;

            // 4. 挂载 Canvas
            container.appendChild(app.canvas);

            // 5. 标记已初始化
            this._initialized = true;

            // 6. 发射适配器初始化完成事件（RenderSystem 完成完整管线后另发 render:initialized）
            EventBus.getInstance().emit('render:adapter-ready', {
                renderer: app.renderer,
                stage: app.stage,
                canvas: app.canvas,
                options: this._options
            });
log.info(`初始化完成 (${this._options.width}×${this._options.height})`);

        } catch (err) {
            this._initialized = false;
            throw new Error(
                `[PixiRendererAdapter] 初始化失败: ${getErrorMessage(err)}`
            );
        }
    }

    /**
     * 渲染一帧。
     *
     * 调用 PixiJS 渲染器的 render() 方法，触发 WebGL draw call。
     *
     * @param {import('pixi.js').Container} stage - PIXI 舞台根节点
     * @throws {Error} 适配器未初始化
     */
    render(stage) {
        if (!this._app) {
            throw new Error('[PixiRendererAdapter] 适配器未初始化，无法渲染');
        }
        this._app.renderer.render(stage);
    }

    /**
     * 调整渲染尺寸。
     *
     * 同步更新 PixiJS renderer 的宽高和视口。
     *
     * @param {number} width - 新宽度（像素）
     * @param {number} height - 新高度（像素）
     */
    resize(width, height) {
        if (!this._app) {
            log.warn('适配器未初始化，无法 resize');
            return;
        }

        this._app.renderer.resize(width, height);
        this._options.width = width;
        this._options.height = height;

        EventBus.getInstance().emit('render:adapter-resized', {
            width,
            height,
            renderer: this._app.renderer
        });
    }

    /**
     * 销毁 PixiJS Application，释放所有资源。
     *
     * 清理链：
     * 1. 销毁 PIXI.Application（释放 WebGL 上下文和 GPU 纹理）
     * 2. 从 DOM 中移除 canvas
     * 3. 清空内部引用
     *
     * @returns {Promise<void>}
     */
    async destroy() {
        if (!this._app) return;

        try {
            log.info('正在销毁...');
            // 1. 从 DOM 中移除 canvas
            const canvas = this._app.canvas;
            if (canvas && canvas.parentNode) {
                canvas.parentNode.removeChild(canvas);
            }

            // 2. 销毁 PIXI Application
            this._app.destroy(true);
            this._app = null;
            this._container = null;
            this._initialized = false;

            log.info('已销毁');
        } catch (err) {
            log.error('销毁失败:', getErrorMessage(err));
        }
    }

    /**
     * 获取底层 PixiJS Renderer 实例。
     *
     * @returns {import('pixi.js').Renderer|null} PixiJS Renderer 实例
     */
    getRenderer() {
        return this._app ? this._app.renderer : null;
    }

    /**
     * 获取当前挂载的 Canvas 元素。
     *
     * @returns {HTMLCanvasElement|null} Canvas 元素
     */
    getCanvas() {
        return this._app ? this._app.canvas : null;
    }

    /**
     * 获取 PIXI.Application 实例。
     *
     * @returns {import('pixi.js').Application|null}
     */
    getApp() {
        return this._app;
    }

    /**
     * 获取 PixiJS 舞台根节点（app.stage）。
     *
     * @returns {import('pixi.js').Container|null}
     */
    getStage() {
        return this._app ? this._app.stage : null;
    }
}
