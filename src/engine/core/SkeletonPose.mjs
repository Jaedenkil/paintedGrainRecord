// @ts-check

/**
 * @fileoverview
 * 姿态快照——所有骨骼在某个时刻的本地变换的快照。
 *
 * 用途：
 * 1. 动画关键帧间插值：lerp(poseA, poseB, t)
 * 2. 动作混合：attackPose * 0.7 + walkPose * 0.3
 * 3. 保存/恢复骨架状态
 *
 * SkeletonPose 与 AnimationClip 的关系：
 * AnimationClip 存储的是 "关键帧时间线上的 BoneTransform 序列"，
 * SkeletonPose 则是 "某个时间点所有骨骼变换的冻结快照"。
 * 动画控制器每帧从 AnimationClip 采样得到 SkeletonPose，然后应用到 Skeleton。
 *
 * @module core/SkeletonPose
 */

import { quantizeAngle } from './Bone.mjs';

/**
 * 单根骨骼的变换数据。
 * @typedef {import('./Bone.mjs').BoneTransform} BoneTransform
 */

/**
 * 姿态快照。
 *
 * @example
 * ```javascript
 * import { SkeletonPose } from './SkeletonPose.mjs';
 *
 * const poseA = new SkeletonPose(new Map([
 *   ['arm_l', { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }]
 * ]));
 * const poseB = new SkeletonPose(new Map([
 *   ['arm_l', { x: 0, y: 0, rotation: 90, scaleX: 1, scaleY: 1 }]
 * ]));
 * const mid = SkeletonPose.lerp(poseA, poseB, 0.5);
 * // mid 中 arm_l 的 rotation = 45
 * ```
 */
export class SkeletonPose {
    /**
     * @param {Map<string, BoneTransform>} boneTransforms - 骨骼名 → 变换的映射
     */
    constructor(boneTransforms) {
        /**
         * 骨骼变换映射。
         * @private @type {Map<string, BoneTransform>}
         */
        this._transforms = new Map(boneTransforms);
    }

    /**
     * 获取指定骨骼的变换。
     * @param {string} boneName
     * @returns {BoneTransform|undefined}
     */
    getBoneTransform(boneName) {
        return this._transforms.get(boneName);
    }

    /**
     * 设置指定骨骼的变换。
     * @param {string} boneName
     * @param {BoneTransform} transform
     */
    setBoneTransform(boneName, transform) {
        this._transforms.set(boneName, { ...transform });
    }

    /**
     * 获取所有骨骼名称的迭代器。
     * @returns {IterableIterator<string>}
     */
    boneNames() {
        return this._transforms.keys();
    }

    /**
     * 获取内部变换 Map（只读）。
     * @returns {ReadonlyMap<string, BoneTransform>}
     */
    get transforms() {
        return this._transforms;
    }

    /**
     * 返回此姿态的深拷贝副本。
     * @returns {SkeletonPose}
     */
    clone() {
        const cloned = new Map();
        for (const [name, t] of this._transforms) {
            cloned.set(name, { ...t });
        }
        return new SkeletonPose(cloned);
    }

    /**
     * 线性插值两个姿态。
     *
     * 对每根骨骼的 x/y/rotation/scaleX/scaleY 分别做线性插值。
     * rotation 插值后重新量化确保为 45° 倍数。
     *
     * @param {SkeletonPose} a - 起始姿态（t=0）
     * @param {SkeletonPose} b - 结束姿态（t=1）
     * @param {number} t - 插值因子 (0~1)
     * @returns {SkeletonPose} 新的插值结果姿态
     *
     * @example
     * ```javascript
     * const walkPose = SkeletonPose.lerp(idlePose, stepPose, 0.5);
     * ```
     */
    static lerp(a, b, t) {
        const result = new Map();
        const allBones = new Set([
            ...a._transforms.keys(),
            ...b._transforms.keys()
        ]);

        for (const name of allBones) {
            const ta = a._transforms.get(name) || { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
            const tb = b._transforms.get(name) || { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

            // 对旋转做最短路径插值（处理跨越 0/360 边界的情况）
            let rotDiff = tb.rotation - ta.rotation;
            if (rotDiff > 180) rotDiff -= 360;
            if (rotDiff < -180) rotDiff += 360;

            result.set(name, {
                x: ta.x + (tb.x - ta.x) * t,
                y: ta.y + (tb.y - ta.y) * t,
                rotation: quantizeAngle(ta.rotation + rotDiff * t),
                scaleX: ta.scaleX + (tb.scaleX - ta.scaleX) * t,
                scaleY: ta.scaleY + (tb.scaleY - ta.scaleY) * t
            });
        }

        return new SkeletonPose(result);
    }

    /**
     * 混合两个姿态（按权重叠加）。
     *
     * 与 lerp 不同，blend 是将 b 叠加到 a 之上：
     * - position: a + b * weight
     * - rotation: a.rotation + b.rotation * weight（然后量化）
     * - scale: a * (b * weight)
     *
     * 适用于"上身攻击 + 下身行走"的局部混合场景。
     *
     * @param {SkeletonPose} base - 基础姿态
     * @param {SkeletonPose} overlay - 叠加姿态
     * @param {number} weight - 叠加权重 (0~1)
     * @returns {SkeletonPose}
     */
    static blend(base, overlay, weight) {
        const result = base.clone();

        for (const [name, bo] of overlay._transforms) {
            const ba = result._transforms.get(name);
            if (ba) {
                ba.x += bo.x * weight;
                ba.y += bo.y * weight;
                ba.rotation = quantizeAngle(ba.rotation + bo.rotation * weight);
                ba.scaleX *= 1 + (bo.scaleX - 1) * weight;
                ba.scaleY *= 1 + (bo.scaleY - 1) * weight;
            } else {
                result._transforms.set(name, {
                    x: bo.x * weight,
                    y: bo.y * weight,
                    rotation: quantizeAngle(bo.rotation * weight),
                    scaleX: 1 + (bo.scaleX - 1) * weight,
                    scaleY: 1 + (bo.scaleY - 1) * weight
                });
            }
        }

        return result;
    }

    /**
     * 检查姿态中是否包含指定骨骼。
     * @param {string} boneName
     * @returns {boolean}
     */
    hasBone(boneName) {
        return this._transforms.has(boneName);
    }

    /**
     * 获取姿态包含的骨骼数量。
     * @returns {number}
     */
    get boneCount() {
        return this._transforms.size;
    }
}
