// @ts-check

/**
 * @fileoverview
 * 三面精灵布局变换器 — 管理 BlockSprite 内部三个面 Sprite 的
 * 锚点(anchor)、位置(position)、缩放(scale)设定。
 *
 * 支持两种布局模式：
 * 1. `layoutDefault` — 原始 1:1 占位布局（构造时默认）
 * 2. `layoutIsoFaces` — 等轴装配布局（变换后的菱形顶面 + 平行四边形侧面）
 * 3. `layoutAssembled` — 单精灵组装模式
 *
 * @module render/block/BlockFaceLayout
 */

import {
    SIDE_WIDTH,
    SIDE_HEIGHT,
    ROTATED_SIZE,
    TOP_HEIGHT,
    SHEAR_OFFSET,
    TEXTURE_SCALE_X,
    TEXTURE_SCALE_Y
} from './BlockConstants.mjs';

/**
 * 将三面 Sprite 设置为原始 1:1 占位布局（构造时默认）。
 *
 * 所有三个面以 1:1 原尺寸显示（16×16），
 * 锚点与位置按顶面对齐模式设定：
 * - 顶面：锚点置底居中，位置在容器原点
 * - 左面：锚点置顶右，位置在容器原点（向下方延伸）
 * - 右面：锚点置顶左，位置在容器原点（向下方延伸）
 *
 * @param {import('pixi.js').Sprite} topSprite - 顶面 Sprite
 * @param {import('pixi.js').Sprite} leftSprite - 左面 Sprite
 * @param {import('pixi.js').Sprite} rightSprite - 右面 Sprite
 */
export function layoutDefault(topSprite, leftSprite, rightSprite) {
    // 顶面：锚点置底居中，位置在容器原点 (0,0)
    topSprite.anchor.set(0.5, 1.0);
    topSprite.position.set(0, 0);
    topSprite.scale.set(TEXTURE_SCALE_X, TEXTURE_SCALE_Y);

    // 左面：锚点置顶右，位置在容器原点（向下方延伸）
    leftSprite.anchor.set(1.0, 0);
    leftSprite.position.set(0, 0);
    leftSprite.scale.set(TEXTURE_SCALE_X, TEXTURE_SCALE_Y);

    // 右面：锚点置顶左，位置在容器原点（向下方延伸）
    rightSprite.anchor.set(0, 0);
    rightSprite.position.set(0, 0);
    rightSprite.scale.set(TEXTURE_SCALE_X, TEXTURE_SCALE_Y);
}

/**
 * 将三面 Sprite 设置为等轴装配布局。
 *
 * 变换后的纹理尺寸：
 * - 顶面: 24×12（旋转压缩后的菱形）
 * - 左面: 12×21（剪切后的平行四边形）
 * - 右面: 12×21（剪切后的平行四边形）
 *
 * 容器原点 (0,0) = 顶面菱形中心（与网格点对齐）。
 * 侧面从原点向下延伸。
 *
 * 装配位置：
 * ```
 *      ╱ top ╲              ← top (24×12), anchor(0.5, 0.5), pos(0, 0)
 *     ╱________╲
 *    ╱  left   ╲  ╲        ← left anchor(1.0, 0), right anchor(0, 0)
 *   ╱          ╱ right ╲     起始于 y = TOP_H/2 - sideShiftY
 *  ╱__________╱________╲
 * ```
 *
 * 注意：sideShiftY 必须与 IsoTextureTransformer.assembleBlock 中的
 * sideShiftY 保持完全一致（同为 Math.ceil(SHEAR_OFFSET)），
 * 否则三面模式与装配模式之间会出现 1px 垂直错位。
 *
 * @param {import('pixi.js').Sprite} topSprite - 顶面 Sprite
 * @param {import('pixi.js').Sprite} leftSprite - 左面 Sprite
 * @param {import('pixi.js').Sprite} rightSprite - 右面 Sprite
 */
