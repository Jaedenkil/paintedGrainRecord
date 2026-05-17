// @ts-check

/**
 * @fileoverview 骨骼动画控制器——驱动 Skeleton 播放 AnimationClip 的核心组件。
 *
 * 工作流水线（每帧）：
 * ```
 * fixedUpdate(dt) → 推进时间 → 采样剪辑 → 叠加混合层 → 触发事件 → skeleton.applyPose
 * updateInterpolated(interp) → lerp(_prevPose, _currentPose) → skeleton.applyPose
 * ```
 *
 * @module render/SkeletalAnimationController
 */

import { SkeletonPose } from '../core/SkeletonPose.mjs';
import { BlendLayerStack } from './BlendLayerStack.mjs';
import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('SkeletalAnimationController');

/**
 * @typedef {Object} PlayOptions
 * @property {boolean} [loop=false] @property {number} [speed=1]
 * @property {number} [crossFade=0] @property {number} [startTime=0]
 */

/**
 * 骨骼动画控制器。
 * @example
 * ```javascript
 * const controller = new SkeletalAnimationController(skeleton);
 * controller.registerClip(walkClip);
 * controller.play('walk', { loop: true });
 * controller.fixedUpdate(1/60);
 * ```
 */
export class SkeletalAnimationController {
    /** @param {import('../core/Skeleton.mjs').Skeleton} skeleton */
    constructor(skeleton) {
        /** @private */ this._skeleton = skeleton;
        /** @private @type {Map<string, import('../core/AnimationClip.mjs').AnimationClip>} */ this._clips = new Map();
        /** @private @type {import('../core/AnimationClip.mjs').AnimationClip|null} */ this._currentClip = null;
        /** @private */ this._currentTime = 0;
        /** @private */ this._speed = 1;
        /** @private */ this._loop = false;
        /** @private */ this._playing = false;
        /** @private */ this._lastFixedTime = 0;
        /** @private @type {SkeletonPose|null} */ this._prevPose = null;
        /** @private @type {SkeletonPose|null} */ this._currentPose = null;
        /** @private @type {BlendLayerStack} */ this._blendStack = new BlendLayerStack();
        /** @private @type {import('../core/AnimationClip.mjs').AnimationClip|null} */ this._crossfadeFromClip = null;
        /** @private @type {SkeletonPose|null} */ this._crossfadeFromPose = null;
        /** @private */ this._crossfadeTimer = 0;
        /** @private */ this._crossfadeDuration = 0;
        /** @private @type {Array<Function>} */ this._eventCallbacks = [];
        /** @private */ this._destroyed = false;
    }

    // ==================== 剪辑管理 ====================

    /** 注册动画剪辑。@param {import('../core/AnimationClip.mjs').AnimationClip} clip */
    registerClip(clip) { this._clips.set(clip.name, clip); }

    /** 批量注册。@param {import('../core/AnimationClip.mjs').AnimationClip[]} clips */
    registerClips(clips) { for (const c of clips) this._clips.set(c.name, c); }

    /** @param {string} name @returns {boolean} */
    hasClip(name) { return this._clips.has(name); }

    /** @returns {string[]} */
    getClipNames() { return Array.from(this._clips.keys()); }

    /** @param {string} name @returns {import('../core/AnimationClip.mjs').AnimationClip|undefined} */
    getClip(name) { return this._clips.get(name); }

    // ==================== 播放控制 ====================

    /**
     * 播放指定名称的动画。
     * @param {string} name @param {PlayOptions} [options]
     */
    play(name, options = {}) {
        if (this._destroyed) return;
        const clip = this._clips.get(name);
        if (!clip) { log.warn(`未知动画 "${name}"，可用：${this.getClipNames().join(', ')}`); return; }
        const { loop = false, speed = 1, crossFade = 0, startTime = 0 } = options;

        if (crossFade > 0 && this._currentClip && this._playing) {
            this._crossfadeFromClip = this._currentClip;
            this._crossfadeFromPose = this._currentPose
                ? this._currentPose.clone() : this._skeleton.getPose();
            this._crossfadeTimer = 0;
            this._crossfadeDuration = crossFade;
        }

        this._currentClip = clip;
        this._currentTime = Math.max(0, Math.min(startTime, clip.duration));
        this._speed = speed;
        this._loop = loop;
        this._playing = true;
        this._lastFixedTime = this._currentTime;

        this._prevPose = clip.sample(this._currentTime);
        this._currentPose = this._prevPose.clone();
        this._blendStack.apply(this._currentPose, this._currentTime);
        this._skeleton.applyPose(this._currentPose);
        log.debug(`播放动画: ${name} (loop=${loop}, speed=${speed})`);
    }

    /** 停止播放。*/
    stop() {
        this._playing = false;
        this._currentClip = null;
        this._currentTime = 0;
        this._prevPose = null;
        this._currentPose = null;
        this._crossfadeFromClip = null;
        this._crossfadeFromPose = null;
        this._skeleton.resetPose();
    }

