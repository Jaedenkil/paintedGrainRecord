// @ts-check

/**
 * @fileoverview
 * 2.5D 斜角方块精灵容器 — 渲染系统的"乐高积木"（精简版 P0.1）。
 *
 * 组合三面 Sprite（顶/左/右）实现网格坐标到等轴屏幕坐标的变换。
 * 纹理加载/变换/装配委托至 BlockTextureAssembler，
 * 精灵布局委托至 BlockFaceLayout，
 * 常量定义委托至 BlockConstants。
 *
 * @module render/block/BlockSprite
 */

import { Logger } from '../../utils/Logger.mjs';
import {
    TILE_HALF_W, TILE_HALF_H, Z_BASE, TILE_H
} from './BlockConstants.mjs';
import { MISSING_TEXTURE } from './BlockTextureMap.mjs';
import {
    applyTexture,
    setIsoFaces,
    setAssembledTexture,
    getOrCreateAssembledSprite,
    resolveTexturePaths
} from './BlockTextureAssembler.mjs';
import { layoutDefault, showSeparateFaces } from './BlockFaceLayout.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('BlockSprite');

/** @private @type {number} 单调递增的方块 ID 计数器 */
let _blockIdCounter = 0;

/**
 * 2.5D 斜角方块精灵配置
 * @typedef {Object} BlockSpriteOptions
 * @property {string} [blockType='grass']
 * @property {string} [topTexture]
 * @property {string} [leftTexture]
 * @property {string} [rightTexture]
 * @property {boolean} [useIsoTransform=false]
 */

/**
 * 2.5D 斜角方块精灵。
 * @extends PIXI.Container
 */
export class BlockSprite extends PIXI.Container {
    /** @private @type {import('pixi.js').Sprite} */ _topSprite;
    /** @private @type {import('pixi.js').Sprite} */ _leftSprite;
    /** @private @type {import('pixi.js').Sprite} */ _rightSprite;
    /** @private @type {import('pixi.js').Sprite|null} */ _assembledSprite = null;
    /** @private @type {boolean} */ _useIsoTransform = false;
    /** @private @type {string} */ _blockType = '';
    /** @private @type {number} */ _gx = 0;
    /** @private @type {number} */ _gy = 0;
    /** @private @type {number} */ _gz = 0;
    /** @private @type {number} */ _blockId = 0;
    /** @private @type {boolean} */ _selected = false;

    /**
     * @param {BlockSpriteOptions} [options={}]
     */
    constructor(options = {}) {
        super();
        this.name = 'BlockSprite';
        this._blockId = ++_blockIdCounter;
        this._useIsoTransform = options.useIsoTransform === true;

        // 创建三面 Sprite
        this._topSprite = new PIXI.Sprite();   this._topSprite.name = 'TopFace';
        this._leftSprite = new PIXI.Sprite();  this._leftSprite.name = 'LeftFace';
        this._rightSprite = new PIXI.Sprite(); this._rightSprite.name = 'RightFace';

        layoutDefault(this._topSprite, this._leftSprite, this._rightSprite);
        this.addChild(this._topSprite);
        this.addChild(this._leftSprite);
        this.addChild(this._rightSprite);

        // 设置方块类型
        const type = options.blockType || 'grass';
        if (this._useIsoTransform && !options.topTexture) {
            this._blockType = type;
            applyTexture(this._topSprite, this._leftSprite, this._rightSprite,
                MISSING_TEXTURE, MISSING_TEXTURE, MISSING_TEXTURE);
        } else {
            this.setBlockType(type, {
                top: options.topTexture, left: options.leftTexture, right: options.rightTexture
            });
        }
    }

    // ──────── 网���坐标(带├───────

    /**
     * 设置网格坐标并更新屏幕位置。
     * screenX = (gx - gy) * TILE_HALF_W
     * screenY = (gx + gy) * TILE_HALF_H - gz * TILE_H
     * zIndex  = (gx + gy) * Z_BASE + gz
     * @param {number} gx - 网格 X
     * @param {number} gy - 网格 Y
     * @param {number} [gz=0] - 高度层
     * @returns {this}
     */
    setGridPosition(gx, gy, gz = 0) {
        this._gx = gx; this._gy = gy; this._gz = gz;
        this.x = (gx - gy) * TILE_HALF_W;
        this.y = (gx + gy) * TILE_HALF_H - gz * TILE_H;
        this.zIndex = (gx + gy) * Z_BASE + gz;
        return this;
    }

    /** @returns {number} */ get gridX() { return this._gx; }
    /** @returns {number} */ get gridY() { return this._gy; }
    /** @returns {number} */ get gridZ() { return this._gz; }
    /** @returns {string} */ get blockType() { return this._blockType; }
    /** @returns {number} */ get blockId() { return this._blockId; }
    /** @returns {boolean} */ get selected() { return this._selected; }
    /** @param {boolean} v */ set selected(v) { this._selected = !!v; }

    // ──────── 纹理切换 ────────

