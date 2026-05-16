// @ts-check

/**
 * @fileoverview
 * IsoProjection 单元测试。
 *
 * 覆盖内容：
 * - gridToScreen 正向投影（基本、相机偏移、缩放）
 * - screenToWorld 逆向投影（基本、相机偏移、缩放、round-trip）
 * - screenToGrid 整数取整（基本、round-trip）
 * - 边界情形（零缩放保护、负坐标）
 *
 * @module render/__tests__/IsoProjection.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { IsoProjection } from '../IsoProjection.mjs';

// ==================== 测试常量 ====================

/** 默认相机：原点，无缩放 */
const DEFAULT_CAMERA = { x: 0, y: 0, zoom: 1 };

/** 默认视口：960×540 */
const VIEW_W = 960;
const VIEW_H = 540;

/** 视口中心 */
const CENTER_X = VIEW_W / 2; // 480
const CENTER_Y = VIEW_H / 2; // 270

/** 等轴步进常量（与 BlockConstants 一致） */
const HW = 12; // TILE_HALF_W
const HH = 6;  // TILE_HALF_H

// ==================== 工具函数 ====================

/**
 * 对两个数值进行约等断言（容忍浮点误差）。
 * @param {number} actual
 * @param {number} expected
 * @param {string} [msg]
 */
function assertApprox(actual, expected, msg) {
    const diff = Math.abs(actual - expected);
    if (diff > 1e-10) {
        throw new assert.AssertionError({
            message: msg || `Expected ${expected} ≈ ${actual}, diff=${diff}`,
            actual,
            expected
        });
    }
}

/**
 * 对 {gx, gy} 对象进行约等断言。
 * @param {{ gx: number, gy: number }} actual
 * @param {{ gx: number, gy: number }} expected
 */
function assertGridApprox(actual, expected) {
    assertApprox(actual.gx, expected.gx, `gx mismatch: ${actual.gx} ≈ ${expected.gx}`);
    assertApprox(actual.gy, expected.gy, `gy mismatch: ${actual.gy} ≈ ${expected.gy}`);
}

// ==================== 测试 ====================

