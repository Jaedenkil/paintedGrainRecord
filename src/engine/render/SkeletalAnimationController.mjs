// @ts-check

/**
 * @fileoverview
 * 骨骼动画控制器——驱动 Skeleton 播放 AnimationClip 的核心组件。
 *
 * 工作流水线（每帧）：
 * ```
 * fixedUpdate(dt)
 *   ├─ 记录上一帧姿态 (_prevPose = _currentPose)
 *   ├─ 推进播放时间 currentTime += dt * speed
 *   ├─ 采样当前剪辑 → _currentPose
 *   ├─ 叠加混合层（blendLayers）
 *   ├─ 触发区间内的动画事件
 *   └─ skeleton.applyPose(_currentPose)
 *
 * updateInterpolated(interp)
 *   └─ lerp(_prevPose, _currentPose, interp) → skeleton.applyPose(interpolated)
 * ```
 *
 * @module render/SkeletalAnimationController
 */

import { SkeletonPose } from '../core/SkeletonPose.mjs';
import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('SkeletalAnimationController');

/**
 * 动画播放配置。
 * @typedef {Object} PlayOptions
 * @property {boolean} [loop=false] - 是否循环播放
 * @property {number} [speed=1] - 播放速度倍率
 * @property {number} [crossFade=0] - 交叉渐入时间（秒），0=立即切换
 * @property {number} [startTime=0] - 起始时间（秒）
 */

/**
 * 混合层配置。
 * @typedef {Object} BlendLayerConfig
 * @property {import('../core/AnimationClip.mjs').AnimationClip} clip - 混合层使用的动画剪辑
 * @property {number} weight - 混合权重 (0~1)
 * @property {string[]} [bones] - 限制影响的骨骼名列表（可选）
 */

/**
 * 骨骼动画控制器。
 *
 * @example
 * ```javascript
 * import { SkeletalAnimationController } from './SkeletalAnimationController.mjs';
 * import { AnimationClip, Skeleton } from '../core/index.mjs';
 *
 * const skeleton = new Skeleton('humanoid');
 * const controller = new SkeletalAnimationController(skeleton);
 *
 * // 注册动画剪辑
 * controller.registerClip(walkClip);
 * controller.registerClip(attackClip);
 *
 * // 播放行走动画（循环）
 * controller.play('walk', { loop: true });
 *
 * // 叠加攻击层（仅影响上半身骨骼）
 * controller.setBlendLayer('upper', attackClip, 0.7, ['spine', 'arm_l', 'arm_r']);
 *
 * // 每帧调用
 * controller.fixedUpdate(1/60);
 * controller.updateInterpolated(0.5);
 * ```
 */
export class SkeletalAnimationController {
    /**
     * @param {import('../core/Skeleton.mjs').Skeleton} skeleton - 要驱动的骨架
     */
    constructor(skeleton) {
        /** @private @type {import('../core/Skeleton.mjs').Skeleton} */
        this._skeleton = skeleton;

        /** @private @type {Map<string, import('../core/AnimationClip.mjs').AnimationClip>} */
        this._clips = new Map();

        // ==================== 播放状态 ====================

        /** @private @type {import('../core/AnimationClip.mjs').AnimationClip|null} */
        this._currentClip = null;

        /** @private @type {number} */
        this._currentTime = 0;

        /** @private @type {number} */
        this._speed = 1;

        /** @private @type {boolean} */
        this._loop = false;

        /** @private @type {boolean} */
        this._playing = false;

        /** @private @type {number} */
        this._lastFixedTime = 0;

        // ==================== 姿态缓存（帧间插值） ====================

        /** @private @type {SkeletonPose|null} */
        this._prevPose = null;

        /** @private @type {SkeletonPose|null} */
        this._currentPose = null;

        // ==================== 混合层 ====================

        /**
         * 混合层：层名 → 配置
         * @private @type {Map<string, BlendLayerConfig>}
         */
        this._blendLayers = new Map();

        // ==================== 交叉渐入 ====================

        /** @private @type {import('../core/AnimationClip.mjs').AnimationClip|null} */
        this._crossfadeFromClip = null;

        /** @private @type {SkeletonPose|null} */
        this._crossfadeFromPose = null;

        /** @private @type {number} */
        this._crossfadeTimer = 0;

        /** @private @type {number} */
        this._crossfadeDuration = 0;

        // ==================== 事件回调 ====================

        /** @private @type {Array<Function>} */
        this._eventCallbacks = [];

        /** @private @type {boolean} */
        this._destroyed = false;
    }

