// @ts-check

/**
 * @fileoverview
 * 角色容器——骨骼动画系统的顶层显示对象。
 *
 * CharacterSprite 是一个 PIXI.Container，内部包含：
 * - 多个 Slot Sprite（每根骨骼一个，由 BoneTextureAtlas 提供纹理）
 * - 阴影 Sprite
 * - 状态条容器（预留）
 *
 * 协作关系：
 * ```
 * CharacterSprite (PIXI.Container)
 *  ├── Slot sprites (多个 PIXI.Sprite，通过 Slot.sync(bone) 更新位置)
 *  ├── Shadow (PIXI.Sprite/Gfx)
 *  └── StatusBar (PIXI.Container, 预留)
 *
 * 数据驱动：
 *  controller.fixedUpdate(dt) → Skeleton.applyPose() → updateWorldTransform()
 *  CharacterSprite.syncSlots() → 读取每个 Bone 的 worldX/Y → 更新 Sprite 位置
 * ```
 *
 * @module render/CharacterSprite
 */

import { Skeleton, SKELETON_PRESETS } from '../core/Skeleton.mjs';
import { SkeletalAnimationController } from './SkeletalAnimationController.mjs';
import { Slot } from './Slot.mjs';
import { TILE_HALF_W, TILE_HALF_H, TILE_H } from './BlockSprite.mjs';
import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('CharacterSprite');

/**
 * 默认 zOrder 映射（骨架类型 → 骨骼名 → zIndex 偏移）。
 *
 * 约定：
 * - zIndex < 0  = 后台肢体（背向观众，在身体之后渲染）
 * - zIndex = 0  = 身体主体
 * - zIndex > 0  = 前台肢体（朝向观众，在身体之前渲染）
 *
 * @type {Object<string, Object<string, number>>}
 */
const DEFAULT_Z_ORDER = {
    humanoid: {
        root:  0,
        spine: 0,
        head:  0,
        arm_l: 1,   // 前台左臂
        arm_r: -1,  // 后台右臂
        leg_l: 1,   // 前台左腿
        leg_r: -1   // 后台右腿
    },
    quadruped: {
        root:    0,
        spine:   0,
        neck:    0,
        head:    0,
        leg_bl:  1,   // 前台后腿
        leg_br: -1,   // 后台后腿
        leg_fl:  1,   // 前台前腿
        leg_fr: -1    // 后台前腿
    },
    alien: {
        root:   0,
        spine:  0,
        head:   0,
        arm_1:  1,
        arm_2: -1,
        arm_3:  1,
        arm_4: -1,
        wing_l: 1,
        wing_r: -1,
        leg_1:  1,
        leg_2: -1
    }
};

/**
 * 角色容器配置。
 * @typedef {Object} CharacterSpriteOptions
 * @property {number} [x=0] - 初始世界 X 坐标
 * @property {number} [y=0] - 初始世界 Y 坐标
 * @property {number} [gridX=0] - 初始网格 X
 * @property {number} [gridY=0] - 初始网格 Y
 * @property {number} [gridZ=0] - 初始网格 Z（高度层）
 * @property {number} [shadowScale=1.5] - 阴影缩放
 * @property {Object<string, number>} [zOrderMap] - 自定义 zOrder 映射
 */

/**
 * 角色容器。
 *
 * 集成了 Skeleton、SkeletalAnimationController、BoneTextureAtlas 和 Slot，
 * 对外提供"角色"级别的接口。
 *
 * @example
 * ```javascript
 * import { CharacterSprite } from './CharacterSprite.mjs';
 * import { BoneTextureAtlas } from './BoneTextureAtlas.mjs';
 * import { AnimationClip } from '../core/AnimationClip.mjs';
 *
 * // 创建纹理集
 * const atlas = new BoneTextureAtlas({
 *     head:  PIXI.Texture.from('char/hero/head.png'),
 *     spine: PIXI.Texture.from('char/hero/body.png'),
 *     arm_l: PIXI.Texture.from('char/hero/arm_l.png'),
 *     arm_r: PIXI.Texture.from('char/hero/arm_r.png'),
 *     leg_l: PIXI.Texture.from('char/hero/leg_l.png'),
 *     leg_r: PIXI.Texture.from('char/hero/leg_r.png'),
 *     root:  PIXI.Texture.from('char/hero/hip.png')
 * });
 *
 * // 创建动画剪辑
 * const idleClip = new AnimationClip('idle', 1.0, { ... });
 *
 * // 创建角色
 * const hero = new CharacterSprite('humanoid', atlas, [idleClip], {
 *     gridX: 5, gridY: 3
 * });
 *
 * // 添加到图层
 * layerStack.addChild(hero, 4); // Layer 4 = Characters
 *
 * // 播放动画
 * hero.playAnimation('idle', { loop: true });
 * ```
 */
