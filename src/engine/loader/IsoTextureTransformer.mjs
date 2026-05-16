// @ts-check

/**
 * @fileoverview
 * 16×16 像素等轴方块纹理变换系统 - 核心纯函数管道。
 *
 * 本模块提供一组可复用的公共函数，将标准 16×16 正方形三面源贴图
 * （顶/左/右）变换为 45° 等轴透视方块的三面纹理，并最终装配为完整方块。
 *
 * 设计原则：
 * - 纯函数：输入 ImageData → 输出 ImageData，无副作用，零渲染依赖
 * - 可组合：每个函数独立可测，可通过管道组合
 * - 像素风格优先：默认使用最近邻采样，保持锯齿边缘
 *
 * 依赖：utils/ImageDataUtils（`getPixel`, `setPixel`, `createEmptyImageData`, `sampleNearest`, `sampleBilinear`）
 *
 * 变换流水线：
 * ```
 * 顶面：source(16×16) → rotateTexture45 → compressVerticalDiagonal → topFace(23×12)
 * 左面：source(16×16) → shearToParallelogram('left')   → leftFace(12×17)
 * 右面：source(16×16) → shearToParallelogram('right')  → rightFace(12×17)
 * 装配：assembleBlock(top, left, right) → finalBlock(~34×28)
 * ```
 *
 * @module loader/IsoTextureTransformer
 */

import {
    createEmptyImageData,
    getPixel,
    setPixel,
    sampleNearest,
    sampleBilinear,
    computeBoundingBox
} from '../utils/ImageDataUtils.mjs';

// ==================== 纹理缓存 ====================

/**
 * URL → ImageData 缓存。
 * 避免同一 URL 在多次 batchLoadAndTransform 调用中重复加载。
 * @private
 */
const _urlImageCache = new Map();

/**
 * 变换结果缓存。
 * key 格式: `${blockType}:${interpolation}:${fixEdges}:${includeAssembled}`
 * 或 `${urls}:${options}` (用于 loadAndTransformBlock)
 * @private
 */
const _transformedCache = new Map();

/** @private 缓存命中统计 */
let _cacheHits = 0;
/** @private 缓存未命中统计 */
let _cacheMisses = 0;

/**
 * 生成变换缓存的标准化键。
 * @private
 * @param {string} id - 标识符（blockType 或 URL 组合）
 * @param {Object} [options]
 * @param {'nearest'|'bilinear'} [options.interpolation='nearest']
 * @param {boolean} [options.fixEdges=false]
 * @param {boolean} [options.includeAssembled=true]
 * @returns {string}
 */
function _makeCacheKey(id, options = {}) {
    const { interpolation = 'nearest', fixEdges: fe = false, includeAssembled = true } = options;
    return `${id}:${interpolation}:${fe ? '1' : '0'}:${includeAssembled ? '1' : '0'}`;
}

/**
 * 清除所有纹理缓存和统计计数器。
 *
 * 在运行时切换纹理集、热重载资源或重建场景时调用，
 * 确保下次 batchLoadAndTransform 调用重新加载并变换所有纹理。
 *
 * @example
 * ```js
 * import { clearTextureCache } from './IsoTextureTransformer.mjs';
 * clearTextureCache();
 * // 下次 batchLoadAndTransform() 将完全重新计算
 * ```
 */
export function clearTextureCache() {
    _urlImageCache.clear();
    _transformedCache.clear();
    _cacheHits = 0;
    _cacheMisses = 0;
}

/**
 * 获取纹理缓存的命中/未命中统计，用于性能监控和调试。
 *
 * @returns {{ hits: number, misses: number, hitRate: string, urlCacheSize: number, transformedCacheSize: number }}
 *
 * @example
 * ```js
 * import { getTextureCacheStats } from './IsoTextureTransformer.mjs';
 * console.table(getTextureCacheStats());
 * // { hits: 42, misses: 14, hitRate: '75.0%', urlCacheSize: 7, transformedCacheSize: 14 }
 * ```
 */
export function getTextureCacheStats() {
    const total = _cacheHits + _cacheMisses;
    const hitRate = total > 0 ? ((_cacheHits / total) * 100).toFixed(1) + '%' : 'N/A';
    return {
        hits: _cacheHits,
        misses: _cacheMisses,
        hitRate,
        urlCacheSize: _urlImageCache.size,
        transformedCacheSize: _transformedCache.size
    };
}