    /**
     * 设置方块类型，切换对应贴图。
     * @param {string} type - 类型标识（如 'grass', 'stone'）
     * @param {{ top?: string, left?: string, right?: string }} [customTextures={}]
     * @returns {this}
     */
    setBlockType(type, customTextures = {}) {
        const paths = resolveTexturePaths(type, customTextures);
        if (!paths.found) {
            log.warn(`未知方块类型 "${type}"，使用缺失占位纹理`);
            this._blockType = 'missing';
            applyTexture(this._topSprite, this._leftSprite, this._rightSprite,
                MISSING_TEXTURE, MISSING_TEXTURE, MISSING_TEXTURE);
            return this;
        }
        this._blockType = type;
        applyTexture(this._topSprite, this._leftSprite, this._rightSprite,
            paths.top, paths.left, paths.right);
        return this;
    }

    /**
     * 设置等轴变换后的三面纹理。
     * @param {ImageData} topData - 顶面 (24×12)
     * @param {ImageData} leftData - 左面 (12×21)
     * @param {ImageData} rightData - 右面 (12×21)
     * @returns {this}
     */
    setIsoFaces(topData, leftData, rightData) {
        setIsoFaces(this._topSprite, this._leftSprite, this._rightSprite,
            topData, leftData, rightData);
        return this;
    }

    /**
     * 设置等轴装配后的整块纹理（单精灵模式）。
     * @param {ImageData} assembledData - assembleBlock() 生成的纹理
     * @returns {this}
     */
    setAssembledTexture(assembledData) {
        this._assembledSprite = getOrCreateAssembledSprite(this, this._assembledSprite);
        setAssembledTexture(this, this._assembledSprite,
            this._topSprite, this._leftSprite, this._rightSprite, assembledData);
        return this;
    }

    /** @returns {this} 切换回三面独立显示 */
    showSeparateFaces() {
        showSeparateFaces(this._assembledSprite, this._topSprite, this._leftSprite, this._rightSprite);
        return this;
    }

    // ──────── 生命周期 ────────

    /**
     * 销毁此 BlockSprite。
     * @param {object|boolean} [options]
     */
    destroy(options) {
        this._assembledSprite = null;
        this._topSprite = /** @type {import('pixi.js').Sprite} */ (/** @type {unknown} */ null);
        this._leftSprite = /** @type {import('pixi.js').Sprite} */ (/** @type {unknown} */ null);
        this._rightSprite = /** @type {import('pixi.js').Sprite} */ (/** @type {unknown} */ null);
        super.destroy(options);
    }

    // ──────── 异步工厂方法 ────────

    /**
     * 异步创建 BlockSprite 实例。
     * @param {BlockSpriteOptions} [options={}]
     * @returns {Promise<BlockSprite>}
     */
    static async create(options = {}) {
        if (options.useIsoTransform) return BlockSprite.createWithIsoTransform(options);
        const block = new BlockSprite(options);
        const type = block._blockType || options.blockType || 'grass';
        const paths = resolveTexturePaths(type, options);
        const { loadTexturesAsync } = await import('./BlockTextureAssembler.mjs');
        await loadTexturesAsync(block._topSprite, block._leftSprite, block._rightSprite,
            paths.top, paths.left, paths.right);
        return block;
    }

    /**
     * 异步创建等轴变换后的 BlockSprite 实例。
     * @param {BlockSpriteOptions & { useAssembled?: boolean }} [options={}]
     * @returns {Promise<BlockSprite>}
     */
    static async createWithIsoTransform(options = {}) {
        const { useAssembled = false, ...rest } = options;
        const block = new BlockSprite({ ...rest, useIsoTransform: true });
        const type = block._blockType || rest.blockType || 'grass';
        const paths = resolveTexturePaths(type, rest);
        const { imageDataFromUrl } = await import('../../utils/ImageDataUtils.mjs');
        const { transformTopFace, shearToParallelogram, assembleBlock }
            = await import('../../loader/IsoTextureTransformer.mjs');
        try {
            const [topRaw, leftRaw, rightRaw] = await Promise.all([
                imageDataFromUrl(paths.top), imageDataFromUrl(paths.left), imageDataFromUrl(paths.right)
            ]);
            const topT = transformTopFace(topRaw, { interpolation: 'nearest' });
            const leftT = shearToParallelogram(leftRaw, 'left');
            const rightT = shearToParallelogram(rightRaw, 'right');
            if (useAssembled) block.setAssembledTexture(assembleBlock(topT, leftT, rightT));
            else block.setIsoFaces(topT, leftT, rightT);
            log.info(`等轴变换完成: ${type}`);
        } catch (/** @type {unknown} */ err) {
            log.warn(`等轴变换失败，降级: ${/** @type {Error} */ (err).message}`);
            const { loadTexturesAsync } = await import('./BlockTextureAssembler.mjs');
            await loadTexturesAsync(block._topSprite, block._leftSprite, block._rightSprite,
                paths.top, paths.left, paths.right);
        }
        return block;
    }
}
