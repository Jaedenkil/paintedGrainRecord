// @ts-check

/**
 * @fileoverview
 * 16×16 像素等轴方块纹理变换系统 - 核心编排层。
 *
 * 提供：变换缓存、管线编排（transformTopFace / batchTransformBlocks /
 * loadAndTransformBlock / batchLoadAndTransform），
 * 并重新导出所有公共符号保持向后兼容。
 *
 * 像素级运算实现在 IsoTexOperators，尺寸常量在 IsoTexConstants。
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

import { createEmptyImageData, getPixel, setPixel, sampleNearest, sampleBilinear, computeBoundingBox }
    from '../utils/ImageDataUtils.mjs';
import { SRC_SIZE, ROTATED_SIZE, TOP_HEIGHT, SIDE_WIDTH, SHEAR_OFFSET, SIDE_HEIGHT, BLOCK_WIDTH, BLOCK_HEIGHT }
    from './IsoTexConstants.mjs';
import { rotateTexture45, compressVerticalDiagonal, expandTopFaceEdges, shearToParallelogram, assembleBlock, fixEdges }
    from './IsoTexOperators.mjs';

// ==================== 纹理缓存 ====================

/** @private URL → ImageData */
const _urlImageCache = new Map();
/** @private 变换结果缓存 */
const _transformedCache = new Map();
/** @private */ let _cacheHits = 0;
/** @private */ let _cacheMisses = 0;

/**
 * 生成变换缓存的标准化键。
 * @private
 * @param {string} id
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
 * @example
 * ```js
 * import { clearTextureCache } from './IsoTextureTransformer.mjs';
 * clearTextureCache();
 * ```
 */
export function clearTextureCache() {
    _urlImageCache.clear();
    _transformedCache.clear();
    _cacheHits = 0;
    _cacheMisses = 0;
}

/**
 * 获取纹理缓存的命中/未命中统计。
 * @returns {{ hits: number, misses: number, hitRate: string, urlCacheSize: number, transformedCacheSize: number }}
 * @example
 * ```js
 * import { getTextureCacheStats } from './IsoTextureTransformer.mjs';
 * console.table(getTextureCacheStats());
 * ```
 */
export function getTextureCacheStats() {
    const total = _cacheHits + _cacheMisses;
    const hitRate = total > 0 ? ((_cacheHits / total) * 100).toFixed(1) + '%' : 'N/A';
    return { hits: _cacheHits, misses: _cacheMisses, hitRate, urlCacheSize: _urlImageCache.size, transformedCacheSize: _transformedCache.size };
}

// ==================== 顶面变换管线 ====================

/**
 * 完整的顶面等轴变换管道：rotateTexture45 → compressVerticalDiagonal → expandTopFaceEdges。
 * @param {ImageData} srcData - 16×16 正方形源纹理
 * @param {Object} [options]
 * @param {'nearest'|'bilinear'} [options.interpolation='nearest']
 * @param {boolean} [options.fixEdgeGap=true]
 * @returns {ImageData} 24×12 等轴顶面纹理
 */
export function transformTopFace(srcData, options = {}) {
    const { fixEdgeGap = true } = options;
    let topData = rotateTexture45(srcData, options);
    topData = compressVerticalDiagonal(topData);
    if (fixEdgeGap) topData = expandTopFaceEdges(topData);
    return topData;
}

// ==================== 批量变换 ====================

/**
 * 批量处理多个方块类型的纹理。
 *
 * @param {Object<string, { top: ImageData, left: ImageData, right: ImageData }>} textureMap
 *        方块类型映射表，key 为类型名，value 为三面 ImageData
 * @param {Object} [options]
 * @param {'nearest'|'bilinear'} [options.interpolation='nearest']
 * @param {boolean} [options.fixEdges=false]
 * @param {boolean} [options.includeAssembled=true]
 * @returns {Object<string, { top: ImageData, left: ImageData, right: ImageData, assembled?: ImageData }>}
 *
 * @example
 * ```js
 * const result = batchTransformBlocks({
 *   grass: { top: grassTop, left: grassLeft, right: grassRight },
 *   stone: { top: stoneTop, left: stoneLeft, right: stoneRight }
 * });
 * ```
 */