// ==================== 常量定义 ====================

/** 源纹理标准尺寸（像素） */
export const SRC_SIZE = 16;

/**
 * 45° 旋转后的外接画布边长。
 *
 * 数学上 16√2 ≈ 22.627，ceil 为 23。此处设为 24 是为了使菱形几何宽度
 * （ROTATED_SIZE=24）与侧面宽度（SIDE_WIDTH=12 × 2=24）完全匹配，
 * 消除顶面与侧面接缝处的 1px 间隙。
 * 多出的 1px 由 {@link expandTopFaceEdges} 在压缩后填充。
 *
 * @see expandTopFaceEdges - 压缩后边缘填充使菱形内容占满 24px
 */
export const ROTATED_SIZE = 24;

/** 压缩后的顶面高度：ceil(ROTATED_SIZE * 0.5) = 12 */
export const TOP_HEIGHT = 12;

/**
 * 侧面平行四边形宽度。
 *
 * 几何计算：对角线 sqrt(128) ≈ 11.314 → ceil 得 12。
 * 此值决定了 16×16 源纹理经水平压缩加剪切后，在等轴投影中的可见宽度。
 * 错误值（如 10）会导致侧面过窄，与 24px 宽的顶面菱形不匹配（左右各缺 2px）。
 */
export const SIDE_WIDTH = 12;

/** 侧面平行四边形剪切偏移量：sqrt(128) / 2 ≈ 5.657 */
export const SHEAR_OFFSET = Math.sqrt(128) / 2; // ≈ 5.656854249492381

/**
 * 侧面平行四边形输出高度。
 * 公式：floor(SRC_SIZE + SHEAR_OFFSET) = floor(21.657) = 21
 */
export const SIDE_HEIGHT = Math.floor(SRC_SIZE + SHEAR_OFFSET);

/** 装配后的预期总宽度：与 ROTATED_SIZE 一致 */
export const BLOCK_WIDTH = ROTATED_SIZE; // 24

/** 装配后的预期总高度：SIDE_HEIGHT=21 → 12 + 21 - 1 = 32 */
export const BLOCK_HEIGHT = TOP_HEIGHT + SIDE_HEIGHT - 1;

/** 角度常量 */
const COS45 = Math.cos(Math.PI / 4); // ≈ 0.7071067811865476
const SIN45 = Math.sin(Math.PI / 4); // ≈ 0.7071067811865476

// ==================== 顶面变换 ====================

/**
 * 将 16×16 正方形纹理绕中心旋转 45°，背景透明。
 *
 * 算法：反向映射（反向查表法）。
 * 对于输出图像中的每个像素，计算它在输入图像中的对应采样位置，
 * 使用最近邻插值（像素风格）或双线性插值采样。
 *
 * 旋转中心：输入 (7.5, 7.5) → 输出 (11, 11)
 *
 * @param {ImageData} srcData - 16×16 像素的源纹理数据
 * @param {Object}   [options]
 * @param {'nearest'|'bilinear'} [options.interpolation='nearest'] - 采样插值方式
 * @returns {ImageData} 24×24 像素的旋转后纹理数据
 *
 * @example
 * ```js
 * const rotated = rotateTexture45(topImageData, { interpolation: 'nearest' });
 * // rotated.width === 24, rotated.height === 24
 * ```
 */
export function rotateTexture45(srcData, options = {}) {
    const { interpolation = 'nearest' } = options;
    const sampler = interpolation === 'bilinear' ? sampleBilinear : sampleNearest;

    const srcW = srcData.width;
    const srcH = srcData.height;
    const dstW = ROTATED_SIZE;
    const dstH = ROTATED_SIZE;

    // 输出中心与输入中心
    const cxOut = (dstW - 1) / 2; // 11
    const cyOut = (dstH - 1) / 2; // 11
    const cxIn  = (srcW - 1) / 2; // 7.5
    const cyIn  = (srcH - 1) / 2; // 7.5

    const outData = createEmptyImageData(dstW, dstH);

    for (let oy = 0; oy < dstH; oy++) {
        for (let ox = 0; ox < dstW; ox++) {
            // 1. 将输出坐标平移到中心
            const nx = ox - cxOut;
            const ny = oy - cyOut;

            // 2. 应用逆旋转矩阵 R(-45°)
            //    [cos45  sin45]   [nx]
            //    [-sin45 cos45]   [ny]
            const sx =  nx * COS45 + ny * SIN45;
            const sy = -nx * SIN45 + ny * COS45;

            // 3. 映射回输入坐标
            const ix = sx + cxIn;
            const iy = sy + cyIn;

            // 4. 边界检查
            if (ix >= 0 && ix < srcW && iy >= 0 && iy < srcH) {
                const pixel = sampler(srcData, ix, iy);
                setPixel(outData, ox, oy, pixel);
            }
            // 超出边界 → 保持透明（默认）
        }
    }

    return outData;
}