export function layoutIsoFaces(topSprite, leftSprite, rightSprite) {
    const SIDE_W = SIDE_WIDTH;  // 12
    const SIDE_H = SIDE_HEIGHT; // 21
    const TOP_W = ROTATED_SIZE; // 24
    const TOP_H = TOP_HEIGHT;   // 12

    // 垂直偏移量：平行四边形的最早可见像素行 = ceil(SHEAR_OFFSET) ≈ 6
    // 使用 ceil 确保侧面顶端与顶面菱形底边在像素级对齐，
    // 与 assembleBlock 保持一致，消除三面/装配模式间的错位。
    const sideShiftY = Math.ceil(SHEAR_OFFSET); // ceil(5.657) = 6

    // ── 顶面微扩覆盖（消除接缝间隙）──
    // 即使纹理边缘填充后，渲染时因纹理采样/抗锯齿仍可能产生间隙。
    // 将顶面 Sprite 整体放大 1.0px 每边（累加两轮 0.5px 一圈的指令），
    // 使其略微覆盖侧面边缘，利用像素重叠彻底消除视觉间隙。
    const TOP_SCALE_X = (TOP_W + 2) / TOP_W; // 26/24 ≈ 1.0833
    const TOP_SCALE_Y = (TOP_H + 2) / TOP_H; // 14/12 ≈ 1.1667

    // 顶面：菱形中心对齐容器原点 (0,0)
    topSprite.anchor.set(0.5, 0.5);
    topSprite.position.set(0, 0);
    topSprite.scale.set(TOP_SCALE_X, TOP_SCALE_Y);

    // 左面：锚点置顶右，右边缘对齐容器中心
    // 垂直偏移 = TOP_H/2 - sideShiftY，使剪切后的可见对角线边缘
    // 与顶面菱形左斜面精确对齐，消除间隙。
    leftSprite.anchor.set(1.0, 0);
    leftSprite.position.set(0, TOP_H / 2 - sideShiftY);
    leftSprite.scale.set(1, 1);

    // 右面：锚点置顶左，左边缘对齐容器中心
    // 同上垂直偏移
    rightSprite.anchor.set(0, 0);
    rightSprite.position.set(0, TOP_H / 2 - sideShiftY);
    rightSprite.scale.set(1, 1);

    // 确保三个面可见
    topSprite.visible = true;
    leftSprite.visible = true;
    rightSprite.visible = true;
}

/**
 * 设置组装模式的 Sprite 布局（单精灵模式）。
 *
 * 将组装后的整块纹理 Sprite 置顶对齐：
 * - 锚点 (0.5, 0)：顶部居中，容器原点 = 顶面菱形中心
 * - 缩放 1:1
 *
 * @param {import('pixi.js').Sprite} assembledSprite - 组装后的整块 Sprite
 * @param {import('pixi.js').Sprite} topSprite - 顶面 Sprite（将被隐藏）
 * @param {import('pixi.js').Sprite} leftSprite - 左面 Sprite（将被隐藏）
 * @param {import('pixi.js').Sprite} rightSprite - 右面 Sprite（将被隐藏）
 */
export function layoutAssembled(assembledSprite, topSprite, leftSprite, rightSprite) {
    assembledSprite.anchor.set(0.5, 0);
    assembledSprite.position.set(0, 0);
    assembledSprite.scale.set(1, 1);

    // 隐藏三面独立 Sprite（它们作为备选保留）
    topSprite.visible = false;
    leftSprite.visible = false;
    rightSprite.visible = false;
}

/**
 * 将三个面切换回独立模式（隐藏装配精灵，显示三面）。
 *
 * @param {import('pixi.js').Sprite|null} assembledSprite - 组装精灵（可能为 null）
 * @param {import('pixi.js').Sprite} topSprite - 顶面 Sprite
 * @param {import('pixi.js').Sprite} leftSprite - 左面 Sprite
 * @param {import('pixi.js').Sprite} rightSprite - 右面 Sprite
 */
export function showSeparateFaces(assembledSprite, topSprite, leftSprite, rightSprite) {
    if (assembledSprite) {
        assembledSprite.visible = false;
    }
    topSprite.visible = true;
    leftSprite.visible = true;
    rightSprite.visible = true;
}
