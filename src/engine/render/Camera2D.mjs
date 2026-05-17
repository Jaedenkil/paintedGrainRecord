// @ts-check

/**
 * @fileoverview 2D 相机系统——作用 Layer 0~6 根容器的视口变换器。指数平滑跟随，边界钳位。
 * @module render/Camera2D
 */

import { EventBus } from '../core/EventBus.mjs';

const DEFAULT_SMOOTHING = 0.1;
const DEFAULT_MIN_ZOOM = 0.5;
const DEFAULT_MAX_ZOOM = 3.0;

/**
 * @typedef {Object} Camera2DOptions
 * @property {number} [smoothing=0.1] 指数平滑系数
 * @property {number} [minZoom=0.5] 最小缩放
 * @property {number} [maxZoom=3.0] 最大缩放
 * @property {number} [viewWidth=960] 视口宽
 * @property {number} [viewHeight=540] 视口高
 * @property {{ x:number, y:number }} [boundaryMin] 边界最小值
 * @property {{ x:number, y:number }} [boundaryMax] 边界最大值
 */

export class Camera2D {
    /** @private @type {import('pixi.js').Container|null} */ _targetContainer;
    /** @private */ _smoothing = DEFAULT_SMOOTHING;
    /** @private */ _minZoom = DEFAULT_MIN_ZOOM;
    /** @private */ _maxZoom = DEFAULT_MAX_ZOOM;
    /** @private */ _currentX = 0;
    /** @private */ _currentY = 0;
    /** @private */ _targetX = 0;
    /** @private */ _targetY = 0;
    /** @private */ _currentZoom = 1.0;
    /** @private */ _targetZoom = 1.0;
    /** @private */ _rotation = 0;
    /** @private */ _viewWidth = 960;
    /** @private */ _viewHeight = 540;
    /** @private @type {{ x:number, y:number }|null} */ _boundaryMin = null;
    /** @private @type {{ x:number, y:number }|null} */ _boundaryMax = null;
    /** @private @type {{ x:number, y:number }|null} */ _followTarget = null;

    /**
     * @param {import('pixi.js').Container} targetContainer 受相机影响的世界根容器
     * @param {Camera2DOptions} [options={}]
     */
    constructor(targetContainer, options = {}) {
        this._targetContainer = targetContainer;
        this._smoothing = options.smoothing ?? DEFAULT_SMOOTHING;
        this._minZoom = options.minZoom ?? DEFAULT_MIN_ZOOM;
        this._maxZoom = options.maxZoom ?? DEFAULT_MAX_ZOOM;
        this._viewWidth = options.viewWidth ?? 960;
        this._viewHeight = options.viewHeight ?? 540;
        if (options.boundaryMin) this._boundaryMin = { ...options.boundaryMin };
        if (options.boundaryMax) this._boundaryMax = { ...options.boundaryMax };
        this._clampPosition();
        this._applyTransform();
    }

    /** 每帧更新（指数平滑跟随）。在 GameLoop variableUpdate 阶段调用。@param {number} dt */
    update(dt) {
        if (this._followTarget) {
            this._targetX = this._followTarget.x;
            this._targetY = this._followTarget.y;
        }
        const alpha = 1 - Math.pow(1 - this._smoothing, dt * 60);
        this._currentX += (this._targetX - this._currentX) * alpha;
        this._currentY += (this._targetY - this._currentY) * alpha;
        this._currentZoom += (this._targetZoom - this._currentZoom) * alpha;
        this._clampPosition();
        this._applyTransform();
        EventBus.getInstance().emit('render:camera-moved', {
            x: this._currentX, y: this._currentY, zoom: this._currentZoom, rotation: this._rotation
        });
    }

    /** 设置跟随目标。目标需含 x/y 属性。@param {{ x:number, y:number }|null} target */
    setTarget(target) {
        this._followTarget = target;
        if (target) { this._targetX = target.x; this._targetY = target.y; }
        else { this._targetX = this._currentX; this._targetY = this._currentY; }
    }