/**
 * 将旋转后的菱形纹理沿垂直对角线压缩 50%。
 *
 * 输出宽度不变（24），高度压缩为 12。
 * 水平对角线长度保持不变，垂直对角线减半。
 *
 * @param {ImageData} srcData - 24×24 旋转后纹理
 * @returns {ImageData} 24×12 像素的等轴顶面纹理
 *
 * @example
 * ```js
 * const compressed = compressVerticalDiagonal(rotatedData);
 * // compressed.width === 24, compressed.height === 12
 * ```
 */
export function compressVerticalDiagonal(srcData) {
    const srcW = srcData.width;  // 24
    const srcH = srcData.height; // 24
    const dstW = srcW;           // 23
    const dstH = TOP_HEIGHT;     // 12

    const scaleY = srcH / dstH; // 24 / 12 = 2.0

    const outData = createEmptyImageData(dstW, dstH);

    for (let oy = 0; oy < dstH; oy++) {
        for (let ox = 0; ox < dstW; ox++) {
            // 水平不变，垂直压缩
            const ix = ox;
            // 中心对齐的反向映射
            const iy = (oy + 0.5) * scaleY - 0.5;

            // 边界钳位
            const clampedIy = Math.max(0, Math.min(srcH - 1, iy));

            const pixel = sampleNearest(srcData, ix, clampedIy);
            setPixel(outData, ox, oy, pixel);
        }
    }

    return outData;
}

// ==================== 顶面边缘扩展（消除接缝间隙） ====================

/**
 * 将顶面纹理的边缘列扩展，使菱形内容填满整个画布宽度。
 *
 * ## 为什么需要
 *
 * 菱形经 45° 旋转后外接画布为 23×23（ceil(16√2)），但 ROTATED_SIZE 被设为 24，
 * 使菱形左右边缘各有约 0.7px 的透明/半透明区域。当顶面 Sprite 以 anchor(0.5, 0.5)
 * 居中显示时，菱形实际可见宽度仅 ~22.6px，而左右侧面（SIDE_WIDTH=12）要求顶面占满 24px，
 * 导致顶面与侧面接缝处出现视觉间隙。
 *
 * ## 做法
 *
 * 对于输出画布（24×12）的每一行：
 * - 将第 **2** 列的内容复制到第 0 列**和**第 1 列（左侧扩展 2px）
 * - 将第 **(w-3)** 列的内容复制到第 (w-2) 列**和**第 (w-1) 列（右侧扩展 2px）
 *
 * 选择第 2 列而非第 1 列作为采样源的原因是：`compressVerticalDiagonal` 使用
 * 最近邻采样，菱形在顶部和底部行宽度极窄（仅约 3-9px），导致第 1 列在这些行上
 * 可能仍为半透明。第 2 列在所有行上几乎都不透明，更可靠地填满间隙。
 *
 * 扩展 2 列（共 4px 补丁 = 左右各 2px）使可见内容从 ~22.6px 扩大到 ~24.6px，
 * 完全覆盖 24px 画布宽度。由于像素风格纹理的边缘颜色渐变平滑，此操作
 * 在视觉上不可察觉。
 *
 * @param {ImageData} topData - compressVerticalDiagonal 输出的顶面纹理（24×12）
 * @returns {ImageData} 边缘扩展后的顶面纹理（尺寸不变，边缘列已修复）
 *
 * @example
 * ```js
 * const fixed = expandTopFaceEdges(compressedTop);
 * // fixed.width === 24, fixed.height === 12
 * // 第 0-1 列和第 22-23 列现已不透明
 * // 实际可见内容覆盖整个 24px 宽度
 * ```
 */
