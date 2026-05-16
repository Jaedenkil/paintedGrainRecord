// @ts-check

/**
 * @fileoverview
 * 方块纹理装配器 — 管理 BlockSprite 的纹理加载与应用逻辑。
 *
 * 核心职能：
 * 1. `applyTexture` — 同步纹理应用（PIXI.Texture.from）
 * 2. `loadTexturesAsync` — 异步纹理加载（HTMLImageElement + 5秒超时 + 优雅降级）
 * 3. `setIsoFaces` — 等轴变换纹理装配（ImageData 管道）
 * 4. `setAssembledTexture` — 组装模式单精灵纹理
 * 5. `getOrCreateAssembledSprite` — 组装精灵的懒创建
 *
 * @module render/block/BlockTextureAssembler
 */

import { BLOCK_TEXTURE_MAP, MISSING_TEXTURE } from './BlockTextureMap.mjs';
import { imageDataToPixiTexture } from '../../utils/ImageDataUtils.mjs';
import { layoutIsoFaces, layoutAssembled } from './BlockFaceLayout.mjs';
import { Logger } from '../../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('BlockTextureAssembler');

/**
 * 将贴图路径同步应用到三面 Sprite。
 *
 * 通过 PIXI.Texture.from() 加载贴图。
 * 警告：在 Electron file:// 环境下可能返回 1×1 空白纹理。
 * 推荐使用异步版本 loadTexturesAsync()。
 *
 * @param {import('pixi.js').Sprite} topSprite - 顶面 Sprite
 * @param {import('pixi.js').Sprite} leftSprite - 左面 Sprite
 * @param {import('pixi.js').Sprite} rightSprite - 右面 Sprite
 * @param {string} topPath - 顶面贴图路径
 * @param {string} leftPath - 左面贴图路径
 * @param {string} rightPath - 右面贴图路径
 */
export function applyTexture(topSprite, leftSprite, rightSprite, topPath, leftPath, rightPath) {
    topSprite.texture  = PIXI.Texture.from(topPath);
    leftSprite.texture = PIXI.Texture.from(leftPath);
    rightSprite.texture = PIXI.Texture.from(rightPath);
}

/**
 * 异步加载三面贴图（推荐方式）。
 *
 * 使用原生 HTMLImageElement 加载图片，再用加载完成的图片创建 PIXI.Texture。
 * 此方法：
 * 1. 不依赖 PIXI.Texture.fromURL()（兼容所有 v8.x CDN 版本）
 * 2. 正确支持 Electron file:// 协议
 * 3. 使用 5 秒超时，超时后自动降级到同步加载
 *
 * 加载失败时自动回退到 MISSING_TEXTURE 占位纹理，不会抛异常。
 *
 * @param {import('pixi.js').Sprite} topSprite - 顶面 Sprite
 * @param {import('pixi.js').Sprite} leftSprite - 左面 Sprite
 * @param {import('pixi.js').Sprite} rightSprite - 右面 Sprite
 * @param {string} topPath - 顶面贴图路径
 * @param {string} leftPath - 左面贴图路径
 * @param {string} rightPath - 右面贴图路径
 * @returns {Promise<void>}
 */
export async function loadTexturesAsync(topSprite, leftSprite, rightSprite, topPath, leftPath, rightPath) {
    /** 图片加载超时时间（毫秒） */
    const TIMEOUT_MS = 5000;

    /**
     * 通过 HTML Image 元素异步加载单张图片。
     * @param {string} src - 图片路径
     * @returns {Promise<HTMLImageElement>}
     */
    const loadImage = (src) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            let settled = false;

            const done = (/** @type {Error|null|undefined} */ err) => {
                if (settled) return;
                settled = true;
                if (err) reject(err);
                else resolve(img);
            };

            img.onload  = () => done(null);
            img.onerror = () => done(new Error(`图片加载失败: ${src}`));
            img.onabort = () => done(new Error(`图片加载被中断: ${src}`));

            // 5 秒超时
            setTimeout(() => {
                done(new Error(`图片加载超时 (${TIMEOUT_MS}ms): ${src}`));
            }, TIMEOUT_MS);

            img.src = src;
        });
    };

    try {
        // 并行加载三张图片
        const [topImg, leftImg, rightImg] = await Promise.all([
            loadImage(topPath),
            loadImage(leftPath),
            loadImage(rightPath)
        ]);

        // 使用已加载完成的 HTMLImageElement 创建纹理
        topSprite.texture  = PIXI.Texture.from(topImg);
        leftSprite.texture = PIXI.Texture.from(leftImg);
        rightSprite.texture = PIXI.Texture.from(rightImg);

        log.info(`三面纹理异步加载成功 (${topPath})`);
        return;
    } catch (/** @type {unknown} */ err) {
        log.warn(`异步图片加载失败，降级为同步纹理加载: ${/** @type {Error} */ (err).message}`);
    }

    // 降级：同步加载（在 file:// 下可能返回 1×1 占位纹理）
    applyTexture(topSprite, leftSprite, rightSprite, topPath, leftPath, rightPath);
}

