// @ts-check

/**
 * @fileoverview
 * 骨架容器——从预设构建骨骼树，提供姿态应用/快照接口。
 *
 * Skeleton 负责三件事：
 * 1. 从 SKELETON_PRESETS 构建骨骼树（Bone 的父子链接）
 * 2. applyPose(pose) — 将 SkeletonPose 的变换写入各骨骼
 * 3. getPose() — 快照当前所有骨骼的本地变换为 SkeletonPose
 *
 * Skeleton 与渲染完全无关，是纯数据层。
 *
 * @module core/Skeleton
 */

import { Bone, quantizeAngle } from './Bone.mjs';
import { SkeletonPose } from './SkeletonPose.mjs';

// ==================== 骨骼预设定义 ====================

/**
 * 单根骨骼的预设定义。
 * @typedef {Object} BonePreset
 * @property {string} name - 骨骼名称
 * @property {number} [x=0] - 相对父骨骼挂载点的 X 偏移
 * @property {number} [y=0] - 相对父骨骼挂载点的 Y 偏移
 * @property {number} [rotation=0] - 本地旋转（角度）
 * @property {number} [scaleX=1] - 水平缩放
 * @property {number} [scaleY=1] - 垂直缩放
 * @property {number} [length=0] - 骨骼长度（像素）
 * @property {string|null} [parent=null] - 父骨骼名称，null 表示根
 */

/**
 * 骨架类型预设。
 * @typedef {Object} SkeletonPreset
 * @property {string} type - 类型名
 * @property {string} description - 描述
 * @property {BonePreset[]} bones - 骨骼定义数组
 */

/**
 * 骨骼预设集合。
 *
 * 坐标约定：
 * - 所有角色面朝屏幕右侧
 * - +X = 右，+Y = 下（屏幕坐标）
 * - 旋转角度以度为单位，会被自动量化到 45° 倍数
 * - 长度（length）为子骨骼的挂载点偏移量
 *
 * @type {Object<string, SkeletonPreset>}
 */
export const SKELETON_PRESETS = {

    /**
     * 人形骨骼（7 根骨骼）。
     *
     * 结构：root → spine (→ head, arm_l, arm_r), leg_l, leg_r
     * 适用：玩家、NPC 人类、人形怪物
     */
    humanoid: {
        type: 'humanoid',
        description: '人形骨骼，7 根骨骼：root → spine(→head, arm_l, arm_r), leg_l, leg_r',
        bones: [
            // 根骨骼（髋部中心）
            { name: 'root',   x: 0,  y: 0,   parent: null, length: 0 },

            // 躯干（向上延伸）
            { name: 'spine',  x: 0,  y: -18, parent: 'root',  length: 0 },

            // 头部（脊柱顶端）
            { name: 'head',   x: 0,  y: -14, parent: 'spine', length: 0 },

            // 左臂（脊柱右上方，朝向观众——前台肢体）
            { name: 'arm_l',  x: 7,  y: -10, parent: 'spine', length: 12 },

            // 右臂（脊柱左上方，背向观众——后台肢体）
            { name: 'arm_r',  x: -7, y: -10, parent: 'spine', length: 12 },

            // 左腿（根骨右下方，前台肢体）
            { name: 'leg_l',  x: 5,  y: 0,   parent: 'root',  length: 14 },

            // 右腿（根骨左下方，后台肢体）
            { name: 'leg_r',  x: -5, y: 0,   parent: 'root',  length: 14 }
        ]
    },

    /**
     * 四足骨骼（8 根骨骼）。
     *
     * 结构：root → spine (→ neck → head, leg_bl, leg_br), leg_fl, leg_fr
     * 适用：狼、虎、灵兽等四足动物
     */
    quadruped: {
        type: 'quadruped',
        description: '四足骨骼，8 根骨骼：root → spine(→neck→head, leg_bl, leg_br), leg_fl, leg_fr',
        bones: [
            // 根骨骼（后髋部）
            { name: 'root',    x: 0,   y: 0,   parent: null, length: 0 },

            // 躯干（从后髋向前延伸）
            { name: 'spine',   x: 10,  y: -14, parent: 'root',  length: 10 },

            // 颈部（躯干前端向上）
            { name: 'neck',    x: 10,  y: -6,  parent: 'spine', length: 0 },

            // 头部（颈部顶端）
            { name: 'head',    x: 0,   y: -6,  parent: 'neck',  length: 0 },

            // 后左腿（朝向观众）
            { name: 'leg_bl',  x: -6,  y: 0,   parent: 'spine', length: 14 },

            // 后右腿（背向观众）
            { name: 'leg_br',  x: 6,   y: 0,   parent: 'spine', length: 14 },

            // 前左腿（根骨附近，朝向观众）
            { name: 'leg_fl',  x: -6,  y: 6,   parent: 'root',  length: 14 },

            // 前右腿（根骨附近，背向观众）
            { name: 'leg_fr',  x: 6,   y: 6,   parent: 'root',  length: 14 }
        ]
    },

    /**
     * 异形骨骼（11 根骨骼）。
     *
     * 结构：root → spine (→ head, arm_1~4, wing_l, wing_r), leg_1, leg_2
     * 适用：妖魔、多臂 Boss、触手系怪物
     */
    alien: {
        type: 'alien',
        description: '异形骨骼，11 根骨骼：root → spine(→head, arm_1~4, wing_l, wing_r), leg_1, leg_2',
        bones: [
            // 根骨骼
            { name: 'root',   x: 0,   y: 0,   parent: null, length: 0 },

            // 脊柱
            { name: 'spine',  x: 0,   y: -22, parent: 'root',  length: 0 },

            // 头部
            { name: 'head',   x: 0,   y: -18, parent: 'spine', length: 0 },

            // 四臂（两组前后臂）
            { name: 'arm_1',  x: 10,  y: -14, parent: 'spine', length: 14 },
            { name: 'arm_2',  x: -10, y: -14, parent: 'spine', length: 14 },
            { name: 'arm_3',  x: 12,  y: -4,  parent: 'spine', length: 12 },
            { name: 'arm_4',  x: -12, y: -4,  parent: 'spine', length: 12 },

            // 双翼/触手
            { name: 'wing_l', x: 6,   y: -16, parent: 'spine', length: 12 },
            { name: 'wing_r', x: -6,  y: -16, parent: 'spine', length: 12 },

            // 双腿
            { name: 'leg_1',  x: 8,   y: 0,   parent: 'root',  length: 16 },
            { name: 'leg_2',  x: -8,  y: 0,   parent: 'root',  length: 16 }
        ]
    }
};