export function expandTopFaceEdges(topData) {
    const w = topData.width;
    const h = topData.height;

    // 宽度必须 ≥ 5 才能执行左右各 2 列扩展填充
    if (w < 5) return topData;

    for (let y = 0; y < h; y++) {
        // 左边缘扩展：复制第 2 列 → 第 0-1 列
        const leftPixel = getPixel(topData, 2, y);
        setPixel(topData, 0, y, leftPixel);
        setPixel(topData, 1, y, leftPixel);

        // 右边缘扩展：复制第 (w-3) 列 → 第 (w-2, w-1) 列
        const rightPixel = getPixel(topData, w - 3, y);
        setPixel(topData, w - 2, y, rightPixel);
        setPixel(topData, w - 1, y, rightPixel);
    }

    return topData;
}

/**
 * 完整的顶面等轴变换管道。
 *
 * 组合 rotateTexture45 → compressVerticalDiagonal → expandTopFaceEdges 三步，
 * 从 16×16 正方形源纹理生成 24×12 等轴顶面纹理，边缘填充后菱形内容
 * 填满 24px 宽度，与侧面无缝拼接。
 *
 * 通过 `options.fixEdgeGap` 控制是否执行边缘填充（默认 true）。
 *
 * @param {ImageData} srcData - 16×16 正方形顶面源纹理
 * @param {Object}   [options]
 * @param {'nearest'|'bilinear'} [options.interpolation='nearest'] - 采样插值方式
 * @param {boolean}  [options.fixEdgeGap=true] - 是否执行边缘填充以消除接缝间隙
 * @returns {ImageData} 24×12 等轴顶面纹理
 *
 * @example
 * ```js
 * const topFace = transformTopFace(grassTopImageData);
 * // topFace.width === 24, topFace.height === 12
 * ```
 */
export function transformTopFace(srcData, options = {}) {
    const { fixEdgeGap = true } = options;
    let topData = rotateTexture45(srcData, options);
    topData = compressVerticalDiagonal(topData);
    if (fixEdgeGap) {
        topData = expandTopFaceEdges(topData);
    }
    return topData;
}

// ==================== 侧面变换 ====================

/**
 * 将 16×16 正方形纹理剪切为等轴侧面平行四边形。
 *
 * 等轴侧面几何参数：
 * - 宽度（上/下底）：√128 ≈ 11.31 像素，取整为 12
 * - 剪切偏移：√128 / 2 ≈ 5.66 像素
 * - 输出尺寸：12 × 21 像素（SIDE_WIDTH × SIDE_HEIGHT）
 *
 * @param {ImageData} srcData   - 16×16 正方形侧面源纹理
 * @param {'left'|'right'} direction - 侧面方向
 * @returns {ImageData} 等轴侧面平行四边形纹理 (12×21)
 *
 * @example
 * ```js
 * const leftFace  = shearToParallelogram(grassLeftData, 'left');
 * const rightFace = shearToParallelogram(grassRightData, 'right');
 * ```
 */
