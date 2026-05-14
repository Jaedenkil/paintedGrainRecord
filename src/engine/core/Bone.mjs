// @ts-check

/**
 * @fileoverview
 * 骨骼节点——骨架树中的一个节点。
 *
 * 每根骨骼包含：
 * - 本地变换（相对父骨骼的 x/y/rotation/scale）
 * - 世界变换（由本地变换经父子链累积得到）
 * - 子骨骼列表
 *
 * 设计意图：
 * Bone 本身不包含纹理。纹理由插槽（Slot）绑定到骨骼上，
 * 实现骨骼与表现的分离——同一套骨架可换不同的皮。
 *
 * @module core/Bone
 */

/**
 * 骨骼变换数据结构。
 * @typedef {Object} BoneTransform
 * @property {number} x - 水平偏移（像素）
 * @property {number} y - 垂直偏移（像素）
 * @property {number} rotation - 旋转角度（度），已量化为 45° 倍数
 * @property {number} scaleX - 水平缩放
 * @property {number} scaleY - 垂直缩放
 */

const DEG_PER_STEP = 45;

/**
 * 角度量化——将任意角度映射到最近的 8 方向角度（45° 倍数）。
 * 这是防止像素走样的核心措施：骨骼旋转永远对齐到像素网格的 8 个方位。
 *
 * @param {number} degrees - 原始角度
 * @returns {number} 量化后的角度（0, 45, 90, 135, 180, 225, 270, 315）
 *
 * @example
 * ```javascript
 * quantizeAngle(80);   // → 90
 * quantizeAngle(100);  // → 90
 * quantizeAngle(120);  // → 135
 * ```
 */
export function quantizeAngle(degrees) {
    const snapped = Math.round(degrees / DEG_PER_STEP) * DEG_PER_STEP;
    return ((snapped % 360) + 360) % 360;
}

/**
 * 骨骼节点。
 *
 * @example
 * ```javascript
 * import { Bone } from './Bone.mjs';
 *
 * const root = new Bone('root', { x: 100, y: 200 });
 * const spine = new Bone('spine', { x: 0, y: -8 });
 * root.addChild(spine);
 * root.updateWorldTransform();
 * ```
 */
export class Bone {
    /**
     * @param {string} name - 骨骼名称（如 'root', 'spine', 'arm_l'）
     * @param {Object} [options]
     * @param {number} [options.x=0] - 相对父骨骼挂载点的 X 偏移
     * @param {number} [options.y=0] - 相对父骨骼挂载点的 Y 偏移
     * @param {number} [options.rotation=0] - 本地旋转（角度制）
     * @param {number} [options.scaleX=1] - 本地水平缩放
     * @param {number} [options.scaleY=1] - 本地垂直缩放
     * @param {number} [options.length=0] - 骨骼长度（像素），用于子骨骼挂载点计算
     */
    constructor(name, options = {}) {
        const {
            x = 0,
            y = 0,
            rotation = 0,
            scaleX = 1,
            scaleY = 1,
            length = 0
        } = options;

        /** 骨骼名称。 @readonly */
        this.name = name;

        /** 本地变换（相对父骨骼）。 @private */
        this._local = { x, y, rotation: quantizeAngle(rotation), scaleX, scaleY };

        /** 世界变换（从根累加后的最终位置）。 @private */
        this._world = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

        /** 子骨骼列表。 @private @type {Bone[]} */
        this._children = [];

        /** 父骨骼引用。 @private @type {Bone|null} */
        this._parent = null;

        /** 骨骼长度（像素）。用于确定子骨骼挂载点。 */
        this.length = length;
    }

    // ==================== 层级管理 ====================

    /**
     * 添加子骨骼。
     * 子骨骼的世界变换将基于本骨骼的世界变换计算。
     *
     * @param {Bone} child - 要添加的子骨骼
     * @returns {Bone} 返回自身，支持链式调用
     *
     * @example
     * ```javascript
     * root.addChild(spine).addChild(head);
     * ```
     */
    addChild(child) {
        if (child._parent) {
            child._parent.removeChild(child);
        }
        child._parent = this;
        this._children.push(child);
        return this;
    }

