// @ts-check

/**
 * @fileoverview
 * 等轴网格几何计算 —— 纯函数集合，无 PIXI 依赖。
 *
 * 提供 IsoGridOverlay 所需的全部几何计算：
 * - 单个菱形顶点（_getDiamondVertices）
 * - 方块完整六边形轮廓顶点（_getBlockOutlineVertices）
 * - 完整网格预计算（_computeGrid）
 * - 颜色线性插值（_lerpColor）
 *
 * 这些函数均为纯数学计算，可独立单元测试。
 *
 * @module render/IsoGridGeometry
 */

import { TILE_HALF_W, TILE_HALF_H } from './BlockSprite.mjs';
import { ROTATED_SIZE, TOP_HEIGHT, SRC_SIZE, SIDE_HEIGHT } from '../loader/IsoTextureTransformer.mjs';

/**
 * 计算单个菱形格子的四个顶点坐标（等轴投影屏幕坐标）。
 *
 * 投影公式：
 * ```
 * screenX = (gx - gy) * TILE_HALF_W
 * screenY = (gx + gy) * TILE_HALF_H
 * ```
 *
 * @param {number} gx - 格子 X 坐标
 * @param {number} gy - 格子 Y 坐标
 * @returns {{ topX: number, topY: number, rightX: number, rightY: number,
 *            bottomX: number, bottomY: number, leftX: number, leftY: number }}
 */
export function getDiamondVertices(gx, gy) {
    const cx = (gx - gy) * TILE_HALF_W;
    const cy = (gx + gy) * TILE_HALF_H;
    const HW = ROTATED_SIZE / 2;
    const HH = TOP_HEIGHT / 2;
    return {
        topX: cx,         topY: cy - HH,
        rightX: cx + HW,  rightY: cy,
        bottomX: cx,      bottomY: cy + HH,
        leftX: cx - HW,   leftY: cy
    };
}

/**
 * 获取方块完整六边形轮廓的六个顶点坐标。
 *
 * 六边形顶点顺序（顺时针）：
 * T (top) → R (right) → RB (right-bottom) → B (center-bottom) → LB (left-bottom) → L (left)
 *
 * 底部形成 V 形（详见剪切校正文档）：
 *   LB(-12, 16) ──→ bot(0, 21) ←── RB(12, 16)
 *
 * @param {number} gx - 网格 X 坐标
 * @param {number} gy - 网格 Y 坐标
 * @returns {{ topX: number, topY: number, rightX: number, rightY: number,
 *            rbX: number, rbY: number, botX: number, botY: number,
 *            lbX: number, lbY: number, leftX: number, leftY: number }}
 */
export function getBlockOutlineVertices(gx, gy) {
    const cx = (gx - gy) * TILE_HALF_W;
    const cy = (gx + gy) * TILE_HALF_H;
    const HW = ROTATED_SIZE / 2;
    const HH = TOP_HEIGHT / 2;
    return {
        topX: cx,         topY: cy - HH,
        rightX: cx + HW,  rightY: cy,
        leftX: cx - HW,   leftY: cy,
        rbX: cx + HW,     rbY: cy + SRC_SIZE,
        botX: cx,         botY: cy + SIDE_HEIGHT,
        lbX: cx - HW,     lbY: cy + SRC_SIZE
    };
}

/**
 * 预计算所有菱形顶点的坐标集合（去重）。
 *
 * 相邻菱形共享边和顶点，通过 Set 去重确保每个顶点只绘制一次，
 * 避免 pixel doubling 造成的亮度不均。
 *
 * @param {number} gridW - 网格宽度
 * @param {number} gridH - 网格高度
 * @returns {{ diamonds: Array<{cx: number, cy: number, topX: number, topY: number,
 *            rightX: number, rightY: number, bottomX: number, bottomY: number,
 *            leftX: number, leftY: number}>, vertices: Set<string> }}
 */
export function computeGrid(gridW, gridH) {
    const DIA_HALF_W = ROTATED_SIZE / 2;
    const DIA_HALF_H = TOP_HEIGHT / 2;
    const diamonds = [];
    const vertices = new Set();

    for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
            const cx = (gx - gy) * TILE_HALF_W;
            const cy = (gx + gy) * TILE_HALF_H;
            const topX = cx;
            const topY = cy - DIA_HALF_H;
            const rightX = cx + DIA_HALF_W;
            const rightY = cy;
            const bottomX = cx;
            const bottomY = cy + DIA_HALF_H;
            const leftX = cx - DIA_HALF_W;
            const leftY = cy;

            diamonds.push({ cx, cy, topX, topY, rightX, rightY, bottomX, bottomY, leftX, leftY });
            vertices.add(`${topX},${topY}`);
            vertices.add(`${rightX},${rightY}`);
            vertices.add(`${bottomX},${bottomY}`);
            vertices.add(`${leftX},${leftY}`);
        }
    }
    return { diamonds, vertices };
}

/**
 * 线性插值两个十六进制颜色。
 *
 * @param {number} colorA - 起始颜色（十六进制，如 0x8b6f3c）
 * @param {number} colorB - 终止颜色（十六进制，如 0xffd966）
 * @param {number} t - 插值因子 [0, 1]
 * @returns {number} 插值后的十六进制颜色
 *
 * @example
 * ```javascript
 * const mid = lerpColor(0x8b6f3c, 0xffd966, 0.5);
 * // → 0xc5a351
 * ```
 */
export function lerpColor(colorA, colorB, t) {
    const rA = (colorA >> 16) & 0xff;
    const gA = (colorA >> 8) & 0xff;
    const bA = colorA & 0xff;
    const rB = (colorB >> 16) & 0xff;
    const gB = (colorB >> 8) & 0xff;
    const bB = colorB & 0xff;
    const r = Math.round(rA + (rB - rA) * t);
    const g = Math.round(gA + (gB - gA) * t);
    const b = Math.round(bA + (bB - bA) * t);
    return (r << 16) | (g << 8) | b;
}
