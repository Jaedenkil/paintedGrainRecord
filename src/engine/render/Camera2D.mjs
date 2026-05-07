// @ts-check

/**
 * @fileoverview
 * 2D 相机系统 - 作用于 Layer 0~6 根容器的视口变换器。
 *
 * 相机通过指数平滑（smoothing = 0.1）实现跟随效果：
 * `pos += (target - pos) * smoothing`
 *
 * 变换仅影响 Layer 0~6（通过 rootContainer），
 * Layer 7（UI）保持固定在屏幕坐标系下。
 *
 * 设计要点：
 * - 指数平滑在目标停止时自然减速，产生"缓缓停住"效果
 * - 支持边界钳位（clamp），防止相机超出地图范围
 * - 每帧在 variableUpdate 中更新
 *
 * @module render/Camera2D
 */

import { EventBus } from '../core/EventBus.mjs';

/** 默认指数平滑系数 */
const DEFAULT_SMOOTHING = 0.1;

/** 默认缩放范围 */
const DEFAULT_MIN_ZOOM = 0.5;
const DEFAULT_MAX_ZOOM = 3.0;

/**
 * 2D 相机配置
 * @typedef {Object} Camera2DOptions
 * @property {number} [smoothing=0.1] - 指数平滑系数（0~1，越大跟随越快）
 * @property {number} [minZoom=0.5] - 最小缩放值
 * @property {number} [maxZoom=3.0] - 最大缩放值
 * @property {number} [viewWidth=960] - 视口宽度
 * @property {number} [viewHeight=540] - 视口高度
 * @property {{ x: number, y: number }} [boundaryMin] - 边界最小值（钳位用）
 * @property {{ x: number, y: number }} [boundaryMax] - 边界最大值（钳位用）
 */

/**
 * 2D 相机系统
 *
 * @example
 * ```javascript
 * import { Camera2D } from './Camera2D.mjs';
 *
 * const camera = new Camera2D(rootContainer, {
 *     viewWidth: 960,
 *     viewHeight: 540,
 *     smoothing: 0.1
 * });
 *
 * // 设置跟随目标
 * camera.setTarget({ x: 100, y: 200 });
 *
 * // 每帧更新
 * camera.update(0.016);
 *
 * // 设置缩放
 * camera.setZoom(2.0);
 * ```
 */
export class Camera2D {
    /** @private @type {import('pixi.js').Container} */
    _targetContainer;

    /** @private @type {number} */
    _smoothing;

    /** @private @type {number} */
    _minZoom;

    /** @private @type {number} */
    _maxZoom;

    /** @private */
    _currentX = 0;
    /** @private */
    _currentY = 0;
    /** @private */
    _targetX = 0;
    /** @private */
    _targetY = 0;
    /** @private */
    _currentZoom = 1.0;
    /** @private */
    _targetZoom = 1.0;
    /** @private */
    _rotation = 0;

    /** @private */
    _viewWidth = 960;
    /** @private */
    _viewHeight = 540;

    /** @private @type {{ x: number, y: number }|null} */
    _boundaryMin = null;
    /** @private @type {{ x: number, y: number }|null} */
    _boundaryMax = null;

    /** @private @type {{ x: number, y: number }|null} */
    _followTarget = null;

    /**
     * @param {import('pixi.js').Container} targetContainer - 受相机变换影响的根容器（Layer 0~6）
     * @param {Camera2DOptions} [options={}] - 相机配置
     */
    constructor(targetContainer, options = {}) {
        this._targetContainer = targetContainer;
        this._smoothing = options.smoothing ?? DEFAULT_SMOOTHING;
        this._minZoom = options.minZoom ?? DEFAULT_MIN_ZOOM;
        this._maxZoom = options.maxZoom ?? DEFAULT_MAX_ZOOM;
        this._viewWidth = options.viewWidth ?? 960;
        this._viewHeight = options.viewHeight ?? 540;

        if (options.boundaryMin) {
            this._boundaryMin = { ...options.boundaryMin };
        }
        if (options.boundaryMax) {
            this._boundaryMax = { ...options.boundaryMax };
        }

        // 应用边界钳位后，再应用初始变换
        this._clampPosition();
        this._applyTransform();
    }