    /** 暂停。*/
    pause() { this._playing = false; }

    /** 恢复。*/
    resume() { if (this._currentClip) this._playing = true; }

    // ==================== 混合层（委托） ====================

    /** @param {string} name @param {import('../core/AnimationClip.mjs').AnimationClip} clip @param {number} weight @param {string[]} [bones] */
    setBlendLayer(name, clip, weight, bones) { this._blendStack.setLayer(name, clip, weight, bones); }

    /** @param {string} name */
    removeBlendLayer(name) { this._blendStack.removeLayer(name); }

    /** 清除所有混合层。*/
    clearBlendLayers() { this._blendStack.clearLayers(); }

    /** @param {string} name @param {number} weight */
    setBlendWeight(name, weight) { this._blendStack.setWeight(name, weight); }

    // ==================== 主更新方法 ====================

    /**
     * 固定步长更新——推进动画时间并采样。
     * @param {number} dt - 固定步长时间增量（秒）
     * @returns {import('../core/AnimationClip.mjs').AnimationEvent[]}
     */
    fixedUpdate(dt) {
        if (!this._playing || !this._currentClip || this._destroyed) return [];

        this._prevPose = this._currentPose ? this._currentPose.clone() : null;
        const lastTime = this._currentTime;
        this._currentTime += dt * this._speed;

        if (this._currentTime >= this._currentClip.duration) {
            if (this._loop) {
                this._currentTime = this._currentTime % this._currentClip.duration;
            } else {
                this._currentTime = this._currentClip.duration;
                this._playing = false;
            }
        }

        this._currentPose = this._currentClip.sample(this._currentTime);
        this._blendStack.apply(this._currentPose, this._currentTime);

        if (this._crossfadeFromPose && this._crossfadeDuration > 0) {
            this._crossfadeTimer += dt;
            const progress = Math.min(1, this._crossfadeTimer / this._crossfadeDuration);
            const crossfaded = SkeletonPose.lerp(this._crossfadeFromPose, this._currentPose, progress);
            this._blendStack.apply(crossfaded, this._currentTime);
            this._currentPose = crossfaded;
            if (progress >= 1) {
                this._crossfadeFromClip = null;
                this._crossfadeFromPose = null;
                this._crossfadeDuration = 0;
            }
        }

        this._skeleton.applyPose(this._currentPose);
        const events = this._currentClip.getEventsInRange(lastTime, this._currentTime);
        if (events.length > 0) this._fireEvents(events);
        this._lastFixedTime = this._currentTime;
        return events;
    }

    /**
     * 插值更新——在 fixedUpdate 之间做视觉平滑。
     * @param {number} interp - 插值因子 (0~1)
     */
    updateInterpolated(interp) {
        if (this._destroyed) return;
        if (this._currentPose && this._prevPose && interp > 0 && interp < 1) {
            this._skeleton.applyPose(SkeletonPose.lerp(this._prevPose, this._currentPose, interp));
        } else if (this._currentPose) {
            this._skeleton.applyPose(this._currentPose);
        }
    }

    // ==================== 事件系统 ====================

    /** @param {Function} callback */
    onEvent(callback) { this._eventCallbacks.push(callback); }

    /** @param {Function} callback */
    offEvent(callback) {
        const idx = this._eventCallbacks.indexOf(callback);
        if (idx !== -1) this._eventCallbacks.splice(idx, 1);
    }

    /**
     * @private @param {import('../core/AnimationClip.mjs').AnimationEvent[]} events
     */
    _fireEvents(events) {
        for (const cb of this._eventCallbacks) {
            try { for (const ev of events) cb(ev); }
            catch (err) { log.error('动画事件回调出错:', err); }
        }
    }

    // ==================== 状态查询 ====================

    /** @returns {boolean} */ get isPlaying() { return this._playing; }
    /** @returns {string|null} */ get currentClipName() { return this._currentClip ? this._currentClip.name : null; }
    /** @returns {number} */ get currentTime() { return this._currentTime; }
    /** @returns {number} */ get progress() {
        if (!this._currentClip || this._currentClip.duration === 0) return 0;
        return this._currentTime / this._currentClip.duration;
    }
    /** @returns {number} */ get speed() { return this._speed; }
    /** @param {number} s */ set speed(s) { this._speed = s; }
    /** @returns {boolean} */ get loop() { return this._loop; }
    /** @param {boolean} l */ set loop(l) { this._loop = l; }

    // ==================== 生命周期 ====================

    /** 销毁控制器。*/
    destroy() {
        this._destroyed = true;
        this._playing = false;
        this._currentClip = null;
        this._prevPose = null;
        this._currentPose = null;
        this._clips.clear();
        this._blendStack.clearLayers();
        this._eventCallbacks = [];
        this._crossfadeFromClip = null;
        this._crossfadeFromPose = null;
        this._skeleton = null;
    }
}
