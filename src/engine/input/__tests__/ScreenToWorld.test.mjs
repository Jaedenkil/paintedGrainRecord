// @ts-check

/**
 * @fileoverview ScreenToWorld 单元测试。
 *
 * 测试策略：
 * - 使用 mock 相机模拟不同状态（位置、缩放、视口）
 * - screenToGrid：验证已知坐标的正变换→逆变换一致性
 * - screenToGridRounded：验证取整行为
 * - screenToChunk：验证 Chunk 坐标映射
 * - getFace：验证顶/左/右面的判定准确性
 *
 * @module input/__tests__/ScreenToWorld
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ScreenToWorld } from '../ScreenToWorld.mjs';

// ==================== Mock 相机工厂 ====================

/**
 * 创建一个 Mock 相机。
 * @param {Object} overrides
 * @returns {{ x:number, y:number, zoom:number, viewWidth:number, viewHeight:number }}
 */
function mockCamera(overrides = {}) {
    return {
        x: overrides.x ?? 0,
        y: overrides.y ?? 0,
        zoom: overrides.zoom ?? 1,
        viewWidth: overrides.viewWidth ?? 960,
        viewHeight: overrides.viewHeight ?? 540
    };
}

/**
 * 验证两个浮点数在容差范围内相等。
 * @param {number} actual
 * @param {number} expected
 * @param {number} [tol=0.01]
 */
function assertApprox(actual, expected, tol = 0.01) {
    if (Math.abs(actual - expected) > tol) {
        throw new assert.AssertionError({
            message: `Expected ${expected} ± ${tol}, got ${actual}`,
            actual,
            expected
        });
    }
}

// ==================== 测试套件 ====================

