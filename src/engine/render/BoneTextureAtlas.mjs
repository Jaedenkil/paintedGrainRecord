// @ts-check

/**
 * @fileoverview
 * 骨骼纹理集——将骨骼名称映射到 PIXI.Texture 的查找表。
 *
 * 设计意图：
 * 同一套骨架可以通过更换 BoneTextureAtlas 实现"换皮"。
 * 每个角色（CharacterSprite）持有一个 BoneTextureAtlas 实例，
 * 换装时只需将新 Atlas 传递给角色。
 *
 * @module render/BoneTextureAtlas
 */

/**
 * 骨骼纹理集——管理骨骼名 → PIXI.Texture 的映射。
 *
 * @example
 * ```javascript
 * import { BoneTextureAtlas } from './BoneTextureAtlas.mjs';
 *
 * // 从纹理映射表创建
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
 * // 换装
 * atlas.setTexture('arm_l', PIXI.Texture.from('char/hero/arm_armor.png'));
 * ```
 */
export class BoneTextureAtlas {
    /**
     * @param {Object<string, import('pixi.js').Texture>} [textureMap={}] - 初始纹理映射
     */
    constructor(textureMap = {}) {
        /**
         * 内部纹理映射表。
         * @private @type {Map<string, import('pixi.js').Texture>}
         */
        this._textures = new Map();

        // 导入初始纹理
        for (const [boneName, texture] of Object.entries(textureMap)) {
            this._textures.set(boneName, texture);
        }
    }

    /**
     * 获取指定骨骼的纹理。
     *
     * @param {string} boneName - 骨骼名称
     * @returns {import('pixi.js').Texture|undefined} 纹理，如果未注册则返回 undefined
     *
     * @example
     * ```javascript
     * const tex = atlas.getTexture('head');
     * if (tex) slot.setTexture(tex);
     * ```
     */
    getTexture(boneName) {
        return this._textures.get(boneName);
    }

    /**
     * 设置/替换指定骨骼的纹理。
     *
     * @param {string} boneName - 骨骼名称
     * @param {import('pixi.js').Texture} texture - 纹理
     *
     * @example
     * ```javascript
     * atlas.setTexture('arm_l', newArmorTexture);
     * ```
     */
    setTexture(boneName, texture) {
        this._textures.set(boneName, texture);
    }

    /**
     * 批量设置纹理。
     *
     * @param {Object<string, import('pixi.js').Texture>} textureMap - 骨骼名 → 纹理
     *
     * @example
     * ```javascript
     * atlas.setTextures({
     *     head:  PIXI.Texture.from('new/head.png'),
     *     spine: PIXI.Texture.from('new/body.png')
     * });
     * ```
     */
    setTextures(textureMap) {
        for (const [boneName, texture] of Object.entries(textureMap)) {
            this._textures.set(boneName, texture);
        }
    }

    /**
     * 检查指定骨骼是否有纹理注册。
     *
     * @param {string} boneName
     * @returns {boolean}
     */
    hasTexture(boneName) {
        return this._textures.has(boneName);
    }

    /**
     * 获取所有已注册的骨骼名称。
     * @returns {string[]}
     */
    get boneNames() {
        return Array.from(this._textures.keys());
    }

    /**
     * 获取已注册纹理数量。
     * @returns {number}
     */
    get count() {
        return this._textures.size;
    }

    /**
     * 克隆此 Atlas（浅拷贝纹理引用）。
     * @returns {BoneTextureAtlas}
     */
    clone() {
        const obj = {};
        for (const [name, tex] of this._textures) {
            obj[name] = tex;
        }
        return new BoneTextureAtlas(obj);
    }

    /**
     * 销毁所有纹理（仅当纹理由 Atlas 独有时调用）。
     * 如果纹理被多处引用，请勿调用此方法，以免影响其他实例。
     *
     * @param {boolean} [destroyTextures=false] - 是否同时销毁 PIXI.Texture
     */
    destroy(destroyTextures = false) {
        if (destroyTextures) {
            for (const texture of this._textures.values()) {
                texture.destroy();
            }
        }
        this._textures.clear();
    }
}