    // ==================== 公共 API ====================

    /**
     * 每帧更新相机位置（指数平滑跟随）。
     *
     * 在 GameLoop 的 variableUpdate 阶段调用。
     *
     * @param {number} dt - 增量时间（秒）
     *
     * @example
     * ```javascript
     * // 在 variable 系统中
     * camera.update(dt);
     * ```
     */
    update(dt) {
        // 1. 如果设置了跟随目标，更新目标位置
        if (this._followTarget) {
            this._targetX = this._followTarget.x;
            this._targetY = this._followTarget.y;
        }

        // 2. 指数平滑插值
        // 使用 frame-independent 的平滑：alpha = 1 - (1 - smoothing) ^ dt
        // 这样即使帧率变化，平滑速度保持一致
        const alpha = 1 - Math.pow(1 - this._smoothing, dt * 60);
        this._currentX += (this._targetX - this._currentX) * alpha;
        this._currentY += (this._targetY - this._currentY) * alpha;

        // 3. 缩放平滑
        this._currentZoom += (this._targetZoom - this._currentZoom) * alpha;

        // 4. 边界钳位
        this._clampPosition();

        // 5. 应用变换
        this._applyTransform();

        // 6. 发射事件
        EventBus.getInstance().emit('render:camera-moved', {
            x: this._currentX,
            y: this._currentY,
            zoom: this._currentZoom,
            rotation: this._rotation
        });
    }

    /**
     * 设置相机跟随目标。
     *
     * 目标对象需要包含 `x` 和 `y` 属性。
     * 传入 null 可取消跟随。
     *
     * @param {{ x: number, y: number }|null} target - 跟随目标
     *
     * @example
     * ```javascript
     * // 跟随玩家
     * camera.setTarget(player.sprite);
     *
     * // 取消跟随
     * camera.setTarget(null);
     * ```
     */
    setTarget(target) {
        this._followTarget = target;
        if (target) {
            this._targetX = target.x;
            this._targetY = target.y;
        } else {
            // 取消跟随时，将目标设为当前位置，防止相机继续漂移
            this._targetX = this._currentX;
            this._targetY = this._currentY;
        }
    }

    /**
     * 立即将相机移动到指定位置（无平滑过渡）。
     *
     * @param {number} x - 目标 X 坐标
     * @param {number} y - 目标 Y 坐标
     *
     * @example
     * ```javascript
     * // 瞬移到场景中心
     * camera.moveToImmediate(sceneWidth / 2, sceneHeight / 2);
     * ```
     */
    moveToImmediate(x, y) {
        this._currentX = x;
        this._currentY = y;
        this._targetX = x;
        this._targetY = y;
        if (this._followTarget) {
            this._followTarget.x = x;
            this._followTarget.y = y;
        }
        this._clampPosition();
        this._applyTransform();
    }

    /**
     * 设置目标缩放值（带平滑过渡）。
     *
     * @param {number} zoom - 目标缩放值（受 min/max 限制）
     *
     * @example
     * ```javascript
     * camera.setZoom(2.0);
     * ```
     */
    setZoom(zoom) {
        this._targetZoom = Math.max(this._minZoom, Math.min(this._maxZoom, zoom));
    }

    /**
     * 立即设置缩放值（无平滑过渡）。
     *
     * @param {number} zoom - 缩放值
     */
    setZoomImmediate(zoom) {
        this._targetZoom = Math.max(this._minZoom, Math.min(this._maxZoom, zoom));
        this._currentZoom = this._targetZoom;
        this._applyTransform();
    }

    /**
     * 设置旋转角度（弧度）。
     *
     * @param {number} radians - 旋转角度（弧度）
     */
    setRotation(radians) {
        this._rotation = radians;
        this._applyTransform();
    }

    /**
     * 设置视口尺寸。
     *
     * @param {number} width - 视口宽度
     * @param {number} height - 视口高度
     */
    setViewport(width, height) {
        this._viewWidth = width;
        this._viewHeight = height;
        this._clampPosition();
        this._applyTransform();
    }

