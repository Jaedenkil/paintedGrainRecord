// @ts-check

/**
 * @fileoverview
 * 骨骼纹理插槽——将 PIXI.Sprite 绑定到骨骼，每帧从 Bone 的世界变换同步位置/旋转/缩放。
 *
 * Slot 是"骨骼与表现"的桥梁：
 * - Bone 管理变换（纯数据）
 * - Slot 管理纹理（渲染物体）
 *
 * 核心接口 sync(bone)：读取 Bone 的世界变换，应用到内部的 PIXI.Sprite。
 *
 * @module render/Slot
 */

const DEG_TO_RAD = Math.PI / 180;

/**
 * 插槽配置选项。
 * @typedef {Object} SlotOptions
 * @property {number} [anchorX=0] - Sprite 锚点 X（0=左，0.5=中，1=右）
 * @property {number} [anchorY=0.5] - Sprite 锚点 Y（0=顶，0.5=中，1=底）
 * @property {number} [zOrder=0] - 渲染顺序（用于前后台肢体分层）
 * @property {boolean} [visible=true] - 初始可见性
 * @property {number} [offsetX=0] - 额外的像素偏移 X（相对骨骼挂载点）
 * @property {number} [offsetY=0] - 额外的像素偏移 Y
 */

/**
 * 骨骼纹理插槽。
 *
 * 每个 Slot 绑定一根骨骼和一个 PIXI.Sprite。
 * 每帧调用 sync(bone) 将骨骼的世界变换同步到 Sprite。
 *
 * @example
 * ```javascript
 * import { Slot } from './Slot.mjs';
 *
 * // 创建左臂插槽：锚定在左侧（肩关节），垂直居中
 * const armSlot = new Slot('arm_l', armTexture, {
 *     anchorX: 0,
 *     anchorY: 0.5,
 *     zOrder: 1  // 前台肢体
 * });
 *
 * // 每帧同步
 * armSlot.sync(skeleton.getBone('arm_l'));
 * ```
 */
export class Slot {
    /**
     * @param {string} boneName - 绑定的骨骼名称
     * @param {import('pixi.js').Texture} texture - 骨骼纹理
     * @param {SlotOptions} [options]
     */
    constructor(boneName, texture, options = {}) {
        const {
            anchorX = 0,
            anchorY = 0.5,
            zOrder = 0,
            visible = true,
            offsetX = 0,
            offsetY = 0
        } = options;

        /** 绑定的骨骼名称。 @readonly */
        this.boneName = boneName;

        /** 像素偏移。 @private */
        this._offsetX = offsetX;
        this._offsetY = offsetY;

        /** 内部 Sprite。 @private @type {import('pixi.js').Sprite} */
        this._sprite = new PIXI.Sprite(texture);
        this._sprite.anchor.set(anchorX, anchorY);
        this._sprite.zIndex = zOrder;
        this._sprite.visible = visible;
    }

    /**
     * 获取内部的 PIXI.Sprite。
     * @returns {import('pixi.js').Sprite}
     */
    get sprite() {
        return this._sprite;
    }

    /**
     * 从 Bone 的世界变换同步 Sprite 的位置/旋转/缩放。
     *
     * 同步内容：
     * - position.x/y = bone.worldX + offset
     * - rotation = bone.worldRotation（度 → 弧度）
     * - scale.x/y = bone.worldScale
     *
     * @param {import('../core/Bone.mjs').Bone} bone - 骨骼实例
     *
     * @example
     * ```javascript
     * slot.sync(skeleton.getBone('arm_l'));
     * ```
     */
    sync(bone) {
        const s = this._sprite;
        s.position.set(
            bone.worldX + this._offsetX,
            bone.worldY + this._offsetY
        );
        s.rotation = bone.worldRotation * DEG_TO_RAD;
        s.scale.set(bone.worldScaleX, bone.worldScaleY);
    }

    /**
     * 更新纹理。
     * @param {import('pixi.js').Texture} texture
     */
    setTexture(texture) {
        this._sprite.texture = texture;
    }

    /**
     * 获取当前纹理。
     * @returns {import('pixi.js').Texture}
     */
    get texture() {
        return this._sprite.texture;
    }

    /**
     * 设置可见性。
     * @param {boolean} visible
     */
    setVisible(visible) {
        this._sprite.visible = visible;
    }

    /**
     * 获取可见性。
     * @returns {boolean}
     */
    get visible() {
        return this._sprite.visible;
    }

    /**
     * 获取/设置 zOrder（渲染顺序）。
     * @param {number} z
     */
    set zOrder(z) {
        this._sprite.zIndex = z;
    }

    /** @returns {number} */
    get zOrder() {
        return this._sprite.zIndex;
    }

    /**
     * 销毁插槽，释放 Sprite 资源。
     * 调用后此实例不再可用。
     */
    destroy() {
        this._sprite.destroy({ texture: false, children: true });
        this._sprite = null;
    }
}
