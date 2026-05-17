// @ts-check

/**
 * @fileoverview
 * 等轴方块纹理变换运算符 —— 纯像素变换函数集合，无状态、无缓存。
 * 包含：旋转、压缩、剪切、边缘扩展、装配、边缘修复。
 * @module loader/IsoTexOperators
 */

import {
    createEmptyImageData, getPixel, setPixel, sampleNearest,
    sampleBilinear, computeBoundingBox
} from '../utils/ImageDataUtils.mjs';
import { SRC_SIZE, ROTATED_SIZE, TOP_HEIGHT, SIDE_WIDTH, SIDE_HEIGHT, SHEAR_OFFSET, COS45, SIN45 }
    from './IsoTexConstants.mjs';

// ──────── 顶面旋转 ────────

/**
 * 将 16×16 正方形纹理绕中心旋转 45°，背景透明。
 * 算法：反向映射（反向查表法），支持最近邻或双线性插值。
 * @param {ImageData} srcData - 16×16 源纹理
 * @param {Object} [options]
 * @param {'nearest'|'bilinear'} [options.interpolation='nearest']
 * @returns {ImageData} 24×24 旋转后纹理
 */
export function rotateTexture45(srcData, options = {}) {
    const { interpolation = 'nearest' } = options;
    const sampler = interpolation === 'bilinear' ? sampleBilinear : sampleNearest;
    const srcW = srcData.width, srcH = srcData.height;
    const dstW = ROTATED_SIZE, dstH = ROTATED_SIZE;
    const cxOut = (dstW - 1) / 2, cyOut = (dstH - 1) / 2;
    const cxIn = (srcW - 1) / 2, cyIn = (srcH - 1) / 2;
    const outData = createEmptyImageData(dstW, dstH);
    for (let oy = 0; oy < dstH; oy++) {
        for (let ox = 0; ox < dstW; ox++) {
            const nx = ox - cxOut, ny = oy - cyOut;
            const sx = nx * COS45 + ny * SIN45;
            const sy = -nx * SIN45 + ny * COS45;
            const ix = sx + cxIn, iy = sy + cyIn;
            if (ix >= 0 && ix < srcW && iy >= 0 && iy < srcH) {
                setPixel(outData, ox, oy, sampler(srcData, ix, iy));
            }
        }
    }
    return outData;
}

// ──────── 顶面垂直压缩 ────────

/**
 * 将旋转后的菱形纹理沿垂直对角线压缩 50%。
 * 输出宽度不变（24），高度压缩为 12。
 * @param {ImageData} srcData - 24×24 旋转后纹理
 * @returns {ImageData} 24×12 等轴顶面纹理
 */
export function compressVerticalDiagonal(srcData) {
    const srcW = srcData.width, srcH = srcData.height;
    const dstW = srcW, dstH = TOP_HEIGHT;
    const scaleY = srcH / dstH;
    const outData = createEmptyImageData(dstW, dstH);
    for (let oy = 0; oy < dstH; oy++) {
        for (let ox = 0; ox < dstW; ox++) {
            const iy = Math.max(0, Math.min(srcH - 1, (oy + 0.5) * scaleY - 0.5));
            setPixel(outData, ox, oy, sampleNearest(srcData, ox, iy));
        }
    }
    return outData;
}

// ──────── 顶面边缘扩展 ────────

/**
 * 将顶面纹理的边缘列扩展，使菱形内容填满 24px 宽度。
 * 将第 2 列复制到第 0-1 列，将第 w-3 列复制到第 w-2 和 w-1 列。
 * @param {ImageData} topData - compressVerticalDiagonal 输出（24×12）
 * @returns {ImageData} 边缘扩展后的顶面纹理
 */
export function expandTopFaceEdges(topData) {
    const w = topData.width, h = topData.height;
    if (w < 5) return topData;
    for (let y = 0; y < h; y++) {
        const lp = getPixel(topData, 2, y);
        setPixel(topData, 0, y, lp);
        setPixel(topData, 1, y, lp);
        const rp = getPixel(topData, w - 3, y);
        setPixel(topData, w - 2, y, rp);
        setPixel(topData, w - 1, y, rp);
    }
    return topData;
}

// ──────── 侧面剪切 ────────

/**
 * 将 16×16 正方形纹理剪切为等轴侧面平行四边形。
 * @param {ImageData} srcData - 16×16 侧面源纹理
 * @param {'left'|'right'} direction - 侧面方向
 * @returns {ImageData} 等轴侧面平行四边形 (12×21)
 */