    /** 瞬移到指定位置。@param {number} x @param {number} y */
    moveToImmediate(x, y) {
        this._currentX = x; this._currentY = y;
        this._targetX = x; this._targetY = y;
        if (this._followTarget) { this._followTarget.x = x; this._followTarget.y = y; }
        this._clampPosition();
        this._applyTransform();
    }

    /** 设置目标缩放（带平滑）。@param {number} zoom */
    setZoom(zoom) { this._targetZoom = Math.max(this._minZoom, Math.min(this._maxZoom, zoom)); }

    /** 立即设置缩放。@param {number} zoom */
    setZoomImmediate(zoom) {
        this._targetZoom = Math.max(this._minZoom, Math.min(this._maxZoom, zoom));
        this._currentZoom = this._targetZoom;
        this._applyTransform();
    }

    /** 设置旋转角度（弧度）。@param {number} radians */
    setRotation(radians) { this._rotation = radians; this._applyTransform(); }

    /** 设置视口尺寸。@param {number} width @param {number} height */
    setViewport(width, height) {
        this._viewWidth = width; this._viewHeight = height;
        this._clampPosition();
        this._applyTransform();
    }

    /** 设置边界限制。@param {{ x:number, y:number }|null} min @param {{ x:number, y:number }|null} max */
    setBounds(min, max) {
        this._boundaryMin = min ? { ...min } : null;
        this._boundaryMax = max ? { ...max } : null;
        this._clampPosition();
        this._applyTransform();
    }

    /** @returns {number} */ get x() { return this._currentX; }
    /** @returns {number} */ get y() { return this._currentY; }
    /** @returns {number} */ get zoom() { return this._currentZoom; }
    /** @returns {number} */ get targetZoom() { return this._targetZoom; }
    /** @returns {number} */ get rotation() { return this._rotation; }
    /** @returns {number} */ get viewWidth() { return this._viewWidth; }
    /** @returns {number} */ get viewHeight() { return this._viewHeight; }
    /** @returns {number} */ get smoothing() { return this._smoothing; }
    /** 是否正在平滑移动。@returns {boolean} */
    get isMoving() {
        const posDiff = Math.abs(this._currentX - this._targetX) + Math.abs(this._currentY - this._targetY);
        const zoomDiff = Math.abs(this._currentZoom - this._targetZoom);
        return posDiff > 0.5 || zoomDiff > 0.01;
    }

    /** @private 应用相机变换到容器。 */
    _applyTransform() {
        const container = this._targetContainer;
        if (!container) return;
        const halfW = this._viewWidth / 2;
        const halfH = this._viewHeight / 2;
        container.position.set(halfW - this._currentX * this._currentZoom, halfH - this._currentY * this._currentZoom);
        container.scale.set(this._currentZoom, this._currentZoom);
        container.rotation = this._rotation;
    }

    /** @private 将位置钳位到边界内。 */
    _clampPosition() {
        if (!this._boundaryMin || !this._boundaryMax) return;
        const mapW = this._boundaryMax.x - this._boundaryMin.x;
        const mapH = this._boundaryMax.y - this._boundaryMin.y;
        const viewW = this._viewWidth / this._currentZoom;
        const viewH = this._viewHeight / this._currentZoom;
        if (mapW <= viewW) {
            this._currentX = (this._boundaryMin.x + this._boundaryMax.x) / 2;
            this._targetX = this._currentX;
        } else {
            this._currentX = Math.max(this._boundaryMin.x + viewW / 2, Math.min(this._boundaryMax.x - viewW / 2, this._currentX));
        }
        if (mapH <= viewH) {
            this._currentY = (this._boundaryMin.y + this._boundaryMax.y) / 2;
            this._targetY = this._currentY;
        } else {
            this._currentY = Math.max(this._boundaryMin.y + viewH / 2, Math.min(this._boundaryMax.y - viewH / 2, this._currentY));
        }
    }

    /** 销毁相机，释放引用。不可再用。 */
    destroy() {
        this._followTarget = null;
        this._targetContainer = null;
        this._currentX = 0; this._currentY = 0;
        this._targetX = 0; this._targetY = 0;
        this._currentZoom = 1.0; this._targetZoom = 1.0;
        this._rotation = 0;
        this._boundaryMin = null; this._boundaryMax = null;
    }
}
