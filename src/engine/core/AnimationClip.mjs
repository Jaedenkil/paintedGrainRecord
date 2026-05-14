// @ts-check

/**
 * @fileoverview
 * 动画剪辑——骨骼动画的关键帧序列定义。
 *
 * 与精灵表版的 AnimationClip 不同，骨骼版 AnimationClip 不存储纹理引用，
 * 而是存储每根骨骼随时间变化的关键帧（keyframes）数据。
 *
 * @module core/AnimationClip
 */

import { SkeletonPose } from './SkeletonPose.mjs';
import { quantizeAngle } from './Bone.mjs';

/**
 * 骨骼关键帧——某根骨骼在某个时间点的变换。
 * @typedef {Object} BoneKeyframe
 * @property {number} time - 时间点（秒，从动画开始）
 * @property {number} [x=0] - X 偏移
 * @property {number} [y=0] - Y 偏移
 * @property {number} [rotation=0] - 旋转角度（度）
 * @property {number} [scaleX=1] - 水平缩放
 * @property {number} [scaleY=1] - 垂直缩放
 * @property {string} [easing] - 缓动函数名（预留，默认线性）
 */

/**
 * 动画事件——在动画时间线上标记的关键帧事件。
 * @typedef {Object} AnimationEvent
 * @property {number} time - 事件发生的时间点（秒）
 * @property {string} name - 事件名（如 'footstep', 'hit', 'cast'）
 * @property {Object} [data] - 附加数据
 */

/**
 * 动画剪辑。
 *
 * @example
 * ```javascript
 * import { AnimationClip } from './AnimationClip.mjs';
 *
 * // 定义一个行走动画
 * const walkClip = new AnimationClip('walk', 0.6, {
 *     // 第 0 秒：左腿在前
 *     'leg_l': [
 *         { time: 0, x: -3, y: 0, rotation: 30 },
 *         { time: 0.3, x: 3, y: 0, rotation: -30 },
 *         { time: 0.6, x: -3, y: 0, rotation: 30 }
 *     ],
 *     // 第 0 秒：右腿在后
 *     'leg_r': [
 *         { time: 0, x: 3, y: 0, rotation: -30 },
 *         { time: 0.3, x: -3, y: 0, rotation: 30 },
 *         { time: 0.6, x: 3, y: 0, rotation: -30 }
 *     ]
 * }, {
 *     events: [
 *         { time: 0.15, name: 'footstep' },
 *         { time: 0.45, name: 'footstep' }
 *     ]
 * });
 *
 * // 采样第 0.2 秒的姿态
 * const pose = walkClip.sample(0.2);
 * ```
 */
export class AnimationClip {
    /**
     * @param {string} name - 动画名称
     * @param {number} duration - 动画总时长（秒）
     * @param {Object<string, BoneKeyframe[]>} keyframes - 骨骼名 → 关键帧数组
     * @param {Object} [options]
     * @param {AnimationEvent[]} [options.events] - 时间线事件列表
     */
    constructor(name, duration, keyframes, options = {}) {
        const { events = [] } = options;

        /** 动画名称。 @readonly */
        this.name = name;

        /** 动画总时长（秒）。 @readonly */
        this.duration = duration;

        /**
         * 关键帧数据：骨骼名 → 按时间排序的关键帧数组。
         * @private @type {Object<string, BoneKeyframe[]>}
         */
        this._keyframes = {};

        // 深拷贝关键帧数据并确保排序
        for (const [boneName, frames] of Object.entries(keyframes)) {
            this._keyframes[boneName] = frames
                .map(f => ({
                    time: f.time,
                    x: f.x ?? 0,
                    y: f.y ?? 0,
                    rotation: f.rotation ?? 0,
                    scaleX: f.scaleX ?? 1,
                    scaleY: f.scaleY ?? 1,
                    easing: f.easing
                }))
                .sort((a, b) => a.time - b.time);
        }

        /**
         * 时间线事件列表。
         * @private @type {AnimationEvent[]}
         */
        this._events = events
            .map(e => ({ ...e }))
            .sort((a, b) => a.time - b.time);

        /** 缓存上一帧的采样结果，减少分配。 @private */
        this._cachedPose = null;
    }