/**
 * 设置等轴变换后的三面纹理（直接传入已变换的 ImageData）。
 *
 * 此方法用变换后的纹理替换三面 Sprite 的当前纹理，
 * 并自动调整 Sprite 的布局为等轴装配位。
 *
 * @param {import('pixi.js').Sprite} topSprite - 顶面 Sprite
 * @param {import('pixi.js').Sprite} leftSprite - 左面 Sprite
 * @param {import('pixi.js').Sprite} rightSprite - 右面 Sprite
 * @param {ImageData} topData - 变换后的顶面纹理 (24×12)
 * @param {ImageData} leftData - 变换后的左面纹理 (12×21)
 * @param {ImageData} rightData - 变换后的右面纹理 (12×21)
 */
export function setIsoFaces(topSprite, leftSprite, rightSprite, topData, leftData, rightData) {
    topSprite.texture   = imageDataToPixiTexture(topData);
    leftSprite.texture  = imageDataToPixiTexture(leftData);
    rightSprite.texture = imageDataToPixiTexture(rightData);

    layoutIsoFaces(topSprite, leftSprite, rightSprite);
}

/**
 * 设置等轴装配后的整块纹理（单精灵模式）。
 *
 * 使用 `assembleBlock()` 预装配的完整等轴方块纹理作为单个 Sprite 显示。
 * 此模式下三面独立 Sprite 会被隐藏，仅显示装配后的整块。
 *
 * @param {import('pixi.js').Container} container - 父容器
 * @param {import('pixi.js').Sprite} assembledSprite - 组装后的整块 Sprite
 * @param {import('pixi.js').Sprite} topSprite - 顶面 Sprite（将被隐藏）
 * @param {import('pixi.js').Sprite} leftSprite - 左面 Sprite（将被隐藏）
 * @param {import('pixi.js').Sprite} rightSprite - 右面 Sprite（将被隐藏）
 * @param {ImageData} assembledData - 通过 assembleBlock() 生成的完整方块纹理
 */
export function setAssembledTexture(container, assembledSprite, topSprite, leftSprite, rightSprite, assembledData) {
    assembledSprite.texture = imageDataToPixiTexture(assembledData);

    layoutAssembled(assembledSprite, topSprite, leftSprite, rightSprite);
}

/**
 * 创建或获取组装精灵引用。
 *
 * 如果已有组装精灵则直接返回，否则在容器中创建新的组装精灵。
 *
 * @param {import('pixi.js').Container} container - 父容器
 * @param {import('pixi.js').Sprite|null} existingAssembled - 已有的组装精灵（可能为 null）
 * @returns {import('pixi.js').Sprite} 组装后的整块 Sprite
 */
export function getOrCreateAssembledSprite(container, existingAssembled) {
    if (existingAssembled) {
        return existingAssembled;
    }

    const sprite = new PIXI.Sprite();
    sprite.name = 'AssembledBlock';
    container.addChildAt(sprite, 0);
    return sprite;
}

/**
 * 从方块类型解析三面贴图路径。
 *
 * 优先使用自定义贴图，否则从 BLOCK_TEXTURE_MAP 注册表获取，
 * 最后回退到 MISSING_TEXTURE 占位路径。
 *
 * @param {string} type - 方块类型标识
 * @param {{ top?: string, left?: string, right?: string }} [customTextures={}] - 自定义贴图路径
 * @returns {{ top: string, left: string, right: string, found: boolean }}
 *   返回解析后的三面路径和是否找到注册条目
 */
export function resolveTexturePaths(type, customTextures = {}) {
    const entry = BLOCK_TEXTURE_MAP[type];
    const found = !!entry || !!(customTextures.top || customTextures.left || customTextures.right);

    return {
        top:   customTextures.top   || (entry ? entry.top   : MISSING_TEXTURE),
        left:  customTextures.left  || (entry ? entry.left  : MISSING_TEXTURE),
        right: customTextures.right || (entry ? entry.right : MISSING_TEXTURE),
        found
    };
}