    // ==================== 剪辑管理 ====================

    /**
     * 注册一个动画剪辑。
     *
     * @param {import('../core/AnimationClip.mjs').AnimationClip} clip - 动画剪辑
     *
     * @example
     * ```javascript
     * controller.registerClip(walkClip);
     * ```
     */
    registerClip(clip) {
        this._clips.set(clip.name, clip);
    }

    /**
     * 批量注册动画剪辑。
     *
     * @param {import('../core/AnimationClip.mjs').AnimationClip[]} clips
     */
    registerClips(clips) {
        for (const clip of clips) {
            this._clips.set(clip.name, clip);
        }
    }

    /**
     * 检查是否已注册指定名称的剪辑。
     * @param {string} name
     * @returns {boolean}
     */
    hasClip(name) {
        return this._clips.has(name);
    }

    /**
     * 获取所有已注册剪辑的名称列表。
     * @returns {string[]}
     */
    getClipNames() {
        return Array.from(this._clips.keys());
    }

    /**
     * 获取指定名称的剪辑。
     * @param {string} name
     * @returns {import('../core/AnimationClip.mjs').AnimationClip|undefined}
     */
    getClip(name) {
        return this._clips.get(name);
    }

    // ==================== 播放控制 ====================

    /**
     * 播放指定名称的动画。
     *
     * @param {string} name - 动画名称
     * @param {PlayOptions} [options]
     *
     * @example
     * ```javascript
     * controller.play('walk', { loop: true, speed: 1.2, crossFade: 0.3 });
     * ```
     */
    play(name, options = {}) {
        if (this._destroyed) return;

        const clip = this._clips.get(name);
        if (!clip) {
            log.warn(`未知动画 "${name}"，可用：${this.getClipNames().join(', ')}`);
            return;
        }

        const {
            loop = false,
            speed = 1,
            crossFade = 0,
            startTime = 0
        } = options;

        // 如果启用了交叉渐入且当前有动画播放
        if (crossFade > 0 && this._currentClip && this._playing) {
            this._crossfadeFromClip = this._currentClip;
            this._crossfadeFromPose = this._currentPose
                ? this._currentPose.clone()
                : this._skeleton.getPose();
            this._crossfadeTimer = 0;
            this._crossfadeDuration = crossFade;
        }

        this._currentClip = clip;
        this._currentTime = Math.max(0, Math.min(startTime, clip.duration));
        this._speed = speed;
        this._loop = loop;
        this._playing = true;
        this._lastFixedTime = this._currentTime;

        // 立即采样第一帧
        this._prevPose = clip.sample(this._currentTime);
        this._currentPose = this._prevPose.clone();
        this._applyWithBlend(this._currentPose);

        log.debug(`播放动画: ${name} (loop=${loop}, speed=${speed})`);
    }

    /**
     * 停止播放。
     * 将骨骼重置为预设初始姿态。
     */
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

    /**
     * 暂停播放。
     */
    pause() {
        this._playing = false;
    }

    /**
     * 恢复播放。
     */
    resume() {
        if (this._currentClip) {
            this._playing = true;
        }
    }

    // ==================== 混合层 ====================

    /**
     * 设置一个混合层。
     *
     * 混合层以叠加（additive）方式混合到基础动画之上。
     * 多个混合层按添加顺序依次叠加。
     *
     * @param {string} layerName - 层名（如 'upper', 'effect'）
     * @param {import('../core/AnimationClip.mjs').AnimationClip} clip - 混合用动画剪辑
     * @param {number} weight - 混合权重 (0~1)，0=完全隐藏该层
     * @param {string[]} [bones] - 限制影响的骨骼名列表
     *
     * @example
     * ```javascript
     * // 上半身攻击 + 下半身行走
     * controller.setBlendLayer('upper', attackClip, 0.8,
     *     ['spine', 'arm_l', 'arm_r', 'head']);
     * ```
     */
    setBlendLayer(layerName, clip, weight, bones) {
        this._blendLayers.set(layerName, { clip, weight, bones });
    }

    /**
     * 移除指定混合层。
     * @param {string} layerName
     */
    removeBlendLayer(layerName) {
        this._blendLayers.delete(layerName);
    }

    /**
     * 清除所有混合层。
     */
    clearBlendLayers() {
        this._blendLayers.clear();
    }