describe('ScreenToWorld', () => {

    // ──────────── screenToGrid ────────────

    describe('screenToGrid()', () => {

        it('相机在原点、zoom=1 时，屏幕中心映射到网格原点', () => {
            const stw = new ScreenToWorld(mockCamera());
            const { gx, gy } = stw.screenToGrid(480, 270);
            assertApprox(gx, 0);
            assertApprox(gy, 0);
        });

        it('正确映射已知网格坐标 (5, 3) 的正逆变换', () => {
            const stw = new ScreenToWorld(mockCamera());
            // 正变换：grid(5,3) → screen(504, 318)
            // worldX = (5-3)*12 = 24, worldY = (5+3)*6 = 48
            // screenX = 480 + 24 = 504, screenY = 270 + 48 = 318
            const { gx, gy } = stw.screenToGrid(504, 318);
            assertApprox(gx, 5);
            assertApprox(gy, 3);
        });

        it('正确映射负数网格坐标 (-3, -7)', () => {
            const stw = new ScreenToWorld(mockCamera());
            // 正变换：grid(-3,-7) → screen
            // worldX = (-3-(-7))*12 = 48
            // worldY = (-3+(-7))*6 = -60
            // screenX = 480 + 48 = 528
            // screenY = 270 + (-60) = 210
            const { gx, gy } = stw.screenToGrid(528, 210);
            assertApprox(gx, -3);
            assertApprox(gy, -7);
        });

        it('相机偏移后正确逆变换', () => {
            // 相机看向 (50, 30)，网格原点应偏移
            const stw = new ScreenToWorld(mockCamera({ x: 50, y: 30 }));
            // 屏幕中心对应相机目标点，即世界坐标 (50, 30)
            // 世界 (50, 30) 的网格坐标：
            // gx = (50/12 + 30/6)/2 = (4.167 + 5)/2 = 4.583
            // gy = (30/6 - 50/12)/2 = (5 - 4.167)/2 = 0.417
            const { gx, gy } = stw.screenToGrid(480, 270);
            assertApprox(gx, 4.583, 0.01);
            assertApprox(gy, 0.417, 0.01);
        });

        it('zoom=2 时正确缩放逆变换', () => {
            const stw = new ScreenToWorld(mockCamera({ zoom: 2 }));
            // zoom=2 时，屏幕中心仍对应网格原点
            const { gx, gy } = stw.screenToGrid(480, 270);
            assertApprox(gx, 0);
            assertApprox(gy, 0);
        });

        it('zoom=2 时像素偏移量减半', () => {
            const stw = new ScreenToWorld(mockCamera({ zoom: 2 }));
            // 屏幕点 (504, 318) 在 zoom=2 时：
            // worldX = (504-480)/2 = 12, worldY = (318-270)/2 = 24
            // gx = (12/12 + 24/6)/2 = (1+4)/2 = 2.5
            // gy = (24/6 - 12/12)/2 = (4-1)/2 = 1.5
            const { gx, gy } = stw.screenToGrid(504, 318);
            assertApprox(gx, 2.5);
            assertApprox(gy, 1.5);
        });

        it('非标准视口尺寸正确计算', () => {
            const stw = new ScreenToWorld(mockCamera({ viewWidth: 800, viewHeight: 600 }));
            // 中心点 (400, 300) → 网格原点
            const { gx, gy } = stw.screenToGrid(400, 300);
            assertApprox(gx, 0);
            assertApprox(gy, 0);
        });
    });

    // ──────────── screenToGridRounded ────────────

    describe('screenToGridRounded()', () => {

        it('返回整数网格坐标', () => {
            const stw = new ScreenToWorld(mockCamera());
            const { gx, gy } = stw.screenToGridRounded(504, 318);
            assert.strictEqual(gx, 5);
            assert.strictEqual(gy, 3);
        });

        it('屏幕中心取整为 (0, 0)', () => {
            const stw = new ScreenToWorld(mockCamera());
            const { gx, gy } = stw.screenToGridRounded(480, 270);
            assert.strictEqual(gx, 0);
            assert.strictEqual(gy, 0);
        });

        it('边界值正确取整（靠近格点边界）', () => {
            const stw = new ScreenToWorld(mockCamera());
            // 靠近 (1, 0) 的点
            // worldX = (1-0)*12 = 12, worldY = (1+0)*6 = 6
            // screenX = 480+12=492, screenY = 270+6=276
            // 稍微偏移使其落在 (1,0) 格
            const { gx, gy } = stw.screenToGridRounded(493, 277);
            assert.strictEqual(gx, 1);
            assert.strictEqual(gy, 0);
        });
    });

    // ──────────── screenToChunk ────────────

    describe('screenToChunk()', () => {

        it('网格原点映射到 Chunk (0,0) 局部 (0,0)', () => {
            const stw = new ScreenToWorld(mockCamera());
            const result = stw.screenToChunk(480, 270);
            assert.strictEqual(result.cx, 0);
            assert.strictEqual(result.cy, 0);
            assert.strictEqual(result.localGx, 0);
            assert.strictEqual(result.localGy, 0);
        });

        it('网格 (16, 0) 映射到 Chunk (1, 0) 局部 (0, 0)', () => {
            const stw = new ScreenToWorld(mockCamera());
            // grid(16, 0):
            // worldX = 16*12 = 192, worldY = 16*6 = 96
            // screenX = 480+192=672, screenY = 270+96=366
            const result = stw.screenToChunk(672, 366);
            assert.strictEqual(result.cx, 1);
            assert.strictEqual(result.cy, 0);
            assert.strictEqual(result.localGx, 0);
            assert.strictEqual(result.localGy, 0);
        });

        it('负数网格映射到负 Chunk 坐标', () => {
            const stw = new ScreenToWorld(mockCamera());
            // grid(-1, -1):
            // worldX = 0, worldY = -12
            // screenX = 480, screenY = 270+(-12) = 258
            const result = stw.screenToChunk(480, 258);
            assert.strictEqual(result.cx, -1);
            assert.strictEqual(result.cy, -1);
            assert.strictEqual(result.localGx, 15);
            assert.strictEqual(result.localGy, 15);
        });

        it('网格 (5, 3) 映射到 Chunk (0,0) 局部 (5, 3)', () => {
            const stw = new ScreenToWorld(mockCamera());
            const result = stw.screenToChunk(504, 318);
            assert.strictEqual(result.cx, 0);
            assert.strictEqual(result.cy, 0);
            assert.strictEqual(result.localGx, 5);
            assert.strictEqual(result.localGy, 3);
        });
    });

    // ──────────── getFace ────────────

    describe('getFace()', () => {

        it('点击方块中心区域返回 top（顶面）', () => {
            const stw = new ScreenToWorld(mockCamera());
            // block(0,0,0) 屏幕中心 (480, 270)
            // 点击 (480, 264) —— 顶面上方略微偏移
            const face = stw.getFace(480, 264, 0, 0, 0);
            assert.strictEqual(face, 'top');
        });

        it('点击方块左侧区域返回 left（左面）', () => {
            const stw = new ScreenToWorld(mockCamera());
            // block(0,0,0) 屏幕中心 (480, 270)
            // 点击 (465, 282) —— 菱形左侧下方
            const face = stw.getFace(465, 282, 0, 0, 0);
            assert.strictEqual(face, 'left');
        });

        it('点击方块右侧区域返回 right（右面）', () => {
            const stw = new ScreenToWorld(mockCamera());
            // block(0,0,0) 屏幕中心 (480, 270)
            // 点击 (495, 282) —— 菱形右侧下方
            const face = stw.getFace(495, 282, 0, 0, 0);
            assert.strictEqual(face, 'right');
        });

        it('方块偏移后面方向判定仍正确', () => {
            const stw = new ScreenToWorld(mockCamera());
            // block(5, 3, 1) 的屏幕位置：
            // worldX = (5-3)*12 = 24
            // worldY = (5+3)*6 - 1*16 = 48-16 = 32
            // screenX = 480+24 = 504
            // screenY = 270+32 = 302
            // 点击顶面：在 (504, 296) —— 中心上方
            const face = stw.getFace(504, 296, 5, 3, 1);
            assert.strictEqual(face, 'top');
        });

        it('缩放后 face 判定仍正确', () => {
            const stw = new ScreenToWorld(mockCamera({ zoom: 2 }));
            // block(0,0,0) 屏幕中心 (480, 270)
            // zoom=2, 偏移 32px → 等轴空间偏移 16px
            // localX = 16, localY = 0
            // |16/12| + |0| = 1.333 > 1.15 → 非顶面
            // localX = 16 > 0 → 'right'
            const face = stw.getFace(512, 270, 0, 0, 0);
            assert.strictEqual(face, 'right');
        });

        it('菱形边界附近的点判定为 top', () => {
            const stw = new ScreenToWorld(mockCamera());
            // block(0,0,0) 中心 (480, 270)
            // 菱形边界：|nx|+|ny| = 1
            // nx = 11/12 = 0.917, ny = 5/6 = 0.833
            // sum = 1.75 > 1.15 → 不是 top
            // 使用边界内的点：nx=6/12=0.5, ny=3/6=0.5, sum=1.0 ≤ 1.15 → top
            const face = stw.getFace(486, 273, 0, 0, 0);
            assert.strictEqual(face, 'top');
        });

        it('位于菱形正下方远处返回 left/right', () => {
            const stw = new ScreenToWorld(mockCamera());
            // 正下方远处，x 居中
            const face = stw.getFace(480, 300, 0, 0, 0);
            // localX = 0 → 不 < 0，所以是 right
            assert.strictEqual(face, 'right');
        });

        it('相机偏移后 face 判定仍正确', () => {
            const stw = new ScreenToWorld(mockCamera({ x: 20, y: 10 }));
            // block(0,0,0) 屏幕位置：
            // worldX = 0, worldY = 0
            // screenX = 480 + (0-20)*1 = 460
            // screenY = 270 + (0-10)*1 = 260
            // 点击 (460, 254) —— 顶面
            const face = stw.getFace(460, 254, 0, 0, 0);
            assert.strictEqual(face, 'top');
        });
    });

    // ──────────── 双向一致性 ────────────

    describe('正逆变换一致性', () => {

        it('gridToScreen 后再 screenToGrid 还原', () => {
            const stw = new ScreenToWorld(mockCamera());
            const testPoints = [
                [0, 0], [5, 3], [-3, -7], [10, -4], [-8, 12]
            ];

            for (const [gxIn, gyIn] of testPoints) {
                // 手动计算正变换（同 IsoProjection.gridToScreen）
                const worldX = (gxIn - gyIn) * 12;
                const worldY = (gxIn + gyIn) * 6;
                const sx = 480 + worldX;
                const sy = 270 + worldY;

                // 逆变换
                const { gx, gy } = stw.screenToGrid(sx, sy);
                assertApprox(gx, gxIn, 0.001);
                assertApprox(gy, gyIn, 0.001);
            }
        });

        it('相机偏移后仍保持双向一致性', () => {
            const stw = new ScreenToWorld(mockCamera({ x: 100, y: -50, zoom: 1.5 }));
            const testPoints = [
                [0, 0], [3, 7], [-5, -2]
            ];

            for (const [gxIn, gyIn] of testPoints) {
                const worldX = (gxIn - gyIn) * 12;
                const worldY = (gxIn + gyIn) * 6;
                const sx = 480 + (worldX - 100) * 1.5;
                const sy = 270 + (worldY - (-50)) * 1.5;

                const { gx, gy } = stw.screenToGrid(sx, sy);
                assertApprox(gx, gxIn, 0.001);
                assertApprox(gy, gyIn, 0.001);
            }
        });
    });
});