export function shearToParallelogram(srcData, direction) {
    const srcW = srcData.width;  // 16
    const srcH = srcData.height; // 16
    const dstW = SIDE_WIDTH;     // 12
    const dstH = SIDE_HEIGHT;    // 21

    // 水平压缩系数：将 16px 源宽度映射到 12px 输出宽度
    const scaleX = srcW / dstW; // 16 / 12 ≈ 1.333

    const outData = createEmptyImageData(dstW, dstH);

    for (let oy = 0; oy < dstH; oy++) {
        for (let ox = 0; ox < dstW; ox++) {
            // ── 水平：完整 16px → 12px 压缩映射（居中对齐）──
            const normalizedX = (ox + 0.5) / dstW; // [0.042, 0.958] 居中归一化
            const ix = normalizedX * srcW;          // [0.667, 15.333] 略超源边界保证全覆盖

            // ── 垂直：计算当前列的剪切偏移量 ──
            // 左面：右边缘偏移最大（ox=w-1 → 偏移=SHEAR_OFFSET），左边缘固定（ox=0 → 偏移=0）
            //       偏移量从左→右线性递增
            //       公式：iy = oy - SHEAR_OFFSET * (ox / (w-1))
            //       左边缘(ox=0)偏移=0，右边缘(ox=w-1)偏移=SHEAR_OFFSET
            // 右面：左边缘偏移最大（ox=0 → 偏移=SHEAR_OFFSET），右边缘固定（ox=w-1 → 偏移=0）
            //       偏移量从右→左线性递增
            //       公式：iy = oy - SHEAR_OFFSET * (1 - ox / (w-1))
            //       左边缘(ox=0)偏移=SHEAR_OFFSET，右边缘(ox=w-1)偏移=0
            const t = direction === 'left'
                ? (ox / (dstW - 1))      // 左面：t∈[0,1]，ox=0→t=0(偏移0)，ox=11→t=1(偏移SHEAR_OFFSET)
                : (1 - ox / (dstW - 1));  // 右面：t∈[0,1]，ox=0→t=1(偏移SHEAR_OFFSET)，ox=11→t=0(偏移0)
            const shearOffset = SHEAR_OFFSET * t;

            // ── 垂直：纯剪切逆映射（无压缩）──
            // 关键修复：使用纯剪切公式 iy = oy - shearOffset
            // 当 iy < 0（剪切边上方）或 iy >= srcH（剪切边下方）时，
            // 像素位于平行四边形外部 → 保持透明，绝不钳位。
            // 整个源纹理在面的不同列上展示不同切片，从整体看完整可见。
            let iy = oy - shearOffset;

            // 边界检查：超出源范围的像素保持透明（不在平行四边形内）
            if (ix < 0 || ix >= srcW || iy < 0 || iy >= srcH) {
                continue; // 保持透明
            }

            // 使用最近邻采样保持像素风格
            const pixel = sampleNearest(srcData, ix, iy);
            setPixel(outData, ox, oy, pixel);
        }
    }

    return outData;
}

// ==================== 装配 ====================

/**
 * 将三个变换后的面（顶/左/右）装配为完整的等轴方块纹理。
 *
 * 装配布局（像素坐标，原点在左上角）：
 * ```
 *        ╱╲                    ← topData (23×12)，居中放置
 *       ╱  ╲
 *      ╱    ╲
 *     ╱______╲
 *    ╱ left ╱ ╲ right         ← left (12×17) 与 right (12×17)
 *   ╱       ╱   ╲              ← 分别贴在顶面左右下方
 *  ╱_______╱_____╲
 * ```
 *
 * 偏移量通过 computeBoundingBox 自动检测非透明边界来精确定位。
 *
 * @param {ImageData} topData    - 变换后的顶面纹理 (23×12)
 * @param {ImageData} leftData   - 变换后的左面纹理 (12×17)
 * @param {ImageData} rightData  - 变换后的右面纹理 (12×17)
 * @returns {ImageData} 完整等轴方块的像素数据 (~34×28)
 *
 * @example
 * ```js
 * const block = assembleBlock(topFace, leftFace, rightFace);
 * // 可直接用于创建 PIXI.Sprite 或绘制到 Canvas
 * ```
 */