export class CharacterSprite extends PIXI.Container {
    /**
     * @param {string} skeletonType - 骨架类型（'humanoid' | 'quadruped' | 'alien'）
     * @param {import('./BoneTextureAtlas.mjs').BoneTextureAtlas} atlas - 骨骼纹理集
     * @param {import('../core/AnimationClip.mjs').AnimationClip[]} [clips=[]] - 初始动画剪辑列表
     * @param {CharacterSpriteOptions} [options]
     */
    constructor(skeletonType, atlas, clips = [], options = {}) {
        super();

        const {
            x = 0,
            y = 0,
            gridX = 0,
            gridY = 0,
            gridZ = 0,
            shadowScale = 1.5,
            zOrderMap
        } = options;

        /** 骨架类型。 @readonly */
        this.skeletonType = skeletonType;

        /** 网格坐标。 @private */
        this._gridX = gridX;
        this._gridY = gridY;
        this._gridZ = gridZ;

        // ==================== 核心组件 ====================

        /** @private @type {Skeleton} */
        this._skeleton = new Skeleton(skeletonType, { x, y });

        /** @private @type {SkeletalAnimationController} */
        this._controller = new SkeletalAnimationController(this._skeleton);

        /** @private @type {import('./BoneTextureAtlas.mjs').BoneTextureAtlas} */
        this._atlas = atlas;

        /** @private @type {Slot[]} */
        this._slots = [];

        // ==================== 构建插槽 ====================

        this._buildSlots(zOrderMap);

        // ==================== 阴影 ====================

        /** @private @type {import('pixi.js').Graphics} */
        this._shadow = new PIXI.Graphics();
        this._drawShadow(shadowScale);
        this.addChild(this._shadow);

        // ==================== 注册动画剪辑 ====================

        if (clips.length > 0) {
            this._controller.registerClips(clips);
        }

        // ==================== 更新网格位置 ====================

        this.setGridPosition(gridX, gridY, gridZ);
    }

    /**
     * 根据骨骼和纹理集构建插槽。
     * @private
     * @param {Object<string, number>|undefined} zOrderMap - 自定义 zOrder
     */
    _buildSlots(zOrderMap) {
        const boneNames = this._skeleton.getBoneNames();
        const zMap = zOrderMap || DEFAULT_Z_ORDER[this.skeletonType] || {};

        for (const boneName of boneNames) {
            const texture = this._atlas.getTexture(boneName);
            if (!texture) {
                log.warn(`[${this.skeletonType}] 骨骼 "${boneName}" 缺少纹理`);
                continue;
            }

            const zOrder = zMap[boneName] ?? 0;
            const slot = new Slot(boneName, texture, {
                anchorX: 0,
                anchorY: 0.5,
                zOrder
            });

            this._slots.push(slot);
            this.addChild(slot.sprite);
        }

        // 启用子对象 zIndex 排序
        this.sortableChildren = true;
    }

    /**
     * 绘制阴影（椭圆形）。
     * @private
     * @param {number} scale
     */
    _drawShadow(scale) {
        const g = this._shadow;
        g.clear();
        g.beginFill(0x000000, 0.25);
        g.drawEllipse(0, 0, 8 * scale, 4 * scale);
        g.endFill();
    }

    // ==================== 位置与网格 ====================

    /**
     * 设置网格坐标并转换为屏幕坐标。
     *
     * 屏幕坐标转换公式（与 BlockSprite 一致）：
     * ```
     * screenX = (gx - gy) * TILE_HALF_W
     * screenY = (gx + gy) * TILE_HALF_H - gz * TILE_H
     * ```
     *
     * @param {number} gx - 网格 X
     * @param {number} gy - 网格 Y
     * @param {number} [gz] - 网格 Z（高度层），默认保持当前值
     *
     * @example
     * ```javascript
     * hero.setGridPosition(5, 3, 0);
     * ```
     */
    setGridPosition(gx, gy, gz) {
        this._gridX = gx;
        this._gridY = gy;
        if (gz !== undefined) this._gridZ = gz;

        const screenX = (this._gridX - this._gridY) * TILE_HALF_W;
        const screenY = (this._gridX + this._gridY) * TILE_HALF_H - this._gridZ * TILE_H;

        // 更新骨架世界位置
        this._skeleton.setWorldPosition(screenX, screenY);

        // 更新阴影位置（角色脚底）
        this._shadow.position.set(screenX, screenY + (TILE_H * this._gridZ));

        // Y-Sort 排序键：角色高度层始终为 0（行走在地面）
        // 使角色在 Characters 层内按 (gx + gy) 顺序正确遮挡
        this.zIndex = (gx + gy) * Z_BASE;
    }

    /** 网格 X 坐标。 */
    get gridX() { return this._gridX; }

    /** 网格 Y 坐标。 */
    get gridY() { return this._gridY; }

    /** 网格 Z 坐标（高度层）。 */
    get gridZ() { return this._gridZ; }

    // ==================== 动画控制 ====================

    /**
     * 播放动画。
     *
     * @param {string} name - 动画名称
     * @param {import('./SkeletalAnimationController.mjs').PlayOptions} [options]
     *
     * @example
     * ```javascript
     * hero.playAnimation('walk', { loop: true });
     * hero.playAnimation('attack', { crossFade: 0.2 });
     * ```
     */
    playAnimation(name, options) {
        this._controller.play(name, options);
    }

