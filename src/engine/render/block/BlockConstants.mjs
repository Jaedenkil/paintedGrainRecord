// @ts-check

/**
 * @fileoverview
 * 2.5D 等轴方块渲染常量 — 集中管理所有尺寸与数学常量。
 *
 * 源纹理（16×16）经由 IsoTextureTransformer 变换后产生三面尺寸：
 * - 顶面：24×12（旋转 45° + 垂直压缩）
 * - 左/右面：12×21（剪切为平行四边形）
 *
 * 等轴投影步进值基于变换后的菱形尺寸：
 * - TILE_HALF_W = ROTATED_SIZE / 2 = 12（菱形半宽）
 * - TILE_HALF_H = TOP_HEIGHT / 2 = 6（菱形半高）
 *
 * @module render/block/BlockConstants
 */

import {
    ROTATED_SIZE,
    TOP_HEIGHT,
    SIDE_WIDTH,
    SIDE_HEIGHT,
    SHEAR_OFFSET
} from '../../loader/IsoTextureTransformer.mjs';

// ──────── 源纹理尺寸 ────────

/** 源纹理像素宽度（美术资产标准尺寸 16px）。@type {number} */
export const SRC_TILE_W = 16;

/** 源纹理像素高度（美术资产标准尺寸 16px）。@type {number} */
export const SRC_TILE_H = 16;

// ──────── 显示纹理尺寸 ────────

/** 每个面贴图的显示像素宽度。@type {number} */
export const TILE_W = 16;

/** 每个面贴图的显示像素高度。@type {number} */
export const TILE_H = 16;

// ──────── 缩放系数 ────────

/** 子 Sprite X 轴缩放系数（1:1 等比显示）。@type {number} */
export const TEXTURE_SCALE_X = TILE_W / SRC_TILE_W;

/** 子 Sprite Y 轴缩放系数（1:1 等比显示）。@type {number} */
export const TEXTURE_SCALE_Y = TILE_H / SRC_TILE_H;

// ──────── 等轴投影步进（基于变换后尺寸） ────────

/**
 * 等轴投影水平步进（菱形半宽）。
 * 相邻网格点的水平间距 = 变换后菱形宽度的一半 = 12px。
 * @type {number}
 */
export const TILE_HALF_W = ROTATED_SIZE / 2; // 12

/**
 * 等轴投影垂直步进（菱形半高）。
 * 相邻网格点的垂直间距 = 变换后菱形高度的一半 = 6px。
 * @type {number}
 */
export const TILE_HALF_H = TOP_HEIGHT / 2;   // 6

// ──────── 等轴变换后三面尺寸（转发自 IsoTextureTransformer） ────────

/** 变换后顶面菱形宽度（24px）。@type {number} */
export { ROTATED_SIZE };

/** 变换后顶面菱形高度（12px）。@type {number} */
export { TOP_HEIGHT };

/** 变换后侧面宽度（12px）。@type {number} */
export { SIDE_WIDTH };

/** 变换后侧面高度（21px）。@type {number} */
export { SIDE_HEIGHT };

/** 剪切偏移量（≈5.657），用于等轴装配定位。@type {number} */
export { SHEAR_OFFSET };

// ──────── 排序与偏移 ────────

/**
 * Y-Sort 基数常量。
 * 必须大于任意 (gx + gy) 的最大可能值，
 * 确保 gz 只作为次级排序键。
 * @type {number}
 */
export const Z_BASE = 100;

/**
 * 顶面偏移量（视觉高度 = TILE_H = 16）。
 * 表示从方块底座中心到顶面菱形中心的垂直距离。
 * @type {number}
 */
export const BLOCK_TOP_OFFSET = TILE_H;