export function assembleBlock(topData, leftData, rightData) {
    // 1. 检测三个面的非透明边界框
    const topBB    = computeBoundingBox(topData);
    const leftBB   = computeBoundingBox(leftData);
    const rightBB  = computeBoundingBox(rightData);

    // 2. 计算装配画布尺寸
    //    顶面宽度 + 侧面补偿
    //    顶面高度 + 侧面高度 - 重叠行
    const canvasW = Math.max(
        topBB.width,
        leftBB.width + rightBB.width
    ) + 4; // 各边 2px 安全边距

    const canvasH = topBB.height + leftBB.height;

    const outData = createEmptyImageData(canvasW, canvasH);

    // 3. 计算各面的放置偏移
    //    顶面：水平居中
    const topOffsetX = Math.floor((canvasW - topBB.width) / 2) - topBB.minX;
    const topOffsetY = -topBB.minY;

    //    左面：顶面对齐到左面顶部，左面对齐到顶面左下角
    //    顶面的菱形底边中心在 topBB 的水平中点
    const topCenterX = topBB.minX + Math.floor(topBB.width / 2);
    //    左面的右边缘应大致对齐到顶面中心
    const leftOffsetX = topOffsetX + topCenterX - leftBB.minX - leftBB.width;
    //    垂直偏移：侧面平行四边形的最早可见行 = ceil(SHEAR_OFFSET) ≈ 6，
    //    将此值作为上移量，使侧面可见内容与顶面菱形底边对齐。
    //    必须与 BlockSprite._layoutIsoFaces 中的 sideShiftY 保持一致。
    const sideShiftY = Math.ceil(SHEAR_OFFSET); // ceil(5.657) = 6px 向上偏移
    const leftOffsetY = topBB.height - leftBB.minY - sideShiftY;

    //    右面：右面的左边缘对齐到顶面中心
    const rightOffsetX = topOffsetX + topCenterX - rightBB.minX;
    const rightOffsetY = topBB.height - rightBB.minY - sideShiftY;

    // 4. 绘制三个面到装配画布
    //    使用像素级复制，保持透明度
    _copyImageData(outData, topData, topOffsetX, topOffsetY);
    _copyImageData(outData, leftData, leftOffsetX, leftOffsetY);
    _copyImageData(outData, rightData, rightOffsetX, rightOffsetY);

    // 5. 裁剪掉四周的空白区域
    return _cropToContent(outData);
}

/**
 * 将源 ImageData 复制到目标 ImageData 的指定位置。
 *
 * @private
 * @param {ImageData} dst    - 目标图像数据（就地修改）
 * @param {ImageData} src    - 源图像数据
 * @param {number}    offsetX - 目标 X 偏移
 * @param {number}    offsetY - 目标 Y 偏移
 */
function _copyImageData(dst, src, offsetX, offsetY) {
    for (let sy = 0; sy < src.height; sy++) {
        for (let sx = 0; sx < src.width; sx++) {
            const dx = sx + offsetX;
            const dy = sy + offsetY;
            if (dx >= 0 && dx < dst.width && dy >= 0 && dy < dst.height) {
                const pixel = getPixel(src, sx, sy);
                // 如果目标已有像素且新像素透明，保留原像素
                // 否则覆盖（处理三面重叠区域）
                if (pixel.a > 0) {
                    setPixel(dst, dx, dy, pixel);
                }
            }
        }
    }
}

/**
 * 裁剪 ImageData 到非透明内容的最小外接矩形。
 *
 * @private
 * @param {ImageData} data - 待裁剪的图像数据
 * @returns {ImageData} 裁剪后的图像数据
 */
function _cropToContent(data) {
    const bb = computeBoundingBox(data);
    if (bb.empty) {
        return createEmptyImageData(1, 1);
    }

    const cropped = createEmptyImageData(bb.width, bb.height);
    for (let sy = bb.minY; sy <= bb.maxY; sy++) {
        for (let sx = bb.minX; sx <= bb.maxX; sx++) {
            const pixel = getPixel(data, sx, sy);
            setPixel(cropped, sx - bb.minX, sy - bb.minY, pixel);
        }
    }
    return cropped;
}

// ==================== 后处理 ====================

/**
 * 对变换后的纹理执行边缘修复。
 *
 * 像素风格纹理经过旋转和压缩后，边缘可能出现单像素断裂。
 * 此函数通过检查半透明像素的 8 邻域来填补断裂。
 *
 * 策略：对于 alpha ∈ [1, threshold) 的"半透明边缘像素"，
 * 检查其 8 邻域中不透明像素（alpha ≥ threshold）的数量，
 * 若 > 4 个且其 alpha 高于当前像素，则提升该像素的 alpha。
 *
 * @param {ImageData} data               - 变换后的纹理数据（就地修改）
 * @param {Object}   [options]
 * @param {number}   [options.threshold=128]   - 不透明判定阈值
 * @param {number}   [options.strength=0.7]    - 修复强度 (0~1)
 * @returns {ImageData} 修复后的纹理数据（与输入为同一引用）
 *
 * @example
 * ```js
 * fixEdges(transformedData, { threshold: 128, strength: 0.7 });
 * ```
 */
