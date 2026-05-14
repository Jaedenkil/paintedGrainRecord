// @ts-check

/**
 * @fileoverview
 * ImageData 像素级工具函数集 - 零依赖纯函数，用于像素纹理的读取、写入、采样。
 *
 * 所有函数操作 `ImageData` 对象（Canvas API 的像素缓冲区），
 * 不依赖任何渲染上下文，可在 Web Worker / Node.js 环境运行。
 *
 * 本模块是 `IsoTextureTransformer` 的底层依赖。
 *
 * @module utils/ImageDataUtils
 */

// ==================== 创建与初始化 ====================

/**
 * 创建指定尺寸的透明 ImageData。
 *
 * 所有像素的 RGBA 初始化为 (0, 0, 0, 0)，即全透明。
 *
 * @param {number} width  - 图像宽度（像素）
 * @param {number} height - 图像高度（像素）
 * @returns {ImageData} 全透明的 ImageData 对象
 *
 * @example
 * ```js
 * const img = createEmptyImageData(16, 16);
 * // img.data 长度为 16 * 16 * 4 = 1024，所有字节为 0
 * ```
 */
export function createEmptyImageData(width, height) {
    // 使用 OffscreenCanvas 创建 ImageData（兼容 Electron 和现代浏览器）
    if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
        return ctx.createImageData(width, height);
    }
    // 回退：使用常规 Canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    return ctx.createImageData(width, height);
}

/**
 * 从 HTMLImageElement 加载并转换为 ImageData。
 *
 * @param {HTMLImageElement} image - 已加载完成的图片元素
 * @returns {ImageData} 图片的像素数据
 */
export function imageDataFromImage(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * 从 URL 异步加载图片并转换为 ImageData。
 *
 * 包含 5 秒超时降级机制。
 *
 * @param {string} url - 图片 URL 或路径
 * @returns {Promise<ImageData>} 加载完成的 ImageData
 *
 * @example
 * ```js
 * const data = await imageDataFromUrl('assets/blocks/grass/block_grass_top.png');
 * ```
 */
export function imageDataFromUrl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        let settled = false;

        const done = (/** @type {Error|null|undefined} */ err) => {
            if (settled) return;
            settled = true;
            if (err) reject(err);
            else resolve(imageDataFromImage(img));
        };

        img.onload  = () => done(null);
        img.onerror = () => done(new Error(`图片加载失败: ${url}`));
        img.onabort = () => done(new Error(`图片加载被中断: ${url}`));

        // 5 秒超时
        setTimeout(() => done(new Error(`图片加载超时 (5000ms): ${url}`)), 5000);

        img.src = url;
    });
}

// ==================== 像素读写 ====================

/**
 * 获取 ImageData 中指定坐标的 RGBA 值。
 *
 * 坐标超出图像边界时返回全透明 (0, 0, 0, 0)。
 *
 * @param {ImageData} data  - 图像数据
 * @param {number}    x     - 像素 X 坐标（整数）
 * @param {number}    y     - 像素 Y 坐标（整数）
 * @returns {{ r: number, g: number, b: number, a: number }} RGBA 各通道值（0-255）
 *
 * @example
 * ```js
 * const pixel = getPixel(imgData, 5, 3);
 * // pixel.r === imgData.data[(3 * imgData.width + 5) * 4]
 * ```
 */
export function getPixel(data, x, y) {
    // 边界检查
    if (x < 0 || x >= data.width || y < 0 || y >= data.height) {
        return { r: 0, g: 0, b: 0, a: 0 };
    }

    const idx = (y * data.width + x) << 2; // 等价于 * 4，位运算微优化
    return {
        r: data.data[idx],
        g: data.data[idx + 1],
        b: data.data[idx + 2],
        a: data.data[idx + 3]
    };
}

/**
 * 设置 ImageData 中指定坐标的 RGBA 值。
 *
 * 坐标超出图像边界时静默忽略（无操作）。
 *
 * @param {ImageData} data           - 图像数据（就地修改）
 * @param {number}    x              - 像素 X 坐标（整数）
 * @param {number}    y              - 像素 Y 坐标（整数）
 * @param {{ r: number, g: number, b: number, a: number }} color - RGBA 颜色值
 *
 * @example
 * ```js
 * setPixel(imgData, 8, 8, { r: 255, g: 0, b: 0, a: 255 });
 * ```
 */
export function setPixel(data, x, y, color) {
    if (x < 0 || x >= data.width || y < 0 || y >= data.height) return;

    const idx = (y * data.width + x) << 2;
    data.data[idx]     = color.r;
    data.data[idx + 1] = color.g;
    data.data[idx + 2] = color.b;
    data.data[idx + 3] = color.a;
}

// ==================== 采样器 ====================