// ==================== Skeleton 类 ====================

/**
 * 骨架容器。
 *
 * 负责从预设或自定义定义构建骨骼树，并提供姿态应用与快照接口。
 * Skeleton 本身是纯数据层，不依赖任何渲染 API。
 *
 * @example
 * ```javascript
 * import { Skeleton, SKELETON_PRESETS } from './Skeleton.mjs';
 * import { SkeletonPose } from './SkeletonPose.mjs';
 *
 * // 创建人形骨架
 * const skeleton = new Skeleton('humanoid');
 *
 * // 获取当前姿态快照
 * const pose = skeleton.getPose();
 *
 * // 修改手臂角度
 * pose.setBoneTransform('arm_l', { x: 0, y: 0, rotation: -90, scaleX: 1, scaleY: 1 });
 * skeleton.applyPose(pose);
 * skeleton.updateWorldTransform();
 *
 * // 读取世界坐标
 * const armWorld = skeleton.getBone('arm_l').getWorldTransform();
 * ```
 */
export class Skeleton {
    /**
     * @param {string|SkeletonPreset} typeOrPreset - 预设类型名或自定义预设对象
     * @param {Object} [options]
     * @param {number} [options.x=0] - 骨架世界 X 坐标
     * @param {number} [options.y=0] - 骨架世界 Y 坐标
     */
    constructor(typeOrPreset, options = {}) {
        const { x = 0, y = 0 } = options;

        /**
         * 骨架类型名。
         * @readonly
         */
        this.type = typeof typeOrPreset === 'string'
            ? typeOrPreset
            : (typeOrPreset.type || 'custom');

        /**
         * 骨骼名称 → Bone 实例的映射，用于 O(1) 查找。
         * @private @type {Map<string, Bone>}
         */
        this._boneMap = new Map();

        /**
         * 根骨骼引用。
         * @private @type {Bone|null}
         */
        this._root = null;

        // 解析预设并构建骨骼树
        const preset = typeof typeOrPreset === 'string'
            ? SKELETON_PRESETS[typeOrPreset]
            : typeOrPreset;

        if (!preset) {
            throw new Error(
                `[Skeleton] 未知的骨架类型 "${typeOrPreset}"。` +
                `可用类型：${Object.keys(SKELETON_PRESETS).join(', ')}`
            );
        }

        this._buildFromPreset(preset, x, y);
    }

    /**
     * 从预设定义构建骨骼树。
     * @private
     * @param {SkeletonPreset} preset - 预设定义
     * @param {number} originX - 根骨骼 X
     * @param {number} originY - 根骨骼 Y
     */
    _buildFromPreset(preset, originX, originY) {
        // 第一步：创建所有 Bone 实例（不链接父子关系）
        /** @type {Map<string, Bone>} */
        const bones = new Map();

        for (const bp of preset.bones) {
            const bone = new Bone(bp.name, {
                x: bp.x ?? 0,
                y: bp.y ?? 0,
                rotation: bp.rotation ?? 0,
                scaleX: bp.scaleX ?? 1,
                scaleY: bp.scaleY ?? 1,
                length: bp.length ?? 0
            });
            bones.set(bp.name, bone);
        }

        // 第二步：建立父子链接
        for (const bp of preset.bones) {
            if (bp.parent === null) {
                // 根骨骼
                this._root = bones.get(bp.name);
                if (this._root) {
                    this._root.setTransform({ x: originX, y: originY });
                }
            } else {
                const parent = bones.get(bp.parent);
                const child = bones.get(bp.name);
                if (parent && child) {
                    parent.addChild(child);
                }
            }
        }

        // 第三步：填充 _boneMap
        for (const [name, bone] of bones) {
            this._boneMap.set(name, bone);
        }

        // 第四步：初始化世界变换
        if (this._root) {
            this._root.updateWorldTransform();
        }
    }