export function fixEdges(data, options = {}) {
    const { threshold = 128, strength = 0.7 } = options;
    const w = data.width;
    const h = data.height;

    // 8 邻域偏移
    const neighbors = [
        [-1, -1], [0, -1], [1, -1],
        [-1,  0],          [1,  0],
        [-1,  1], [0,  1], [1,  1]
    ];

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const alpha = data.data[idx + 3];

            // 只处理半透明边缘像素
            if (alpha <= 0 || alpha >= threshold) continue;

            // 统计邻域中不透明像素的数量和平均 alpha
            let opaqueCount = 0;
            let sumAlpha = 0;

            for (const [dx, dy] of neighbors) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    const nAlpha = data.data[(ny * w + nx) * 4 + 3];
                    if (nAlpha >= threshold) {
                        opaqueCount++;
                        sumAlpha += nAlpha;
                    }
                }
            }

            // 如果周围有足够多的不透明像素，提升当前像素
            if (opaqueCount > 4) {
                const avgAlpha = sumAlpha / opaqueCount;
                const boosted = Math.round(
                    alpha + (avgAlpha - alpha) * strength
                );
                data.data[idx + 3] = Math.min(255, boosted);
            }
        }
    }

    return data;
}

// ==================== 批量处理 ====================

/**
 * 批量处理多个方块类型的纹理。
 *
 * 接受一个 { blockType: { top, left, right } } 映射表，
 * 返回处理后的 { blockType: { topData, leftData, rightData, assembledData } }。
 *
 * 用于资产加载阶段的批量预处理。
 *
 * @param {Object<string, { top: ImageData, left: ImageData, right: ImageData }>} textureMap
 *        方块类型映射表，key 为类型名，value 为三面 ImageData
 * @param {Object} [options]
 * @param {'nearest'|'bilinear'} [options.interpolation='nearest'] - 采样插值方式
 * @param {boolean} [options.fixEdges=false] - 是否执行边缘修复
 * @param {boolean} [options.includeAssembled=true] - 是否包含装配后的完整方块图
 * @returns {Object<string, { top: ImageData, left: ImageData, right: ImageData, assembled?: ImageData }>}
 *
 * @example
 * ```js
 * const result = batchTransformBlocks({
 *   grass: { top: grassTop, left: grassLeft, right: grassRight },
 *   stone: { top: stoneTop, left: stoneLeft, right: stoneRight }
 * });
 * // result.grass.top.width === 24
 * // result.stone.assembled.width === ~34
 * ```
 */
export function batchTransformBlocks(textureMap, options = {}) {
    const {
        interpolation = 'nearest',
        fixEdges: shouldFixEdges = false,
        includeAssembled = true
    } = options;

    /** @type {Object<string, { top: ImageData, left: ImageData, right: ImageData, assembled?: ImageData }>} */
    const result = {};

    for (const [blockType, faces] of Object.entries(textureMap)) {
        // 变换三面
        const top   = transformTopFace(faces.top, { interpolation });
        const left  = shearToParallelogram(faces.left, 'left');
        const right = shearToParallelogram(faces.right, 'right');

        // 可选边缘修复
        if (shouldFixEdges) {
            fixEdges(top);
            fixEdges(left);
            fixEdges(right);
        }

        /** @type {{ top: ImageData, left: ImageData, right: ImageData, assembled?: ImageData }} */
        const entry = { top, left, right };

        // 可选装配
        if (includeAssembled) {
            entry.assembled = assembleBlock(top, left, right);
        }

        result[blockType] = entry;
    }

    return result;
}

// ==================== 完整管道便捷函数 ====================

/**
 * 从三面 URL 异步加载并执行完整等轴变换管道。
 *
 * 一站式函数：加载 → 变换 → 装配，返回可直接用于渲染纹理的 ImageData。
 *
 * @param {string} topUrl    - 顶面贴图 URL
 * @param {string} leftUrl   - 左面贴图 URL
 * @param {string} rightUrl  - 右面贴图 URL
 * @param {Object} [options]
 * @param {'nearest'|'bilinear'} [options.interpolation='nearest']
 * @returns {Promise<{ top: ImageData, left: ImageData, right: ImageData, assembled: ImageData }>}
 *
 * @example
 * ```js
 * const result = await loadAndTransformBlock(
 *   'assets/blocks/grass/block_grass_top.png',
 *   'assets/blocks/grass/block_grass_left.png',
 *   'assets/blocks/grass/block_grass_right.png'
 * );
 * // result.assembled 是完整等轴方块纹理
 * ```
 */