    /**
     * 在指定时间点采样动画，返回插值后的姿态。
     *
     * 对每根骨骼：
     * 1. 在关键帧数组中查找 time 前后的两个关键帧
     * 2. 计算插值因子 t = (time - prev.time) / (next.time - prev.time)
     * 3. 对 x/y/rotation/scale 分别做线性插值
     * 4. rotation 插值后重新量化
     *
     * 如果 time 在第一个关键帧之前，返回第一个关键帧的值。
     * 如果 time 在最后一个关键帧之后，返回最后一个关键帧的值。
     *
     * @param {number} time - 采样时间点（秒），应在 [0, duration] 范围内
     * @returns {SkeletonPose} 插值后的姿态
     *
     * @example
     * ```javascript
     * const pose = clip.sample(0.25);
     * const legLTransform = pose.getBoneTransform('leg_l');
     * ```
     */
    sample(time) {
        time = Math.max(0, Math.min(time, this.duration));

        /** @type {Map<string, import('./SkeletonPose.mjs').BoneTransform>} */
        const resultMap = new Map();

        for (const [boneName, frames] of Object.entries(this._keyframes)) {
            if (frames.length === 0) continue;

            if (frames.length === 1 || time <= frames[0].time) {
                // 在第一个关键帧之前或唯一关键帧
                resultMap.set(boneName, {
                    x: frames[0].x,
                    y: frames[0].y,
                    rotation: quantizeAngle(frames[0].rotation),
                    scaleX: frames[0].scaleX,
                    scaleY: frames[0].scaleY
                });
                continue;
            }

            if (time >= frames[frames.length - 1].time) {
                // 在最后一个关键帧之后
                const last = frames[frames.length - 1];
                resultMap.set(boneName, {
                    x: last.x,
                    y: last.y,
                    rotation: quantizeAngle(last.rotation),
                    scaleX: last.scaleX,
                    scaleY: last.scaleY
                });
                continue;
            }

            // 二分查找 time 所在的关键帧区间
            let lo = 0;
            let hi = frames.length - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (time >= frames[mid].time) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }

            const prev = frames[lo];
            const next = frames[hi];
            const t = (time - prev.time) / (next.time - prev.time);

            // 旋转最短路径插值（处理跨越 0/360 边界）
            let rotDiff = next.rotation - prev.rotation;
            if (rotDiff > 180) rotDiff -= 360;
            if (rotDiff < -180) rotDiff += 360;

            resultMap.set(boneName, {
                x: prev.x + (next.x - prev.x) * t,
                y: prev.y + (next.y - prev.y) * t,
                rotation: quantizeAngle(prev.rotation + rotDiff * t),
                scaleX: prev.scaleX + (next.scaleX - prev.scaleX) * t,
                scaleY: prev.scaleY + (next.scaleY - prev.scaleY) * t
            });
        }

        return new SkeletonPose(resultMap);
    }

    /**
     * 获取在 [lastTime, currentTime] 时间范围内触发的事件列表。
     *
     * @param {number} lastTime - 上一帧的时间点（秒）
     * @param {number} currentTime - 当前帧的时间点（秒）
     * @returns {AnimationEvent[]} 在此区间内触发的事件
     *
     * @example
     * ```javascript
     * const events = clip.getEventsInRange(0.1, 0.25);
     * events.forEach(e => {
     *     if (e.name === 'hit') combatSystem.applyDamage();
     * });
     * ```
     */
    getEventsInRange(lastTime, currentTime) {
        return this._events.filter(e =>
            e.time > lastTime && e.time <= currentTime
        );
    }

    /**
     * 获取所有动画事件。
     * @returns {readonly AnimationEvent[]}
     */
    get events() {
        return this._events;
    }

    /**
     * 获取动画包含的骨骼名称列表。
     * @returns {string[]}
     */
    get boneNames() {
        return Object.keys(this._keyframes);
    }

    /**
     * 获取指定骨骼的关键帧数量。
     * @param {string} boneName
     * @returns {number}
     */
    keyframeCount(boneName) {
        return (this._keyframes[boneName] || []).length;
    }
}