    // ==================== 骨骼查询 ====================

    /**
     * 按名称获取骨骼实例。
     *
     * @param {string} name - 骨骼名称
     * @returns {Bone} 骨骼实例
     * @throws {Error} 如果骨骼不存在
     *
     * @example
     * ```javascript
     * const arm = skeleton.getBone('arm_l');
     * arm.setTransform({ rotation: -90 });
     * ```
     */
    getBone(name) {
        const bone = this._boneMap.get(name);
        if (!bone) {
            throw new Error(
                `[Skeleton] 未找到骨骼 "${name}"。` +
                `可用骨骼：${this.getBoneNames().join(', ')}`
            );
        }
        return bone;
    }

    /**
     * 获取所有骨骼名称列表。
     * @returns {string[]}
     */
    getBoneNames() {
        return Array.from(this._boneMap.keys());
    }

    /**
     * 获取骨骼数量。
     * @returns {number}
     */
    get boneCount() {
        return this._boneMap.size;
    }

    /**
     * 获取根骨骼。
     * @returns {Bone|null}
     */
    get root() {
        return this._root;
    }

    // ==================== 姿态操作 ====================

    /**
     * 快照当前所有骨骼的本地变换，返回 SkeletonPose。
     *
     * 用途：
     * - 保存当前姿态，后续通过 applyPose 恢复
     * - 作为 blend 操作的基础姿态
     *
     * @returns {SkeletonPose}
     *
     * @example
     * ```javascript
     * const currentPose = skeleton.getPose();
     * // 做一些修改 ...
     * skeleton.applyPose(currentPose); // 恢复
     * ```
     */
    getPose() {
        /** @type {Map<string, import('./Bone.mjs').BoneTransform>} */
        const transforms = new Map();

        for (const [name, bone] of this._boneMap) {
            transforms.set(name, bone.getLocalTransform());
        }

        return new SkeletonPose(transforms);
    }

    /**
     * 将 SkeletonPose 中的变换写入各骨骼，并更新世界变换。
     *
     * @param {SkeletonPose} pose - 要应用的姿态
     *
     * @example
     * ```javascript
     * const pose = clip.sample(0.3);
     * skeleton.applyPose(pose);
     * // 之后可以通过 bone.worldX/Y 读取世界坐标
     * ```
     */
    applyPose(pose) {
        for (const [name, transform] of pose.transforms) {
            const bone = this._boneMap.get(name);
            if (bone) {
                bone.setTransform(transform);
            }
        }
        this.updateWorldTransform();
    }

    /**
     * 递归更新所有骨骼的世界变换。
     * 在修改任意骨骼的本地变换后必须调用此方法，世界坐标才会生效。
     */
    updateWorldTransform() {
        if (this._root) {
            this._root.updateWorldTransform();
        }
    }

    // ==================== 工具方法 ====================

    /**
     * 重置所有骨骼到预设的初始姿态。
     */
    resetPose() {
        const type = this.type;
        const preset = SKELETON_PRESETS[type];
        if (!preset) return;

        for (const bp of preset.bones) {
            const bone = this._boneMap.get(bp.name);
            if (bone) {
                bone.setTransform({
                    x: bp.x ?? 0,
                    y: bp.y ?? 0,
                    rotation: bp.rotation ?? 0,
                    scaleX: bp.scaleX ?? 1,
                    scaleY: bp.scaleY ?? 1
                });
            }
        }
        this.updateWorldTransform();
    }

    /**
     * 设置骨架的世界坐标（移动根骨骼位置）。
     *
     * @param {number} x - 新的世界 X 坐标
     * @param {number} y - 新的世界 Y 坐标
     *
     * @example
     * ```javascript
     * skeleton.setWorldPosition(320, 240);
     * ```
     */
    setWorldPosition(x, y) {
        if (this._root) {
            this._root.setTransform({ x, y });
            this.updateWorldTransform();
        }
    }

    /**
     * 获取骨架的世界位置（根骨骼世界坐标）。
     * @returns {{ x: number, y: number }}
     */
    getWorldPosition() {
        if (this._root) {
            return { x: this._root.worldX, y: this._root.worldY };
        }
        return { x: 0, y: 0 };
    }
}