/**
 * 最近邻插值采样。
 *
 * 对于浮点坐标 (x, y)，取最近的整数像素值。
 * 适用于像素风格：保持锯齿边缘，不产生模糊。
 *
 * @param {ImageData} data - 图像数据
 * @param {number}    x    - 浮点 X 坐标
 * @param {number}    y    - 浮点 Y 坐标
 * @returns {{ r: number, g: number, b: number, a: number }} 采样结果
 *
 * @example
 * ```js
 * const p = sampleNearest(img, 5.7, 3.2);
 * // 等价于 getPixel(img, 6, 3)
 * ```
 */
export function sampleNearest(data, x, y) {
    return getPixel(data, Math.round(x), Math.round(y));
}

/**
 * 双线性插值采样。
 *
 * 在 (x, y) 的 2×2 邻域内做线性加权平均。
 * 适用于高质量输出（如加载画面），像素风格不推荐。
 *
 * @param {ImageData} data - 图像数据
 * @param {number}    x    - 浮点 X 坐标
 * @param {number}    y    - 浮点 Y 坐标
 * @returns {{ r: number, g: number, b: number, a: number }} 插值结果
 */
export function sampleBilinear(data, x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const fx = x - x0;
    const fy = y - y0;

    // 四个角采样
    const p00 = getPixel(data, x0, y0);
    const p10 = getPixel(data, x1, y0);
    const p01 = getPixel(data, x0, y1);
    const p11 = getPixel(data, x1, y1);

    // 水平插值
    const r0 = p00.r + (p10.r - p00.r) * fx;
    const g0 = p00.g + (p10.g - p00.g) * fx;
    const b0 = p00.b + (p10.b - p00.b) * fx;
    const a0 = p00.a + (p10.a - p00.a) * fx;

    const r1 = p01.r + (p11.r - p01.r) * fx;
    const g1 = p01.g + (p11.g - p01.g) * fx;
    const b1 = p01.b + (p11.b - p01.b) * fx;
    const a1 = p01.a + (p11.a - p01.a) * fx;

    // 垂直插值
    return {
        r: r0 + (r1 - r0) * fy,
        g: g0 + (g1 - g0) * fy,
        b: b0 + (b1 - b0) * fy,
        a: a0 + (a1 - a0) * fy
    };
}

// ==================== 图像分析 ====================

/**
 * 计算 ImageData 中非透明像素的边界框。
 *
 * 遍历所有像素，找到 alpha > 0 的最小/最大 x/y 范围。
 *
 * @param {ImageData} data - 图像数据
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number,
 *             width: number, height: number, empty: boolean }}
 *         边界框信息。若图像全透明，empty = true。
 *
 * @example
 * ```js
 * const bb = computeBoundingBox(imgData);
 * // bb.width = bb.maxX - bb.minX + 1
 * // bb.empty === (alpha 全为 0)
 * ```
 */
export function computeBoundingBox(data) {
    let minX = data.width;
    let minY = data.height;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    for (let y = 0; y < data.height; y++) {
        for (let x = 0; x < data.width; x++) {
            const alpha = data.data[(y * data.width + x) * 4 + 3];
            if (alpha > 0) {
                found = true;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (!found) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, empty: true };
    }

    return {
        minX, minY, maxX, maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        empty: false
    };
}

// ==================== 转换适配器 ====================

/**
 * 将 ImageData 转换为 PIXI.Texture。
 *
 * 通过 Canvas → PIXI.Texture.from(HTMLCanvasElement) 路径。
 * 此函数仅在有 PixiJS 全局可用时工作。
 *
 * @param {ImageData} imageData - 像素数据
 * @returns {import('pixi.js').Texture} PixiJS 纹理对象
 * @throws {Error} 若 PixiJS 未定义则抛出异常
 *
 * @example
 * ```js
 * const tex = imageDataToPixiTexture(transformedData);
 * sprite.texture = tex;
 * ```
 */
export function imageDataToPixiTexture(imageData) {
    if (typeof PIXI === 'undefined') {
        throw new Error('PixiJS 未加载，无法创建 PIXI.Texture');
    }

    // 1. 将 ImageData 绘制到 Canvas
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    ctx.putImageData(imageData, 0, 0);

    // 2. 从 Canvas 创建 PIXI.Texture
    return PIXI.Texture.from(canvas);
}

/**
 * 将 ImageData 绘制到目标 Canvas 上下文的指定位置。
 *
 * @param {CanvasRenderingContext2D} ctx    - 目标 Canvas 上下文
 * @param {ImageData}                data   - 像素数据
 * @param {number}                   destX  - 目标 X 坐标
 * @param {number}                   destY  - 目标 Y 坐标
 */
export function drawImageData(ctx, data, destX, destY) {
    ctx.putImageData(data, destX, destY);
}

/**
 * 复制 ImageData（深拷贝）。
 *
 * @param {ImageData} source - 源图像数据
 * @returns {ImageData} 新的独立副本
 */
export function cloneImageData(source) {
    const copy = createEmptyImageData(source.width, source.height);
    copy.data.set(source.data);
    return copy;
}