    /**
     * 设置边界限制。
     *
     * @param {{ x: number, y: number }|null} min - 最小边界（null 表示不限制）
     * @param {{ x: number, y: number }|null} max - 最大边界（null 表示不限制）
     *
     * @example
     * ```javascript
     * camera.setBounds(
     *     { x: 0, y: 0 },
     *     { x: mapWidth, y: mapHeight }
     * );
     * ```
     */
    setBounds(min, max) {
        this._boundaryMin = min ? { ...min } : null;
        this._boundaryMax = max ? { ...max } : null;
        this._clampPosition();
        this._applyTransform();
    }

    // ==================== 访问器 ====================

    /** 当前相机 X 坐标 */
    get x() { return this._currentX; }
    /** 当前相机 Y 坐标 */
    get y() { return this._currentY; }
    /** 当前缩放值 */
    get zoom() { return this._currentZoom; }
    /** 目标缩放值 */
    get targetZoom() { return this._targetZoom; }
    /** 旋转角度（弧度） */
    get rotation() { return this._rotation; }
    /** 视口宽度 */
    get viewWidth() { return this._viewWidth; }
    /** 视口高度 */
    get viewHeight() { return this._viewHeight; }
    /** 平滑系数 */
    get smoothing() { return this._smoothing; }

    /**
     * 是否正在平滑移动（位置或缩放未到达目标）
     * @returns {boolean}
     */
    get isMoving() {
        const posDiff = Math.abs(this._currentX - this._targetX) +
                        Math.abs(this._currentY - this._targetY);
        const zoomDiff = Math.abs(this._currentZoom - this._targetZoom);
        return posDiff > 0.5 || zoomDiff > 0.01;
    }

    // ==================== 内部方法 ====================

    /**
     * 计算并应用相机变换到目标容器。
     *
     * PixiJS 的 Container 变换规则：
     * - 容器的 position 是相对于父容器的偏移
     * - 相机跟随的"反向"效果：容器移动方向与相机相反
     * - 缩放以视口中心为原点
     *
     * @private
     */
    _applyTransform() {
        const halfW = this._viewWidth / 2;
        const halfH = this._viewHeight / 2;

        // 相机变换公式：
        // 1. 平移到视口中心
        // 2. 缩放到目标值
        // 3. 反向平移相机位置（因为移动容器等于反向移动相机）
        this._targetContainer.setTransform(
            halfW - this._currentX * this._currentZoom,
            halfH - this._currentY * this._currentZoom,
            this._currentZoom,
            this._currentZoom,
            this._rotation
        );
    }

    /**
     * 将当前位置钳位到边界内。
     *
     * 钳位逻辑：
     * - 如果地图尺寸小于视口，居中显示
     * - 否则不允许相机边界超出地图边界
     *
     * @private
     */
    _clampPosition() {
        if (!this._boundaryMin || !this._boundaryMax) return;

        const mapWidth = this._boundaryMax.x - this._boundaryMin.x;
        const mapHeight = this._boundaryMax.y - this._boundaryMin.y;

        const viewW = this._viewWidth / this._currentZoom;
        const viewH = this._viewHeight / this._currentZoom;

        if (mapWidth <= viewW) {
            // 地图宽度小于视口，居中
            this._currentX = (this._boundaryMin.x + this._boundaryMax.x) / 2;
            this._targetX = this._currentX;
        } else {
            const halfViewW = viewW / 2;
            this._currentX = Math.max(
                this._boundaryMin.x + halfViewW,
                Math.min(this._boundaryMax.x - halfViewW, this._currentX)
            );
        }

        if (mapHeight <= viewH) {
            // 地图高度小于视口，居中
            this._currentY = (this._boundaryMin.y + this._boundaryMax.y) / 2;
            this._targetY = this._currentY;
        } else {
            const halfViewH = viewH / 2;
            this._currentY = Math.max(
                this._boundaryMin.y + halfViewH,
                Math.min(this._boundaryMax.y - halfViewH, this._currentY)
            );
        }
    }
}