    /**
     * 移除子骨骼。
     * @param {Bone} child
     * @returns {boolean} 是否成功移除
     */
    removeChild(child) {
        const idx = this._children.indexOf(child);
        if (idx !== -1) {
            this._children.splice(idx, 1);
            child._parent = null;
            return true;
        }
        return false;
    }

    /**
     * 获取子骨骼列表（只读）。
     * @returns {readonly Bone[]}
     */
    get children() {
        return this._children;
    }

    /**
     * 获取父骨骼。
     * @returns {Bone|null}
     */
    get parent() {
        return this._parent;
    }

    // ==================== 变换计算 ====================

    /**
     * 递归计算世界变换。
     *
     * 计算逻辑：
     * - 根骨骼：世界变换 = 本地变换
     * - 子骨骼：世界位置 = 父骨骼世界末端点 + 本地偏移旋转后的位置
     * - 世界旋转 = 父骨骼世界旋转 + 本地旋转（量化后）
     *
     * 调用此方法前，应确保父骨骼的世界变换已更新。
     */
    updateWorldTransform() {
        if (!this._parent) {
            // 根骨骼：世界变换 = 本地变换
            Object.assign(this._world, this._local);
        } else {
            const pw = this._parent._world;
            const pl = this._parent.length;
            // 父骨骼末端点（挂载点）
            const pEndX = pw.x + Math.cos(pw.rotation * Math.PI / 180) * pl;
            const pEndY = pw.y + Math.sin(pw.rotation * Math.PI / 180) * pl;

            // 本地偏移旋转后叠加到父骨骼末端点
            const cosR = Math.cos(pw.rotation * Math.PI / 180);
            const sinR = Math.sin(pw.rotation * Math.PI / 180);
            this._world.x = pEndX + this._local.x * cosR - this._local.y * sinR;
            this._world.y = pEndY + this._local.x * sinR + this._local.y * cosR;
            this._world.rotation = quantizeAngle(pw.rotation + this._local.rotation);
            this._world.scaleX = pw.scaleX * this._local.scaleX;
            this._world.scaleY = pw.scaleY * this._local.scaleY;
        }

        // 递归更新子骨骼
        for (let i = 0; i < this._children.length; i++) {
            this._children[i].updateWorldTransform();
        }
    }

    /**
     * 设置本地变换。
     * rotation 自动量化为 45° 倍数。
     *
     * @param {Partial<BoneTransform>} transform - 要设置的变换属性
     *
     * @example
     * ```javascript
     * arm.setTransform({ rotation: 90, x: 2 });
     * ```
     */
    setTransform(transform) {
        if (transform.x !== undefined) this._local.x = transform.x;
        if (transform.y !== undefined) this._local.y = transform.y;
        if (transform.rotation !== undefined) {
            this._local.rotation = quantizeAngle(transform.rotation);
        }
        if (transform.scaleX !== undefined) this._local.scaleX = transform.scaleX;
        if (transform.scaleY !== undefined) this._local.scaleY = transform.scaleY;
    }

    /**
     * 获取本地变换的快照副本。
     * @returns {BoneTransform}
     */
    getLocalTransform() {
        return { ...this._local };
    }

    /**
     * 获取世界变换的快照副本。
     * @returns {BoneTransform}
     */
    getWorldTransform() {
        return { ...this._world };
    }

    // ==================== 快捷访问 ====================

    /** 世界 X 坐标。 */
    get worldX() { return this._world.x; }

    /** 世界 Y 坐标。 */
    get worldY() { return this._world.y; }

    /** 世界旋转角度（已量化）。 */
    get worldRotation() { return this._world.rotation; }

    /** 世界水平缩放。 */
    get worldScaleX() { return this._world.scaleX; }

    /** 世界垂直缩放。 */
    get worldScaleY() { return this._world.scaleY; }

    /** 本地旋转角度。 */
    get localRotation() { return this._local.rotation; }
}
