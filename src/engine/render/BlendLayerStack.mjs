// @ts-check

/**
 * @fileoverview 动画混合层栈——管理叠加层和姿态混合算法。
 *
 * 混合层以叠加方式混合到基础动画之上，多个层按添加顺序依次叠加。
 * 典型场景：上半身攻击 + 下半身行走 / 受伤闪白覆盖 / 表情层叠加。
 *
 * @module render/BlendLayerStack
 */

import { SkeletonPose } from '../core/SkeletonPose.mjs';

/**
 * @typedef {Object} BlendLayerConfig
 * @property {import('../core/AnimationClip.mjs').AnimationClip} clip
 * @property {number} weight - 混合权重 (0~1)
 * @property {string[]} [bones] - 限制影响的骨骼名列表
 */

/**
 * 动画混合层栈。
 */
export class BlendLayerStack {
    constructor() {
        /** @private @type {Map<string, BlendLayerConfig>} */
        this._layers = new Map();
    }

    /**
     * 设置一个混合层。
     * @param {string} layerName @param {import('../core/AnimationClip.mjs').AnimationClip} clip
     * @param {number} weight (0~1) @param {string[]} [bones]
     */
    setLayer(layerName, clip, weight, bones) {
        this._layers.set(layerName, { clip, weight, bones });
    }

    /** @param {string} layerName */
    removeLayer(layerName) { this._layers.delete(layerName); }

    /** 清除所有混合层。*/
    clearLayers() { this._layers.clear(); }

    /**
     * 更新混合层权重。
     * @param {string} layerName @param {number} weight
     */
    setWeight(layerName, weight) {
        const layer = this._layers.get(layerName);
        if (layer) layer.weight = Math.max(0, Math.min(1, weight));
    }

    /** 混合层数量。@returns {number} */
    get count() { return this._layers.size; }

    /**
     * 将所有混合层应用到姿态。
     * @param {SkeletonPose} pose - 被修改的目标姿态
     * @param {number} currentTime - 当前动画时间（秒）
     */
    apply(pose, currentTime) {
        for (const [, layer] of this._layers) {
            if (layer.weight <= 0) continue;
            const blendPose = layer.clip.sample(currentTime);
            if (layer.bones && layer.bones.length > 0) {
                const filtered = this._filterBones(blendPose, layer.bones);
                const blended = SkeletonPose.blend(pose, filtered, layer.weight);
                this._mergeBack(pose, blended, layer.bones);
            } else {
                this._mergeAll(pose, SkeletonPose.blend(pose, blendPose, layer.weight));
            }
        }
    }

    // ==================== 私有辅助 ====================

    /**
     * 提取指定骨骼的变换。
     * @private @param {SkeletonPose} pose @param {string[]} names @returns {SkeletonPose}
     */
    _filterBones(pose, names) {
        const map = new Map();
        for (const name of names) {
            const t = pose.getBoneTransform(name);
            if (t) map.set(name, { ...t });
        }
        return new SkeletonPose(map);
    }

    /**
     * 将源姿态中指定骨骼变换合并回目标。
     * @private @param {SkeletonPose} target @param {SkeletonPose} source @param {string[]} names
     */
    _mergeBack(target, source, names) {
        for (const name of names) {
            const t = source.getBoneTransform(name);
            if (t) target.setBoneTransform(name, t);
        }
    }

    /**
     * 将源姿态中所有骨骼变换合并回目标。
     * @private @param {SkeletonPose} target @param {SkeletonPose} source
     */
    _mergeAll(target, source) {
        for (const name of source.boneNames()) {
            const t = source.getBoneTransform(name);
            if (t) target.setBoneTransform(name, t);
        }
    }
}