    /**
     * 停止当前动画，重置骨架。
     */
    stopAnimation() {
        this._controller.stop();
    }

    /**
     * 暂停动画。
     */
    pauseAnimation() {
        this._controller.pause();
    }

    /**
     * 恢复动画。
     */
    resumeAnimation() {
        this._controller.resume();
    }

    /**
     * 获取动画控制器（用于高级控制）。
     * @returns {SkeletalAnimationController}
     */
    get controller() {
        return this._controller;
    }

    // ==================== 换装 ====================

    /**
     * 更换纹理集（换装）。
     *
     * 遍历所有 Slot，将纹理替换为 Atlas 中对应的新纹理。
     * Atlas 中不存在的骨骼保持原纹理不变。
     *
     * @param {import('./BoneTextureAtlas.mjs').BoneTextureAtlas} newAtlas - 新纹理集
     *
     * @example
     * ```javascript
     * hero.changeOutfit(armorAtlas);
     * ```
     */
    changeOutfit(newAtlas) {
        this._atlas = newAtlas;

        for (const slot of this._slots) {
            const texture = newAtlas.getTexture(slot.boneName);
            if (texture) {
                slot.setTexture(texture);
            }
        }
    }

    // ==================== 运行时更新 ====================

    /**
     * 固定步长更新——推进动画状态。
     *
     * 应在 GameLoop.fixedUpdate 中调用。
     * 内部委托给 SkeletalAnimationController.fixedUpdate。
     *
     * @param {number} dt - 固定步长时间增量（通常 1/60）
     * @returns {import('../core/AnimationClip.mjs').AnimationEvent[]} 本帧触发的动画事件
     *
     * @example
     * ```javascript
     * // GameLoop.fixedUpdate 中
     * const events = hero.fixedUpdate(1/60);
     * events.forEach(e => {
     *     if (e.name === 'footstep') playSound('step');
     * });
     * ```
     */
    fixedUpdate(dt) {
        // 委托给控制器（控制器内部已处理 applyPose + updateWorldTransform）
        return this._controller.fixedUpdate(dt);
    }

    /**
     * 可变帧率更新——同步插槽位置并处理视觉插值。
     *
     * 应在 GameLoop.variableUpdate 中调用。
     * 此方法：
     * 1. 调用 controller.updateInterpolated(interp) 做视觉插值
     * 2. 遍历所有 Slot，从骨骼世界变换同步 Sprite 位置
     *
     * @param {number} interp - 插值因子 (0~1)
     *
     * @example
     * ```javascript
     * // GameLoop.variableUpdate(interpolation) 中
     * hero.update(interpolation);
     * ```
     */
    update(interp = 0) {
        // 1. 视觉插值
        this._controller.updateInterpolated(interp);

        // 2. 同步所有插槽
        this._syncSlots();
    }

    /**
     * 同步所有 Slot 的 Sprite 位置。
     * @private
     */
    _syncSlots() {
        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];
            try {
                const bone = this._skeleton.getBone(slot.boneName);
                slot.sync(bone);
            } catch (err) {
                // 骨骼可能已被销毁，静默跳过
            }
        }
    }

    // ==================== 调试信息 ====================

    /**
     * 获取调试信息。
     *
     * @returns {Object}
     * @property {string} type - 骨架类型
     * @property {string|null} currentAnim - 当前动画名称
     * @property {number} boneCount - 骨骼数量
     * @property {number} slotCount - 插槽数量
     * @property {number} zIndex - 容器的 zIndex
     * @property {{ x: number, y: number }} worldPos - 世界位置
     * @property {{ x: number, y: number, z: number }} gridPos - 网格位置
     *
     * @example
     * ```javascript
     * if (debug.showStats) {
     *     const info = hero.getDebugInfo();
     *     // 显示 info.currentAnim, info.boneCount 等
     * }
     * ```
     */
    getDebugInfo() {
        return {
            type: this.skeletonType,
            currentAnim: this._controller.currentClipName,
            isPlaying: this._controller.isPlaying,
            progress: this._controller.progress,
            boneCount: this._skeleton.boneCount,
            slotCount: this._slots.length,
            zIndex: this.zIndex,
            worldPos: this._skeleton.getWorldPosition(),
            gridPos: {
                x: this._gridX,
                y: this._gridY,
                z: this._gridZ
            }
        };
    }

    // ==================== 生命周期 ====================

    /**
     * 销毁角色，释放所有资源。
     *
     * @param {Object} [options]
     * @param {boolean} [options.destroyTextures=false] - 是否同时销毁纹理
     * @param {boolean} [options.destroyChildren=true] - 是否销毁子对象
     */
    destroy(options = {}) {
        const { destroyTextures = false, destroyChildren = true } = options;

        // 销毁控制器
        this._controller.destroy();

        // 销毁插槽
        for (const slot of this._slots) {
            slot.destroy();
        }
        this._slots = [];

        // 销毁阴影
        this._shadow.destroy();

        // 清理引用
        this._skeleton = null;
        this._controller = null;
        this._atlas = null;

        // 调用父类销毁
        super.destroy({ children: destroyChildren });
    }
}
