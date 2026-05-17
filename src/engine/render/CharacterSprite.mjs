// @ts-check

/**
 * @fileoverview
 * 角色容器——骨骼动画系统的顶层显示对象。集成了 Skeleton、SkeletalAnimationController、BoneTextureAtlas 和 Slot。
 * @module render/CharacterSprite
 */

import { Skeleton } from '../core/Skeleton.mjs';
import { SkeletalAnimationController } from './SkeletalAnimationController.mjs';
import { Slot } from './Slot.mjs';
import { TILE_HALF_W, TILE_HALF_H, TILE_H, Z_BASE } from './BlockSprite.mjs';
import { Logger } from '../utils/Logger.mjs';
import { DEFAULT_Z_ORDER } from './CharacterZOrder.mjs';

const log = Logger.for('CharacterSprite');

/**
 * @typedef {Object} CharacterSpriteOptions
 * @property {number} [x=0] - 初始世界 X
 * @property {number} [y=0] - 初始世界 Y
 * @property {number} [gridX=0] - 初始网格 X
 * @property {number} [gridY=0] - 初始网格 Y
 * @property {number} [gridZ=0] - 初始网格 Z（高度层）
 * @property {number} [shadowScale=1.5] - 阴影缩放
 * @property {Object<string, number>} [zOrderMap] - 自定义 zOrder 映射
 */

/**
 * 角色容器——集成了 Skeleton、SkeletalAnimationController、BoneTextureAtlas 和 Slot，对外提供"角色"级别接口。
 * @extends PIXI.Container
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

        const { x = 0, y = 0, gridX = 0, gridY = 0, gridZ = 0, shadowScale = 1.5, zOrderMap } = options;

        /** @readonly */ this.skeletonType = skeletonType;
        /** @private */ this._gridX = gridX; this._gridY = gridY; this._gridZ = gridZ;

        /** @private @type {Skeleton} */ this._skeleton = new Skeleton(skeletonType, { x, y });
        /** @private @type {SkeletalAnimationController} */ this._controller = new SkeletalAnimationController(this._skeleton);
        /** @private @type {import('./BoneTextureAtlas.mjs').BoneTextureAtlas} */ this._atlas = atlas;
        /** @private @type {Slot[]} */ this._slots = [];

        this._buildSlots(zOrderMap);

        /** @private @type {import('pixi.js').Graphics} */ this._shadow = new PIXI.Graphics();
        this._drawShadow(shadowScale);
        this.addChild(this._shadow);

        if (clips.length > 0) this._controller.registerClips(clips);
        this.setGridPosition(gridX, gridY, gridZ);
    }

    /** @private 根据骨骼和纹理集构建插槽。*/
    _buildSlots(zOrderMap) {
        const boneNames = this._skeleton.getBoneNames();
        const zMap = zOrderMap || DEFAULT_Z_ORDER[this.skeletonType] || {};

        for (const boneName of boneNames) {
            const tex = this._atlas.getTexture(boneName);
            if (!tex) { log.warn(`[${this.skeletonType}] 骨骼 "${boneName}" 缺少纹理`); continue; }

            const slot = new Slot(boneName, tex, { anchorX: 0, anchorY: 0.5, zOrder: zMap[boneName] ?? 0 });
            this._slots.push(slot);
            this.addChild(slot.sprite);
        }
        this.sortableChildren = true;
    }

    /** @private 绘制阴影（椭圆形）。*/
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
     * screenX = (gx - gy) * TILE_HALF_W, screenY = (gx + gy) * TILE_HALF_H - gz * TILE_H。
     * @param {number} gx - 网格 X
     * @param {number} gy - 网格 Y
     * @param {number} [gz] - 网格 Z，默认保持当前值
     */
    setGridPosition(gx, gy, gz) {
        this._gridX = gx; this._gridY = gy;
        if (gz !== undefined) this._gridZ = gz;

        const sx = (gx - gy) * TILE_HALF_W;
        const sy = (gx + gy) * TILE_HALF_H - this._gridZ * TILE_H;

        this._skeleton.setWorldPosition(sx, sy);
        this._shadow.position.set(sx, sy + TILE_H * this._gridZ);
        this.zIndex = (gx + gy) * Z_BASE;
    }

    /** @type {number} */ get gridX() { return this._gridX; }
    /** @type {number} */ get gridY() { return this._gridY; }
    /** @type {number} */ get gridZ() { return this._gridZ; }

    // ==================== 动画控制 ====================

    /** @param {string} name @param {import('./SkeletalAnimationController.mjs').PlayOptions} [options] */
    playAnimation(name, options) { this._controller.play(name, options); }
    /** 停止动画。*/ stopAnimation() { this._controller.stop(); }
    /** 暂停动画。*/ pauseAnimation() { this._controller.pause(); }
    /** 恢复动画。*/ resumeAnimation() { this._controller.resume(); }
    /** @returns {SkeletalAnimationController} */ get controller() { return this._controller; }

    // ==================== 换装 ====================

    /** 更换纹理集。@param {import('./BoneTextureAtlas.mjs').BoneTextureAtlas} newAtlas */
    changeOutfit(newAtlas) {
        this._atlas = newAtlas;
        for (const slot of this._slots) {
            const tex = newAtlas.getTexture(slot.boneName);
            if (tex) slot.setTexture(tex);
        }
    }

    // ==================== 运行时更新 ====================

    /** 固定步长更新。@param {number} dt @returns {import('../core/AnimationClip.mjs').AnimationEvent[]} */
    fixedUpdate(dt) { return this._controller.fixedUpdate(dt); }

    /** 可变帧率更新——视觉插值 + 同步插槽。@param {number} [interp=0] */
    update(interp = 0) {
        this._controller.updateInterpolated(interp);
        this._syncSlots();
    }

    /** @private 同步所有 Slot 的 Sprite 位置。*/
    _syncSlots() {
        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];
            try {
                const bone = this._skeleton.getBone(slot.boneName);
                slot.sync(bone);
            } catch (err) { /* 骨骼可能已被销毁，静默跳过 */ }
        }
    }

    // ==================== 调试信息 ====================

    /** @returns {Object} */
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
            gridPos: { x: this._gridX, y: this._gridY, z: this._gridZ }
        };
    }

    // ==================== 生命周期 ====================

    /** 销毁角色，释放所有资源。@param {Object} [options] */
    destroy(options = {}) {
        const { destroyTextures = false, destroyChildren = true } = options;

        this._controller.destroy();
        for (const slot of this._slots) slot.destroy();
        this._slots = [];
        this._shadow.destroy();

        this._skeleton = null;
        this._controller = null;
        this._atlas = null;

        super.destroy({ children: destroyChildren });
    }
}