export function shearToParallelogram(srcData, direction) {
    const srcW = srcData.width, srcH = srcData.height;
    const dstW = SIDE_WIDTH, dstH = SIDE_HEIGHT;
    const scaleX = srcW / dstW;
    const outData = createEmptyImageData(dstW, dstH);
    for (let oy = 0; oy < dstH; oy++) {
        for (let ox = 0; ox < dstW; ox++) {
            const ix = ((ox + 0.5) / dstW) * srcW;
            const t = direction === 'left' ? (ox / (dstW - 1)) : (1 - ox / (dstW - 1));
            const iy = oy - SHEAR_OFFSET * t;
            if (ix < 0 || ix >= srcW || iy < 0 || iy >= srcH) continue;
            setPixel(outData, ox, oy, sampleNearest(srcData, ix, iy));
        }
    }
    return outData;
}

// ──────── 装配 ────────

/**
 * 将顶/左/右三面装配为完整等轴方块纹理。
 * @param {ImageData} topData - 变换后的顶面纹理
 * @param {ImageData} leftData - 左面纹理
 * @param {ImageData} rightData - 右面纹理
 * @returns {ImageData} 完整等轴方块像素数据
 */
export function assembleBlock(topData, leftData, rightData) {
    const topBB = computeBoundingBox(topData);
    const leftBB = computeBoundingBox(leftData);
    const rightBB = computeBoundingBox(rightData);
    const canvasW = Math.max(topBB.width, leftBB.width + rightBB.width) + 4;
    const canvasH = topBB.height + leftBB.height;
    const outData = createEmptyImageData(canvasW, canvasH);
    const topOffsetX = Math.floor((canvasW - topBB.width) / 2) - topBB.minX;
    const topOffsetY = -topBB.minY;
    const topCenterX = topBB.minX + Math.floor(topBB.width / 2);
    const leftOffsetX = topOffsetX + topCenterX - leftBB.minX - leftBB.width;
    const sideShiftY = Math.ceil(SHEAR_OFFSET);
    const leftOffsetY = topBB.height - leftBB.minY - sideShiftY;
    const rightOffsetX = topOffsetX + topCenterX - rightBB.minX;
    const rightOffsetY = topBB.height - rightBB.minY - sideShiftY;
    _copyImageData(outData, topData, topOffsetX, topOffsetY);
    _copyImageData(outData, leftData, leftOffsetX, leftOffsetY);
    _copyImageData(outData, rightData, rightOffsetX, rightOffsetY);
    return _cropToContent(outData);
}

/** @private 复制 ImageData 到目标指定位置 */
function _copyImageData(dst, src, offsetX, offsetY) {
    for (let sy = 0; sy < src.height; sy++) {
        for (let sx = 0; sx < src.width; sx++) {
            const dx = sx + offsetX, dy = sy + offsetY;
            if (dx >= 0 && dx < dst.width && dy >= 0 && dy < dst.height) {
                const pixel = getPixel(src, sx, sy);
                if (pixel.a > 0) setPixel(dst, dx, dy, pixel);
            }
        }
    }
}

/** @private 裁剪到非透明内容的最小外接矩形 */
function _cropToContent(data) {
    const bb = computeBoundingBox(data);
    if (bb.empty) return createEmptyImageData(1, 1);
    const cropped = createEmptyImageData(bb.width, bb.height);
    for (let sy = bb.minY; sy <= bb.maxY; sy++) {
        for (let sx = bb.minX; sx <= bb.maxX; sx++) {
            setPixel(cropped, sx - bb.minX, sy - bb.minY, getPixel(data, sx, sy));
        }
    }
    return cropped;
}

// ──────── 后处理 ────────

/**
 * 通过 8 邻域分析修复半透明边缘像素断裂。
 * @param {ImageData} data - 纹理数据（就地修改）
 * @param {Object} [options]
 * @param {number} [options.threshold=128] - 不透明判定阈值
 * @param {number} [options.strength=0.7] - 修复强度 (0~1)
 * @returns {ImageData} 修复后的纹理（同一引用）
 */
export function fixEdges(data, options = {}) {
    const { threshold = 128, strength = 0.7 } = options;
    const w = data.width, h = data.height;
    const neighbors = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const alpha = data.data[idx + 3];
            if (alpha <= 0 || alpha >= threshold) continue;
            let opaqueCount = 0, sumAlpha = 0;
            for (const [dx, dy] of neighbors) {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    const nAlpha = data.data[(ny * w + nx) * 4 + 3];
                    if (nAlpha >= threshold) { opaqueCount++; sumAlpha += nAlpha; }
                }
            }
            if (opaqueCount > 4) {
                data.data[idx + 3] = Math.min(255, Math.round(alpha + (sumAlpha / opaqueCount - alpha) * strength));
            }
        }
    }
    return data;
}