    /**
     * 更新混合层权重（不重新设置）。
     * @param {string} layerName
     * @param {number} weight
     */
    setBlendWeight(layerName, weight) {
        const layer = this._blendLayers.get(layerName);
        if (layer) {
            layer.weight = Math.max(0, Math.min(1, weight));
        }
    }

    // ==================== 主更新方法 ====================

    /**
     * 固定步长更新——推进动画时间并采样。
     *
     * 应在 GameLoop 的 fixedUpdate 中调用。
     * 每次调用会：
     * 1. 记录上一帧姿态
     * 2. 推进播放时间
     * 3. 采样当前剪辑并叠加混合层
     * 4. 触发区间内的动画事件
     * 5. 应用姿态到骨架
     *
     * @param {number} dt - 固定步长时间增量（秒，通常为 1/60）
     * @returns {import('../core/AnimationClip.mjs').AnimationEvent[]} 本帧触发的事件列表
     *
     * @example
     * ```javascript
     * // 在 GameLoop.fixedUpdate 中
     * const events = controller.fixedUpdate(1/60);
     * events.forEach(e => handleEvent(e));
     * ```
     */
    fixedUpdate(dt) {
        if (!this._playing || !this._currentClip || this._destroyed) {
            return [];
        }

        // 1. 记录上一帧姿态
        this._prevPose = this._currentPose
            ? this._currentPose.clone()
            : null;

        // 2. 推进播放时间
        const lastTime = this._currentTime;
        this._currentTime += dt * this._speed;

        // 处理循环/结束
        if (this._currentTime >= this._currentClip.duration) {
            if (this._loop) {
                this._currentTime = this._currentTime % this._currentClip.duration;
            } else {
                this._currentTime = this._currentClip.duration;
                this._playing = false;
            }
        }

        // 3. 采样当前剪辑
        this._currentPose = this._currentClip.sample(this._currentTime);

        // 4. 叠加混合层
        this._applyBlendLayers(this._currentPose);

        // 5. 处理交叉渐入
        if (this._crossfadeFromPose && this._crossfadeDuration > 0) {
            this._crossfadeTimer += dt;
            const progress = Math.min(1, this._crossfadeTimer / this._crossfadeDuration);

            // 交叉渐入：从旧姿态 lerp 到新姿态
            const crossfaded = SkeletonPose.lerp(
                this._crossfadeFromPose,
                this._currentPose,
                progress
            );

            // 重新叠加混合层（在 lerp 结果之上）
            this._applyBlendLayers(crossfaded);
            this._currentPose = crossfaded;

            if (progress >= 1) {
                this._crossfadeFromClip = null;
                this._crossfadeFromPose = null;
                this._crossfadeDuration = 0;
            }
        }

        // 6. 应用姿态到骨架
        this._skeleton.applyPose(this._currentPose);

        // 7. 触发事件
        const events = this._currentClip.getEventsInRange(lastTime, this._currentTime);
        if (events.length > 0) {
            this._fireEvents(events);
        }

        this._lastFixedTime = this._currentTime;

        return events;
    }

    /**
     * 插值更新——在 fixedUpdate 之间做视觉平滑。
     *
     * 应在 GameLoop 的 variableUpdate 中调用。
     * 如果 interp 为 0，则直接使用上一帧姿态（最近一次 fixedUpdate 的结果）。
     *
     * @param {number} interp - 插值因子 (0~1)，当前帧在两次 fixedUpdate 之间的进度
     *
     * @example
     * ```javascript
     * // 在 GameLoop.variableUpdate(interpolation) 中
     * controller.updateInterpolated(interpolation);
     * ```
     */
    updateInterpolated(interp) {
        if (this._destroyed) return;

        // 如果有缓存的当前帧姿态，直接用（无插值也能接受）
        if (this._currentPose && this._prevPose && interp > 0 && interp < 1) {
            // 线性插值两帧
            const interpolated = SkeletonPose.lerp(this._prevPose, this._currentPose, interp);
            this._skeleton.applyPose(interpolated);
        } else if (this._currentPose) {
            this._skeleton.applyPose(this._currentPose);
        }
    }

