// @ts-check

/**
 * @fileoverview
 * IsoTextureTransformer 单元测试
 *
 * 覆盖内容：
 * - expandTopFaceEdges 边缘填充逻辑
 * - 尺寸不变性
 * - 边缘像素复制正确性
 * - 小尺寸输入的保护
 * - 幂等性
 *
 * @module loader/__tests__/IsoTextureTransformer.test
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * 创建一个指定尺寸的测试 ImageData。
 * 默认所有像素不透明（alpha=255），便于验证边缘填充行为。
 *
 * @param {number} w - 宽度
 * @param {number} h - 高度
 * @param {number} [alpha=255] - 默认 alpha 值
 * @returns {ImageData}
 */
function makeTestImageData(w, h, alpha = 255) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        const offset = i * 4;
        data[offset]     = 128; // R
        data[offset + 1] = 128; // G
        data[offset + 2] = 128; // B
        data[offset + 3] = alpha;
    }
    return {
        width: w,
        height: h,
        data,
        colorSpace: 'srgb'
    };
}

describe('IsoTextureTransformer - expandTopFaceEdges', () => {
    let expandTopFaceEdges;

    before(async () => {
        const mod = await import('../IsoTextureTransformer.mjs');
        expandTopFaceEdges = mod.expandTopFaceEdges;
    });

    it('应保持 24×12 纹理的尺寸不变', () => {
        const input = makeTestImageData(24, 12);
        const result = expandTopFaceEdges(input);

        assert.strictEqual(result.width, 24);
        assert.strictEqual(result.height, 12);
    });

    it('应将第 0-1 列填充为第 2 列的值（左侧扩展 2px）', () => {
        const w = 24, h = 12;
        const input = makeTestImageData(w, h);

        // 将第 0-1 列设为透明以模拟菱形边缘
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < 2; x++) {
                const idx = (y * w + x) * 4;
                input.data[idx + 3] = 0; // alpha = 0
            }
        }

        const result = expandTopFaceEdges(input);

        for (let y = 0; y < h; y++) {
            const col0Idx = (y * w + 0) * 4;
            const col1Idx = (y * w + 1) * 4;
            const col2Idx = (y * w + 2) * 4;

            // 第 0 列和第 1 列的 RGBA 应与第 2 列完全相同
            for (let ch = 0; ch < 4; ch++) {
                assert.strictEqual(result.data[col0Idx + ch], result.data[col2Idx + ch], `ch=${ch} row=${y} col=0`);
                assert.strictEqual(result.data[col1Idx + ch], result.data[col2Idx + ch], `ch=${ch} row=${y} col=1`);
            }
        }
    });

    it('应将第 22-23 列填充为第 21 列的值（右侧扩展 2px）', () => {
        const w = 24, h = 12;
        const input = makeTestImageData(w, h);

        // 将第 22-23 列设为透明
        for (let y = 0; y < h; y++) {
            for (let x = 22; x < 24; x++) {
                const idx = (y * w + x) * 4;
                input.data[idx + 3] = 0;
            }
        }

        const result = expandTopFaceEdges(input);

        for (let y = 0; y < h; y++) {
            const col22Idx = (y * w + 22) * 4;
            const col23Idx = (y * w + 23) * 4;
            const col21Idx = (y * w + 21) * 4;

            for (let ch = 0; ch < 4; ch++) {
                assert.strictEqual(result.data[col22Idx + ch], result.data[col21Idx + ch], `ch=${ch} row=${y} col=22`);
                assert.strictEqual(result.data[col23Idx + ch], result.data[col21Idx + ch], `ch=${ch} row=${y} col=23`);
            }
        }
    });

    it('宽度小于 5 时直接返回输入，不修改', () => {
        const input = makeTestImageData(4, 12);
        const inputData = new Uint8ClampedArray(input.data);
        const result = expandTopFaceEdges(input);

        assert.strictEqual(result, input); // 同一引用
        assert.deepStrictEqual(result.data, inputData); // 内容不变
    });

    it('幂等性：多次调用结果不变', () => {
        const input = makeTestImageData(24, 12);

        // 第一次调用
        const first = expandTopFaceEdges(input);
        // 记录第一次调用后第 0 列和第 23 列的值
        const col0Before = new Uint8ClampedArray(4);
        const col23Before  = new Uint8ClampedArray(4);
        for (let i = 0; i < 4; i++) {
            col0Before[i]  = first.data[0 * 4 + i];
            col23Before[i] = first.data[23 * 4 + i];
        }

        // 第二次调用
        const second = expandTopFaceEdges(first);

        // 验证两次调用的第 0 列和第 23 列一致
        for (let i = 0; i < 4; i++) {
            assert.strictEqual(second.data[0 * 4 + i],  col0Before[i]);
            assert.strictEqual(second.data[23 * 4 + i], col23Before[i]);
        }
    });

});