export async function loadAndTransformBlock(topUrl, leftUrl, rightUrl, options = {}) {
    // ── 尝试从变换缓存获取 ──
    const cacheKey = _makeCacheKey(`single:${topUrl}|${leftUrl}|${rightUrl}`, options);
    if (_transformedCache.has(cacheKey)) {
        _cacheHits++;
        return _transformedCache.get(cacheKey);
    }
    _cacheMisses++;

    const { imageDataFromUrl } = await import('../utils/ImageDataUtils.mjs');

    // ── 带 URL 缓存的图片加载 ──
    const loadImage = async (url) => {
        if (_urlImageCache.has(url)) {
            return _urlImageCache.get(url);
        }
        const imgData = await imageDataFromUrl(url);
        _urlImageCache.set(url, imgData);
        return imgData;
    };

    const [topRaw, leftRaw, rightRaw] = await Promise.all([
        loadImage(topUrl),
        loadImage(leftUrl),
        loadImage(rightUrl)
    ]);

    const top   = transformTopFace(topRaw, options);
    const left  = shearToParallelogram(leftRaw, 'left');
    const right = shearToParallelogram(rightRaw, 'right');
    const assembled = assembleBlock(top, left, right);

    const result = { top, left, right, assembled };
    _transformedCache.set(cacheKey, result);
    return result;
}

/**
 * 从 BLOCK_TEXTURE_MAP 批量加载并变换所有注册的方块类型。
 *
 * 自动读取 BlockSprite 的 BLOCK_TEXTURE_MAP 或传入自定义映射表。
 *
 * @param {Object<string, { top: string, left: string, right: string }>} blockTextureMap
 *        方块类型 → 三面路径 映射表
 * @param {Object} [options]
 * @param {'nearest'|'bilinear'} [options.interpolation='nearest']
 * @returns {Promise<Object<string, { top: ImageData, left: ImageData, right: ImageData, assembled?: ImageData }>>}
 *
 * @example
 * ```js
 * import { BLOCK_TEXTURE_MAP } from '../render/BlockSprite.mjs';
 * const allBlocks = await batchLoadAndTransform(BLOCK_TEXTURE_MAP);
 * ```
 */
export async function batchLoadAndTransform(blockTextureMap, options = {}) {
    const { imageDataFromUrl } = await import('../utils/ImageDataUtils.mjs');

    /** @type {Object<string, { top: ImageData, left: ImageData, right: ImageData, assembled?: ImageData }>} */
    const result = {};
    /** @type {string[]} 需要实际加载和变换的 blockType */
    const toProcess = [];

    // ── 第一阶段：检查变换缓存，只处理未缓存的类型 ──
    for (const blockType of Object.keys(blockTextureMap)) {
        const cacheKey = _makeCacheKey(blockType, options);
        if (_transformedCache.has(cacheKey)) {
            _cacheHits++;
            result[blockType] = _transformedCache.get(cacheKey);
        } else {
            _cacheMisses++;
            toProcess.push(blockType);
        }
    }

    // ── 第二阶段：仅加载和变换未缓存的类型 ──
    if (toProcess.length > 0) {
        /** @type {Object<string, { top: ImageData, left: ImageData, right: ImageData }>} */
        const rawMap = {};

        // 带 URL 缓存的并行加载
        const loadPromises = toProcess.map(async (type) => {
            const paths = blockTextureMap[type];

            const loadImage = async (url) => {
                if (_urlImageCache.has(url)) {
                    return _urlImageCache.get(url);
                }
                const imgData = await imageDataFromUrl(url);
                _urlImageCache.set(url, imgData);
                return imgData;
            };

            const [top, left, right] = await Promise.all([
                loadImage(paths.top),
                loadImage(paths.left),
                loadImage(paths.right)
            ]);
            rawMap[type] = { top, left, right };
        });
        await Promise.all(loadPromises);

        // 变换并缓存
        const transformed = batchTransformBlocks(rawMap, options);
        for (const type of toProcess) {
            const cacheKey = _makeCacheKey(type, options);
            _transformedCache.set(cacheKey, transformed[type]);
            result[type] = transformed[type];
        }
    }

    return result;
}