    /**
     * 应用混合层到姿态。
     * @private
     * @param {SkeletonPose} pose - 要叠加混合的姿态（会被修改）
     */
    _applyBlendLayers(pose) {
        for (const [name, layer] of this._blendLayers) {
            if (layer.weight <= 0) continue;

            // 采样混合层动画的当前时间
            // 使用与基础层相同的时间进度
            const blendPose = layer.clip.sample(this._currentTime);

            // 如果限制了骨骼，只提取特定骨骼
            if (layer.bones && layer.bones.length > 0) {
                const filteredPose = this._filterBones(blendPose, layer.bones);
                const blended = SkeletonPose.blend(pose, filteredPose, layer.weight);
                // 将混合结果写回 pose（利用 SkeletonPose 的 transform 可写性）
                this._mergeBack(pose, blended, layer.bones);
            } else {
                const blended = SkeletonPose.blend(pose, blendPose, layer.weight);
                this._mergeAll(pose, blended);
            }
        }
    }

    /**
     * 应用姿态（含混合层）到骨架。用于初始化时的首次应用。
     * @private
     * @param {SkeletonPose} pose
     */
    _applyWithBlend(pose) {
        this._applyBlendLayers(pose);
        this._skeleton.applyPose(pose);
    }

    /**
     * 从姿态中提取指定骨骼的变换。
     * @private
     * @param {SkeletonPose} pose
     * @param {string[]} boneNames
     * @returns {SkeletonPose}
     */
    _filterBones(pose, boneNames) {
        const map = new Map();
        for (const name of boneNames) {
            const t = pose.getBoneTransform(name);
            if (t) map.set(name, { ...t });
        }
        return new SkeletonPose(map);
    }

    /**
     * 将源姿态中指定骨骼的变换合并回目标姿态。
     * @private
     * @param {SkeletonPose} target
     * @param {SkeletonPose} source
     * @param {string[]} boneNames
     */
    _mergeBack(target, source, boneNames) {
        for (const name of boneNames) {
            const t = source.getBoneTransform(name);
            if (t) target.setBoneTransform(name, t);
        }
    }

    /**
     * 将源姿态中所有骨骼的变换合并回目标姿态。
     * @private
     * @param {SkeletonPose} target
     * @param {SkeletonPose} source
     */
    _mergeAll(target, source) {
        for (const name of source.boneNames()) {
            const t = source.getBoneTransform(name);
            if (t) target.setBoneTransform(name, t);
        }
    }

    // ==================== 事件系统 ====================

    /**
     * 注册动画事件回调。
     *
     * @param {Function} callback - 接收 AnimationEvent 的回调函数
     *
     * @example
     * ```javascript
     * controller.onEvent(event => {
     *     if (event.name === 'footstep') playFootstepSound();
     * });
     * ```
     */
    onEvent(callback) {
        this._eventCallbacks.push(callback);
    }

    /**
     * 移除动画事件回调。
     * @param {Function} callback
     */
    offEvent(callback) {
        const idx = this._eventCallbacks.indexOf(callback);
        if (idx !== -1) {
            this._eventCallbacks.splice(idx, 1);
        }
    }

    /**
     * 触发事件回调。
     * @private
     * @param {import('../core/AnimationClip.mjs').AnimationEvent[]} events
     */
    _fireEvents(events) {
        for (const cb of this._eventCallbacks) {
            try {
                for (const event of events) {
                    cb(event);
                }
            } catch (err) {
                log.error('动画事件回调出错:', err);
            }
        }
    }

    // ==================== 状态查询 ====================

    /** 是否正在播放。 */
    get isPlaying() {
        return this._playing;
    }

    /** 当前动画名称。 */
    get currentClipName() {
        return this._currentClip ? this._currentClip.name : null;
    }

    /** 当前播放时间（秒）。 */
    get currentTime() {
        return this._currentTime;
    }

    /** 当前动画进度 (0~1)。 */
    get progress() {
        if (!this._currentClip || this._currentClip.duration === 0) return 0;
        return this._currentTime / this._currentClip.duration;
    }

    /** 播放速度倍率。 */
    get speed() {
        return this._speed;
    }

    /** @param {number} s */
    set speed(s) {
        this._speed = s;
    }

    /** 是否循环播放。 */
    get loop() {
        return this._loop;
    }

    /** @param {boolean} l */
    set loop(l) {
        this._loop = l;
    }

    // ==================== 生命周期 ====================

    /**
     * 销毁控制器，释放所有资源。
     * 调用后此实例不再可用。
     */
    destroy() {
        this._destroyed = true;
        this._playing = false;
        this._currentClip = null;
        this._prevPose = null;
        this._currentPose = null;
        this._clips.clear();
        this._blendLayers.clear();
        this._eventCallbacks = [];
        this._crossfadeFromClip = null;
        this._crossfadeFromPose = null;
        this._skeleton = null;
    }
}
