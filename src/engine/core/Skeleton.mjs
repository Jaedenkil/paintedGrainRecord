// @ts-check

/**
 * @fileoverview
 * 骨架容器——从预设构建骨骼树，提供姿态应用/快照接口。纯数据层，不依赖渲染 API。
 * @module core/Skeleton
 */

import { Bone, quantizeAngle } from './Bone.mjs';
import { SkeletonPose } from './SkeletonPose.mjs';
import { SKELETON_PRESETS } from './SkeletonPresets.mjs';
export { SKELETON_PRESETS };

/** @typedef {import('./SkeletonPresets.mjs').BonePreset} BonePreset */
/** @typedef {import('./SkeletonPresets.mjs').SkeletonPreset} SkeletonPreset */

/**
 * 骨架容器。负责从预设构建骨骼树，提供姿态应用与快照接口。
 */
export class Skeleton {
    /**
     * @param {string|SkeletonPreset} typeOrPreset - 预设类型名或自定义预设
     * @param {Object} [options]
     * @param {number} [options.x=0] - 骨架世界 X
     * @param {number} [options.y=0] - 骨架世界 Y
     */
    constructor(typeOrPreset, options = {}) {
        const { x = 0, y = 0 } = options;

        /** @readonly */ this.type = typeof typeOrPreset === 'string' ? typeOrPreset : (typeOrPreset.type || 'custom');
        /** @private @type {Map<string, Bone>} */ this._boneMap = new Map();
        /** @private @type {Bone|null} */ this._root = null;

        const preset = typeof typeOrPreset === 'string' ? SKELETON_PRESETS[typeOrPreset] : typeOrPreset;
        if (!preset) {
            throw new Error(`[Skeleton] 未知的骨架类型 "${typeOrPreset}"。可用类型：${Object.keys(SKELETON_PRESETS).join(', ')}`);
        }
        this._buildFromPreset(preset, x, y);
    }

    /** @private 从预设定义构建骨骼树。*/
    _buildFromPreset(preset, originX, originY) {
        const bones = new Map();
        for (const bp of preset.bones) {
            bones.set(bp.name, new Bone(bp.name, {
                x: bp.x ?? 0, y: bp.y ?? 0, rotation: bp.rotation ?? 0,
                scaleX: bp.scaleX ?? 1, scaleY: bp.scaleY ?? 1, length: bp.length ?? 0
            }));
        }
        for (const bp of preset.bones) {
            if (bp.parent === null) {
                this._root = bones.get(bp.name);
                if (this._root) this._root.setTransform({ x: originX, y: originY });
            } else {
                const parent = bones.get(bp.parent);
                const child = bones.get(bp.name);
                if (parent && child) parent.addChild(child);
            }
        }
        for (const [name, bone] of bones) this._boneMap.set(name, bone);
        if (this._root) this._root.updateWorldTransform();
    }

    // ==================== 骨骼查询 ====================

    /**
     * 按名称获取骨骼实例。
     * @param {string} name
     * @returns {Bone}
     * @throws 如果骨骼不存在
     */
    getBone(name) {
        const bone = this._boneMap.get(name);
        if (!bone) throw new Error(`[Skeleton] 未找到骨骼 "${name}"。可用骨骼：${this.getBoneNames().join(', ')}`);
        return bone;
    }

    /** @returns {string[]} */ getBoneNames() { return Array.from(this._boneMap.keys()); }
    /** @returns {number} */ get boneCount() { return this._boneMap.size; }
    /** @returns {Bone|null} */ get root() { return this._root; }

    // ==================== 姿态操作 ====================

    /**
     * 快照当前所有骨骼的本地变换，返回 SkeletonPose。
     * @returns {SkeletonPose}
     */
    getPose() {
        const transforms = new Map();
        for (const [name, bone] of this._boneMap) transforms.set(name, bone.getLocalTransform());
        return new SkeletonPose(transforms);
    }

    /**
     * 将 SkeletonPose 中的变换写入各骨骼，并更新世界变换。
     * @param {SkeletonPose} pose
     */
    applyPose(pose) {
        for (const [name, transform] of pose.transforms) {
            const bone = this._boneMap.get(name);
            if (bone) bone.setTransform(transform);
        }
        this.updateWorldTransform();
    }

    /** 递归更新所有骨骼的世界变换。*/
    updateWorldTransform() {
        if (this._root) this._root.updateWorldTransform();
    }

    // ==================== 工具方法 ====================

    /** 重置所有骨骼到预设的初始姿态。*/
    resetPose() {
        const preset = SKELETON_PRESETS[this.type];
        if (!preset) return;
        for (const bp of preset.bones) {
            const bone = this._boneMap.get(bp.name);
            if (bone) {
                bone.setTransform({
                    x: bp.x ?? 0, y: bp.y ?? 0, rotation: bp.rotation ?? 0,
                    scaleX: bp.scaleX ?? 1, scaleY: bp.scaleY ?? 1
                });
            }
        }
        this.updateWorldTransform();
    }

    /** 设置骨架的世界坐标。@param {number} x @param {number} y */
    setWorldPosition(x, y) {
        if (this._root) { this._root.setTransform({ x, y }); this.updateWorldTransform(); }
    }

    /** @returns {{ x: number, y: number }} */
    getWorldPosition() {
        if (this._root) return { x: this._root.worldX, y: this._root.worldY };
        return { x: 0, y: 0 };
    }
}