describe('IsoProjection', () => {

    // ==================== gridToScreen ====================

    describe('gridToScreen', () => {
        it('网格原点 (0,0) 应映射到视口中心', () => {
            const result = IsoProjection.gridToScreen(0, 0, DEFAULT_CAMERA, VIEW_W, VIEW_H);
            assert.strictEqual(result.x, CENTER_X);
            assert.strictEqual(result.y, CENTER_Y);
        });

        it('(1,0) 应向右下偏移 (12, 6)', () => {
            // cx = (1-0)*12 = 12,  cy = (1+0)*6 = 6
            const result = IsoProjection.gridToScreen(1, 0, DEFAULT_CAMERA, VIEW_W, VIEW_H);
            assert.strictEqual(result.x, CENTER_X + 12);
            assert.strictEqual(result.y, CENTER_Y + 6);
        });

        it('(0,1) 应向左下偏移 (-12, 6)', () => {
            // cx = (0-1)*12 = -12,  cy = (0+1)*6 = 6
            const result = IsoProjection.gridToScreen(0, 1, DEFAULT_CAMERA, VIEW_W, VIEW_H);
            assert.strictEqual(result.x, CENTER_X - 12);
            assert.strictEqual(result.y, CENTER_Y + 6);
        });

        it('(3,5) 应正确投影', () => {
            // cx = (3-5)*12 = -24,  cy = (3+5)*6 = 48
            const result = IsoProjection.gridToScreen(3, 5, DEFAULT_CAMERA, VIEW_W, VIEW_H);
            assert.strictEqual(result.x, CENTER_X - 24);
            assert.strictEqual(result.y, CENTER_Y + 48);
        });

        it('应正确处理负网格坐标', () => {
            // cx = (-2 - -3)*12 = 12,  cy = (-2 + -3)*6 = -30
            const result = IsoProjection.gridToScreen(-2, -3, DEFAULT_CAMERA, VIEW_W, VIEW_H);
            assert.strictEqual(result.x, CENTER_X + 12);
            assert.strictEqual(result.y, CENTER_Y - 30);
        });

        it('应应用相机偏移', () => {
            const camera = { x: 100, y: 50, zoom: 1 };
            // cx = (0-0)*12 = 0,  cy = (0+0)*6 = 0
            // screenX = 480 + (0 - 100)*1 = 380
            // screenY = 270 + (0 - 50)*1 = 220
            const result = IsoProjection.gridToScreen(0, 0, camera, VIEW_W, VIEW_H);
            assert.strictEqual(result.x, CENTER_X - 100);
            assert.strictEqual(result.y, CENTER_Y - 50);
        });

        it('应应用缩放', () => {
            const camera = { x: 0, y: 0, zoom: 2 };
            // cx = (0-0)*12 = 0,  cy = (0+0)*6 = 0 → screen = center
            const origin = IsoProjection.gridToScreen(0, 0, camera, VIEW_W, VIEW_H);
            assert.strictEqual(origin.x, CENTER_X);
            assert.strictEqual(origin.y, CENTER_Y);

            // cx = (1-0)*12 = 12,  cy = (1+0)*6 = 6
            // screenX = 480 + (12 - 0)*2 = 504
            // screenY = 270 + (6 - 0)*2 = 282
            const moved = IsoProjection.gridToScreen(1, 0, camera, VIEW_W, VIEW_H);
            assert.strictEqual(moved.x, CENTER_X + 24);
            assert.strictEqual(moved.y, CENTER_Y + 12);
        });

        it('相机偏移 + 缩放组合', () => {
            const camera = { x: 50, y: 30, zoom: 1.5 };
            // cx = (2-3)*12 = -12,  cy = (2+3)*6 = 30
            // screenX = 480 + (-12 - 50)*1.5 = 480 - 93 = 387
            // screenY = 270 + (30 - 30)*1.5 = 270
            const result = IsoProjection.gridToScreen(2, 3, camera, VIEW_W, VIEW_H);
            assert.strictEqual(result.x, CENTER_X + (-12 - 50) * 1.5);
            assert.strictEqual(result.y, CENTER_Y + (30 - 30) * 1.5);
        });
    });

    // ==================== screenToWorld ====================

    describe('screenToWorld', () => {
        it('视口中心应反算为网格原点', () => {
            const result = IsoProjection.screenToWorld(CENTER_X, CENTER_Y, DEFAULT_CAMERA, VIEW_W, VIEW_H);
            assertGridApprox(result, { gx: 0, gy: 0 });
        });

        it('屏幕 (492, 276) 应反算为 (1, 0)', () => {
            // (1,0) → cx=12, cy=6 → screen (492, 276)
            const result = IsoProjection.screenToWorld(CENTER_X + 12, CENTER_Y + 6, DEFAULT_CAMERA, VIEW_W, VIEW_H);
            assertGridApprox(result, { gx: 1, gy: 0 });
        });

        it('屏幕 (468, 276) 应反算为 (0, 1)', () => {
            // (0,1) → cx=-12, cy=6 → screen (468, 276)
            const result = IsoProjection.screenToWorld(CENTER_X - 12, CENTER_Y + 6, DEFAULT_CAMERA, VIEW_W, VIEW_H);
            assertGridApprox(result, { gx: 0, gy: 1 });
        });

        it('应正确处理相机偏移', () => {
            const camera = { x: 100, y: 50, zoom: 1 };
            // (0,0) → cx=0, cy=0, camera=(100,50) → screen (380, 220)
            // 反算应回到 (0,0)
            const result = IsoProjection.screenToWorld(CENTER_X - 100, CENTER_Y - 50, camera, VIEW_W, VIEW_H);
            assertGridApprox(result, { gx: 0, gy: 0 });
        });

        it('应正确处理缩放', () => {
            const camera = { x: 0, y: 0, zoom: 2 };
            // (1,0) → cx=12, cy=6, zoom=2 → screen (504, 282)
            const result = IsoProjection.screenToWorld(CENTER_X + 24, CENTER_Y + 12, camera, VIEW_W, VIEW_H);
            assertGridApprox(result, { gx: 1, gy: 0 });
        });

        it('round-trip 测试：gridToScreen → screenToWorld 应还原', () => {
            const testCases = [
                { gx: 0, gy: 0 },
                { gx: 5, gy: -3 },
                { gx: -10, gy: 7 },
                { gx: 100, gy: 200 }
            ];

            const cameras = [
                { x: 0, y: 0, zoom: 1 },
                { x: 123, y: 456, zoom: 1 },
                { x: -50, y: 100, zoom: 2 },
                { x: 200, y: -300, zoom: 0.5 }
            ];

            for (const camera of cameras) {
                for (const { gx, gy } of testCases) {
                    const screen = IsoProjection.gridToScreen(gx, gy, camera, VIEW_W, VIEW_H);
                    const world = IsoProjection.screenToWorld(screen.x, screen.y, camera, VIEW_W, VIEW_H);
                    assertGridApprox(world, { gx, gy });
                }
            }
        });
    });

    // ==================== screenToGrid ====================

    describe('screenToGrid', () => {
        it('视口中心应取整为 (0, 0)', () => {
            const result = IsoProjection.screenToGrid(CENTER_X, CENTER_Y, DEFAULT_CAMERA, VIEW_W, VIEW_H);
            assert.strictEqual(result.gx, 0);
            assert.strictEqual(result.gy, 0);
        });

        it('screenToWorld 的浮点值应被正确取整', () => {
            // (1.2, 0.7) → Math.round → (1, 1)
            const camera = { x: 0, y: 0, zoom: 1 };
            // 找到对应 (1.2, 0.7) 的屏幕位置
            // worldX = (1.2 - 0.7)*12 = 6,  worldY = (1.2 + 0.7)*6 = 11.4
            // screenX = 480 + 6 = 486,  screenY = 270 + 11.4 = 281.4
            const screenX = CENTER_X + (1.2 - 0.7) * HW;
            const screenY = CENTER_Y + (1.2 + 0.7) * HH;
            const result = IsoProjection.screenToGrid(screenX, screenY, camera, VIEW_W, VIEW_H);
            assert.strictEqual(result.gx, Math.round(1.2));
            assert.strictEqual(result.gy, Math.round(0.7));
        });

        it('round-trip 测试：gridToScreen → screenToGrid 取整后应与原值一致', () => {
            const testCases = [
                { gx: 0, gy: 0 },
                { gx: 3, gy: 5 },
                { gx: -2, gy: 4 },
                { gx: 10, gy: -7 }
            ];

            for (const { gx, gy } of testCases) {
                const screen = IsoProjection.gridToScreen(gx, gy, DEFAULT_CAMERA, VIEW_W, VIEW_H);
                const grid = IsoProjection.screenToGrid(screen.x, screen.y, DEFAULT_CAMERA, VIEW_W, VIEW_H);
                assert.strictEqual(grid.gx, gx);
                assert.strictEqual(grid.gy, gy);
            }
        });
    });

    // ==================== 边缘情形 ====================

    describe('边缘情形', () => {
        it('zoom=0 不应抛出（但结果可能为 Infinity）', () => {
            const camera = { x: 0, y: 0, zoom: 0 };
            // 除以 0 在 JS 中返回 Infinity，不会抛出
            assert.doesNotThrow(() => {
                IsoProjection.screenToWorld(CENTER_X, CENTER_Y, camera, VIEW_W, VIEW_H);
            });
        });

        it('巨大缩放值应稳定', () => {
            const camera = { x: 0, y: 0, zoom: 1000 };
            assert.doesNotThrow(() => {
                IsoProjection.gridToScreen(0, 0, camera, VIEW_W, VIEW_H);
                IsoProjection.screenToWorld(CENTER_X, CENTER_Y, camera, VIEW_W, VIEW_H);
            });
        });

        it('不同视口尺寸应正确工作', () => {
            const narrowView = { w: 640, h: 360 };
            const result = IsoProjection.gridToScreen(0, 0, DEFAULT_CAMERA, narrowView.w, narrowView.h);
            assert.strictEqual(result.x, narrowView.w / 2);
            assert.strictEqual(result.y, narrowView.h / 2);
        });
    });
});