export function batchTransformBlocks(textureMap, options = {}) {
    const { interpolation = 'nearest', fixEdges: shouldFixEdges = false, includeAssembled = true } = options;
    const result = {};
    for (const [blockType, faces] of Object.entries(textureMap)) {
        const top   = transformTopFace(faces.top, { interpolation });
        const left  = shearToParallelogram(faces.left, 'left');
        const right = shearToParallelogram(faces.right, 'right');
        if (shouldFixEdges) { fixEdges(top); fixEdges(left); fixEdges(right); }
        const entry = { top, left, right };
        if (includeAssembled) entry.assembled = assembleBlock(top, left, right);
        result[blockType] = entry;
    }
    return result;
}


// ==================== 完整管道便捷函数 ====================

/**
 * 从三面 URL 异步加载并执行完整等轴变换管道。
 * @param {string} topUrl - 顶面贴图 URL
 * @param {string} leftUrl - 左面贴图 URL
 * @param {string} rightUrl - 右面贴图 URL
 * @param {Object} [options]
 * @param {'nearest'|'bilinear'} [options.interpolation='nearest']
 * @returns {Promise<{ top: ImageData, left: ImageData, right: ImageData, assembled: ImageData }>}
 */
export async function loadAndTransformBlock(topUrl, leftUrl, rightUrl, options = {}) {
    const cacheKey = _makeCacheKey(`single:${topUrl}|${leftUrl}|${rightUrl}`, options);
    if (_transformedCache.has(cacheKey)) { _cacheHits++; return _transformedCache.get(cacheKey); }
    _cacheMisses++;
    const { imageDataFromUrl } = await import('../utils/ImageDataUtils.mjs');
    const loadImage = async (url) => {
        if (_urlImageCache.has(url)) return _urlImageCache.get(url);
        const imgData = await imageDataFromUrl(url);
        _urlImageCache.set(url, imgData);
        return imgData;
    };
    const [topRaw, leftRaw, rightRaw] = await Promise.all([
        loadImage(topUrl), loadImage(leftUrl), loadImage(rightUrl)
    ]);
    const top = transformTopFace(topRaw, options);
    const left = shearToParallelogram(leftRaw, 'left');
    const right = shearToParallelogram(rightRaw, 'right');
    const assembled = assembleBlock(top, left, right);
    const result = { top, left, right, assembled };
    _transformedCache.set(cacheKey, result);
    return result;
}

/**
 * 从 BLOCK_TEXTURE_MAP 批量加载并变换所有注册的方块类型。
 * @param {Object<string, { top: string, left: string, right: string }>} blockTextureMap
 * @param {Object} [options]
 * @param {'nearest'|'bilinear'} [options.interpolation='nearest']
 * @returns {Promise<Object<string, { top: ImageData, left: ImageData, right: ImageData, assembled?: ImageData }>>}
 */
export async function batchLoadAndTransform(blockTextureMap, options = {}) {
    const { imageDataFromUrl } = await import('../utils/ImageDataUtils.mjs');
    const result = {};
    const toProcess = [];
    for (const blockType of Object.keys(blockTextureMap)) {
        const cacheKey = _makeCacheKey(blockType, options);
        if (_transformedCache.has(cacheKey)) { _cacheHits++; result[blockType] = _transformedCache.get(cacheKey); }
        else { _cacheMisses++; toProcess.push(blockType); }
    }
    if (toProcess.length > 0) {
        const rawMap = {};
        const loadPromises = toProcess.map(async (type) => {
            const paths = blockTextureMap[type];
            const loadImage = async (url) => {
                if (_urlImageCache.has(url)) return _urlImageCache.get(url);
                const imgData = await imageDataFromUrl(url);
                _urlImageCache.set(url, imgData);
                return imgData;
            };
            const [top, left, right] = await Promise.all([
                loadImage(paths.top), loadImage(paths.left), loadImage(paths.right)
            ]);
            rawMap[type] = { top, left, right };
        });
        await Promise.all(loadPromises);
        const transformed = batchTransformBlocks(rawMap, options);
        for (const type of toProcess) {
            _transformedCache.set(_makeCacheKey(type, options), transformed[type]);
            result[type] = transformed[type];
        }
    }
    return result;
}

// ==================== 重新导出（向后兼容） ====================

export { SRC_SIZE, ROTATED_SIZE, TOP_HEIGHT, SIDE_WIDTH, SHEAR_OFFSET, SIDE_HEIGHT, BLOCK_WIDTH, BLOCK_HEIGHT }
    from './IsoTexConstants.mjs';
export { rotateTexture45, compressVerticalDiagonal, expandTopFaceEdges, shearToParallelogram, assembleBlock, fixEdges }
    from './IsoTexOperators.mjs';
