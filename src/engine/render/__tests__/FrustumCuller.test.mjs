// @ts-check

/**
 * @fileoverview
 * FrustumCuller 单元测试。
 *
 * 覆盖内容：
 * - getVisibleGridBounds 基本计算（相机在原点，zoom=1）
 * - getVisibleGridBounds 相机偏移（平移后可见范围变化）
 * - getVisibleGridBounds 缩放（zoom=2 时可见范围缩小）
 * - isInBounds 边界内/外判定
 * - boundsEqual 相等性比较
 * - 边界包含性（含边界的方块应可见）
 * - Round-trip：可见范围内的方块经过投影后应落在视口附近
 *
 * @module render/__tests__/FrustumCuller.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FrustumCuller } from '../block/FrustumCuller.mjs';
import { TILE_HALF_W, TILE_HALF_H } from '../block/BlockConstants.mjs';

// ==================== 测试常量 ====================

/** 默认视口尺寸（同 RenderSystem 默认值） */
const VIEW_W = 960;
const VIEW_H = 540;

/**
 * 相机快照工厂。
 * @param {number} x
 * @param {number} y
 * @param {number} zoom
 * @param {number} [vw=VIEW_W]
 * @param {number} [vh=VIEW_H]
 * @returns {{ x: number, y: number, zoom: number, viewWidth: number, viewHeight: number }}
 */
function cam(x = 0, y = 0, zoom = 1, vw = VIEW_W, vh = VIEW_H) {
    return { x, y, zoom, viewWidth: vw, viewHeight: vh };
}

// ==================== 测试套件 ====================

describe('FrustumCuller', () => {

    describe('getVisibleGridBounds', () => {

        it('相机在原点时返回对称的可见范围', () => {
            const bounds = FrustumCuller.getVisibleGridBounds(cam(0, 0, 1));

            // 相机在原点时，等轴投影的 gx/gy 范围对称（菱形旋转 45° 的特性）
            // 因此 gx 范围 == gy 范围
            const gxRange = bounds.maxGx - bounds.minGx;
            const gyRange = bounds.maxGy - bounds.minGy;
            assert.equal(gxRange, gyRange,
                `gx 范围(${gxRange})应等于 gy 范围(${gyRange})`);

            // 验证中心对称
            assert.equal(bounds.minGx + bounds.maxGx, 0, 'gx 应对称于 0');
            assert.equal(bounds.minGy + bounds.maxGy, 0, 'gy 应对称于 0');

            // 验证外扩 1 格容差后，范围是整数
            // 注：使用 Number.isInteger 避免 -0 !== 0 的 JS 陷阱
            assert.ok(Number.isInteger(bounds.minGx), 'minGx 应为整数');
            assert.ok(Number.isInteger(bounds.maxGx), 'maxGx 应为整数');
            assert.ok(Number.isInteger(bounds.minGy), 'minGy 应为整数');
            assert.ok(Number.isInteger(bounds.maxGy), 'maxGy 应为整数');
        });

        it('相机向右偏移后可见范围也右移', () => {
            const originBounds = FrustumCuller.getVisibleGridBounds(cam(0, 0, 1));
            const shiftedBounds = FrustumCuller.getVisibleGridBounds(cam(480, 0, 1)); // 右移 480px

            // 等轴投影中水平移动会同时影响 gx 和 gy（菱形旋转 45° 的特性）
            // gx 整体增大（右移）
            assert.ok(shiftedBounds.minGx > originBounds.minGx,
                `偏移后 minGx(${shiftedBounds.minGx}) > 原点 minGx(${originBounds.minGx})`);
            assert.ok(shiftedBounds.maxGx > originBounds.maxGx,
                `偏移后 maxGx(${shiftedBounds.maxGx}) > 原点 maxGx(${originBounds.maxGx})`);

            // gy 整体减小（等轴投影中水平右移导致 gy 减少）
            assert.ok(shiftedBounds.minGy < originBounds.minGy,
                `偏移后 minGy(${shiftedBounds.minGy}) < 原点 minGy(${originBounds.minGy})`);
            assert.ok(shiftedBounds.maxGy < originBounds.maxGy,
                `偏移后 maxGy(${shiftedBounds.maxGy}) < 原点 maxGy(${originBounds.maxGy})`);

            // 但 giz 范围宽度应保持不变
            const originGxRange = originBounds.maxGx - originBounds.minGx;
            const shiftedGxRange = shiftedBounds.maxGx - shiftedBounds.minGx;
            const originGyRange = originBounds.maxGy - originBounds.minGy;
            const shiftedGyRange = shiftedBounds.maxGy - shiftedBounds.minGy;
            assert.equal(shiftedGxRange, originGxRange, 'gx 范围宽度应不变');
            assert.equal(shiftedGyRange, originGyRange, 'gy 范围宽度应不变');
        });

        it('放大后可见范围缩小（zoom=2 时范围约为 zoom=1 时的一半）', () => {
            const zoom1 = FrustumCuller.getVisibleGridBounds(cam(0, 0, 1));
            const zoom2 = FrustumCuller.getVisibleGridBounds(cam(0, 0, 2));

            // 2x 缩放下可见范围约为 1x 的一半
            const range1 = zoom1.maxGx - zoom1.minGx;
            const range2 = zoom2.maxGx - zoom2.minGx;

            // 允许 ±4 格误差（取整 + 外扩 1 格导致累积误差）
            assert.ok(Math.abs(range1 - range2 * 2) <= 4,
                `zoom=1 范围(${range1}) ≈ 2× zoom=2 范围(${range2})`);
        });

        it('缩小后可见范围增大（zoom=0.5 时范围约为 zoom=1 时的 2 倍）', () => {
            const zoom1 = FrustumCuller.getVisibleGridBounds(cam(0, 0, 1));
            const zoom05 = FrustumCuller.getVisibleGridBounds(cam(0, 0, 0.5));

            const range1 = zoom1.maxGx - zoom1.minGx;
            const range05 = zoom05.maxGx - zoom05.minGx;

            // 0.5x 缩放下可见范围约为 1x 的 2 倍
            assert.ok(Math.abs(range05 - range1 * 2) <= 4,
                `zoom=0.5 范围(${range05}) ≈ 2× zoom=1 范围(${range1})`);
        });

        it('窄视口返回更小的可见范围', () => {
            const wide = FrustumCuller.getVisibleGridBounds(cam(0, 0, 1, 960, 540));
            const narrow = FrustumCuller.getVisibleGridBounds(cam(0, 0, 1, 480, 270));

            assert.ok(narrow.maxGx - narrow.minGx < wide.maxGx - wide.minGx,
                '窄视口的水平范围应更小');
            assert.ok(narrow.maxGy - narrow.minGy < wide.maxGy - wide.minGy,
                '窄视口的垂直范围应更小');
        });

        it('边界外扩 1 格确保部分可见方块不被裁剪', () => {
            // 相机在原点，zoom=1
            const bounds = FrustumCuller.getVisibleGridBounds(cam(0, 0, 1));

            // 在范围边界的下一个格应刚好被排除
            const justInsideGx = bounds.maxGx;
            const justInsideGy = bounds.maxGy;
            const justOutsideGx = bounds.maxGx + 1;
            const justOutsideGy = bounds.maxGy + 1;

            assert.ok(FrustumCuller.isInBounds(justInsideGx, justInsideGy, bounds),
                '边界上的格应可见');
            assert.ok(!FrustumCuller.isInBounds(justOutsideGx, justOutsideGy, bounds),
                '边界外 1 格应不可见');
        });

        it('Round-trip：可见范围内的网格点应能投影回视口附近', () => {
            const camera = cam(288, 144, 1.5); // 非原点 + 非整数缩放
            const bounds = FrustumCuller.getVisibleGridBounds(camera);

            // 选取范围内一个采样点
            const sampleGx = Math.round((bounds.minGx + bounds.maxGx) / 2);
            const sampleGy = Math.round((bounds.minGy + bounds.maxGy) / 2);

            // 正向投影到屏幕坐标
            const worldX = (sampleGx - sampleGy) * TILE_HALF_W;
            const worldY = (sampleGx + sampleGy) * TILE_HALF_H;

            const halfW = camera.viewWidth / 2;
            const halfH = camera.viewHeight / 2;
            const screenX = halfW + (worldX - camera.x) * camera.zoom;
            const screenY = halfH + (worldY - camera.y) * camera.zoom;

            // 应在视口内（允许少量偏差）
            assert.ok(screenX >= -TILE_HALF_W * 2 && screenX <= camera.viewWidth + TILE_HALF_W * 2,
                `screenX(${screenX}) 应接近视口 [0, ${camera.viewWidth}]`);
            assert.ok(screenY >= -TILE_HALF_H * 2 && screenY <= camera.viewHeight + TILE_HALF_H * 2,
                `screenY(${screenY}) 应接近视口 [0, ${camera.viewHeight}]`);
        });
    });

    describe('isInBounds', () => {

        /** @type {import('../block/FrustumCuller.mjs').VisibleGridBounds} */
        const bounds = { minGx: -10, maxGx: 20, minGy: -5, maxGy: 30 };

        it('范围内的坐标返回 true', () => {
            assert.equal(FrustumCuller.isInBounds(0, 0, bounds), true);
            assert.equal(FrustumCuller.isInBounds(10, 15, bounds), true);
            assert.equal(FrustumCuller.isInBounds(-5, 20, bounds), true);
        });

        it('范围外的坐标返回 false', () => {
            assert.equal(FrustumCuller.isInBounds(-11, 0, bounds), false); // gx 太小
            assert.equal(FrustumCuller.isInBounds(21, 0, bounds), false);  // gx 太大
            assert.equal(FrustumCuller.isInBounds(0, -6, bounds), false);  // gy 太小
            assert.equal(FrustumCuller.isInBounds(0, 31, bounds), false);  // gy 太大
        });

        it('边界上的坐标返回 true（含边界）', () => {
            assert.equal(FrustumCuller.isInBounds(-10, -5, bounds), true); // min
            assert.equal(FrustumCuller.isInBounds(20, 30, bounds), true);  // max
        });
    
        describe('getDeltaRegions', () => {
    
            /** @type {import('../block/FrustumCuller.mjs').VisibleGridBounds} */
            const BASE = { minGx: 0, maxGx: 10, minGy: 0, maxGy: 10 };
    
            // ── 辅助：统计矩形区域的总面积 ──
            /**
             * @param {import('../block/FrustumCuller.mjs').GridRect[]} rects
             * @returns {number}
             */
            function rectArea(rects) {
                return rects.reduce((sum, r) => sum + (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1), 0);
            }
    
            it('null oldBounds 时全部为新可见', () => {
                const { newlyVisible, newlyHidden } = FrustumCuller.getDeltaRegions(null, BASE);
    
                assert.equal(newlyHidden.length, 0, '首次裁剪不应有新隐藏');
                assert.equal(newlyVisible.length, 1, '应包含 1 个完整区域');
                assert.equal(newlyVisible[0].minX, BASE.minGx);
                assert.equal(newlyVisible[0].maxX, BASE.maxGx);
                assert.equal(newlyVisible[0].minY, BASE.minGy);
                assert.equal(newlyVisible[0].maxY, BASE.maxGy);
            });
    
            it('相同 bounds 返回空差值（交集 = 全量）', () => {
                const { newlyVisible, newlyHidden } = FrustumCuller.getDeltaRegions(BASE, BASE);
    
                assert.equal(newlyVisible.length, 0, '相同范围不应有新可见');
                assert.equal(newlyHidden.length, 0, '相同范围不应有新隐藏');
            });
    
            it('向右扩展：右侧条新可见，左侧条新隐藏', () => {
                const NEW = { minGx: -5, maxGx: 15, minGy: 0, maxGy: 10 };
                const { newlyVisible, newlyHidden } = FrustumCuller.getDeltaRegions(BASE, NEW);
    
                // 新可见：B 中不在 A 的部分 → 左侧 [-5,-1] + 右侧 [11,15]
                // 新隐藏：A 中不在 B 的部分 → A 全在交集内（交集 [-5,10]×[0,10]）
                //   → A 的左侧 0 到 -5-1 = -6... 不对，交集 minX = max(0,-5) = 0
                //   → A 的右侧超出交集 = [11,10] 不存在
                //   所以 A 完全在交集内 → 无新隐藏
                //
                // 重新算: 交集 I = { minX:0, maxX:10, minY:0, maxY:10 }
                // newlyVisible = B - I:
                //   左侧条: minX=-5, maxX=-1, minY=0, maxY=10  (B.minGx=-5 < I.minX=0)
                //   右侧条: minX=11, maxX=15, minY=0, maxY=10  (B.maxGx=15 > I.maxX=10)
                // newlyHidden = A - I = {} (A == I)
    
                const visibleArea = rectArea(newlyVisible);
                const expectedVisible = (5 * 11) + (5 * 11); // 左5列 + 右5列, 各11行
                assert.equal(visibleArea, 110, `新可见区域总面积应为 110, 实际 ${visibleArea}`);
    
                assert.equal(newlyHidden.length, 0, 'A 完全在 B 内时不应有新隐藏');
            });
    
            it('向左收缩：左侧条新隐藏，右侧条新隐藏', () => {
                const NEW = { minGx: 3, maxGx: 7, minGy: 0, maxGy: 10 };
                const { newlyVisible, newlyHidden } = FrustumCuller.getDeltaRegions(BASE, NEW);
    
                // 交集 I = { minX:3, maxX:7, minY:0, maxY:10 }
                // newlyVisible = B - I = {} (B == I)
                // newlyHidden = A - I:
                //   左侧条: minX=0, maxX=2, minY=0, maxY=10  (A.minGx=0 < I.minX=3)
                //   右侧条: minX=8, maxX=10, minY=0, maxY=10 (A.maxGx=10 > I.maxX=7)
    
                assert.equal(newlyVisible.length, 0, 'B 完全在 A 内时不应有新可见');
    
                const hiddenArea = rectArea(newlyHidden);
                const expectedHidden = (3 * 11) + (3 * 11); // 左3列 + 右3列, 各11行
                assert.equal(hiddenArea, 66, `新隐藏区域总面积应为 66, 实际 ${hiddenArea}`);
            });
    
            it('向上扩展 + 向右扩展产生 2 个新可见条带', () => {
                const OLD = { minGx: 0, maxGx: 10, minGy: 0, maxGy: 10 };
                const NEW = { minGx: 0, maxGx: 15, minGy: -5, maxGy: 10 };
                const { newlyVisible, newlyHidden } = FrustumCuller.getDeltaRegions(OLD, NEW);
    
                // 交集 I = { minX:0, maxX:10, minY:0, maxY:10 }
                // newlyVisible:
                //   右侧条: minX=11, maxX=15, minY=0, maxY=10  (右5列×11行=55)
                //   上方条: minX=0, maxX=15, minY=-5, maxY=-1  (全宽16列×5行=80)
                //   → 总面积 = 55 + 80 = 135
                // newlyHidden: {} (OLD == I)
    
                const visibleArea = rectArea(newlyVisible);
                assert.equal(visibleArea, 135, `新可见面积应为 135, 实际 ${visibleArea}`);
                assert.equal(newlyHidden.length, 0, 'OLD 完全在 NEW 内时不应有新隐藏');
            });
    
            it('四向收缩产生 4 个新隐藏条带', () => {
                const OLD = { minGx: -10, maxGx: 20, minGy: -10, maxGy: 20 };
                const NEW = { minGx: 0, maxGx: 10, minGy: 0, maxGy: 10 };
                const { newlyVisible, newlyHidden } = FrustumCuller.getDeltaRegions(OLD, NEW);
    
                // 交集 I = NEW (因为 NEW 完全在 OLD 内)
                // newlyVisible: {} (NEW == I)
                // newlyHidden: 4 条带
    
                assert.equal(newlyVisible.length, 0, '收缩不应有新可见');
                assert.ok(newlyHidden.length >= 2, `应有至少 2 个新隐藏条带, 实际 ${newlyHidden.length}`);
    
                // OLD 总面积 = 31×31 = 961
                // NEW (交集) 面积 = 11×11 = 121
                // hidden 面积 = 961-121 = 840
                const hiddenArea = rectArea(newlyHidden);
                assert.equal(hiddenArea, 840, `新隐藏面积应为 840, 实际 ${hiddenArea}`);
            });
    
            it('无交集（跳跃位移）时全部切换', () => {
                const NEW = { minGx: 100, maxGx: 110, minGy: 100, maxGy: 110 };
                const { newlyVisible, newlyHidden } = FrustumCuller.getDeltaRegions(BASE, NEW);
    
                // 无交集 → newlyVisible = B, newlyHidden = A
                assert.equal(newlyVisible.length, 1, '无交集时新可见应为 1 个完整区域');
                assert.equal(newlyHidden.length, 1, '无交集时新隐藏应为 1 个完整区域');
    
                const visibleArea = rectArea(newlyVisible);
                const hiddenArea = rectArea(newlyHidden);
                assert.equal(visibleArea, 121, `新可见面积应为 121, 实际 ${visibleArea}`);
                assert.equal(hiddenArea, 121, `新隐藏面积应为 121, 实际 ${hiddenArea}`);
            });
    
            it('对角扩展产生所有 4 个条带', () => {
                const OLD = { minGx: 5, maxGx: 15, minGy: 5, maxGy: 15 };
                const NEW = { minGx: 0, maxGx: 20, minGy: 0, maxGy: 20 };
                const { newlyVisible, newlyHidden } = FrustumCuller.getDeltaRegions(OLD, NEW);
    
                // 交集 I = OLD
                // newlyVisible = NEW - OLD: 4 个条带
                // newlyHidden = {} (OLD == I)
    
                // 4 个条带:
                //   左侧: minX=0, maxX=4, minY=5, maxY=15   (5×11=55)
                //   右侧: minX=16, maxX=20, minY=5, maxY=15  (5×11=55)
                //   上方: minX=0, maxX=20, minY=0, maxY=4    (21×5=105)
                //   下方: minX=0, maxX=20, minY=16, maxY=20  (21×5=105)
                //   总面积 = 55+55+105+105 = 320
    
                assert.equal(newlyVisible.length, 4, `对角扩展应有 4 个新可见条带, 实际 ${newlyVisible.length}`);
                assert.equal(newlyHidden.length, 0, 'OLD 完全在 NEW 内时不应有新隐藏');
    
                const visibleArea = rectArea(newlyVisible);
                assert.equal(visibleArea, 320, `新可见总面积应为 320, 实际 ${visibleArea}`);
            });
    
            it('各条带区域不重叠（数学正确性验证）', () => {
                const OLD = { minGx: 0, maxGx: 10, minGy: 0, maxGy: 10 };
                const NEW = { minGx: -5, maxGx: 15, minGy: -5, maxGy: 15 };
                const { newlyVisible, newlyHidden } = FrustumCuller.getDeltaRegions(OLD, NEW);
    
                // 收集所有 newlyVisible 坐标，验证无重复
                /** @type {Set<string>} */
                const allCoords = new Set();
                let totalCount = 0;
    
                for (const rect of newlyVisible) {
                    for (let gy = rect.minY; gy <= rect.maxY; gy++) {
                        for (let gx = rect.minX; gx <= rect.maxX; gx++) {
                            allCoords.add(`${gx},${gy}`);
                            totalCount++;
                        }
                    }
                }
    
                // 不重复的坐标数应等于总面积
                assert.equal(allCoords.size, rectArea(newlyVisible),
                    '各条带之间坐标不应重叠');
                assert.equal(newlyHidden.length, 0);
    
                // 验证 newlyVisible 中的坐标确实都不在 OLD 中
                for (const coord of allCoords) {
                    const [gx, gy] = coord.split(',').map(Number);
                    const inOld = FrustumCuller.isInBounds(gx, gy, OLD);
                    assert.equal(inOld, false,
                        `坐标 (${gx},${gy}) 应在 OLD 之外`);
                }
    
                // 验证 NEW 中不在 delta 区域的坐标都在 OLD 中（交集）
                let inBothCount = 0;
                for (let gy = NEW.minGy; gy <= NEW.maxGy; gy++) {
                    for (let gx = NEW.minGx; gx <= NEW.maxGx; gx++) {
                        if (!allCoords.has(`${gx},${gy}`)) {
                            const inOld = FrustumCuller.isInBounds(gx, gy, OLD);
                            assert.equal(inOld, true,
                                `非 delta 坐标 (${gx},${gy}) 应在 OLD 中`);
                            inBothCount++;
                        }
                    }
                }
                // 交集面积 = OLD 面积 = 11×11 = 121
                assert.equal(inBothCount, 121,
                    `交集（不变区域）面积应为 121, 实际 ${inBothCount}`);
            });
    
            it('增量坐标集合不遗漏也不冗余', () => {
                // 模拟一次典型的相机移动：向右下移动 3 格
                const OLD = { minGx: 0, maxGx: 40, minGy: 0, maxGy: 40 };
                const NEW = { minGx: 3, maxGx: 43, minGy: 3, maxGy: 43 };
                const { newlyVisible, newlyHidden } = FrustumCuller.getDeltaRegions(OLD, NEW);
    
                // 交集 I = { minX:3, maxX:40, minY:3, maxY:40 }
                // newlyVisible = B - I:
                //   右侧条: minX=41, maxX=43, minY=3, maxY=40  (3×38=114)
                //   下方条: minX=3, maxX=43, minY=41, maxY=43  (41×3=123)
                //   总面积 = 114 + 123 = 237
                //
                // newlyHidden = A - I:
                //   左侧条: minX=0, maxX=2, minY=3, maxY=40   (3×38=114)
                //   上方条: minX=0, maxX=40, minY=0, maxY=2   (41×3=123)
                //   总面积 = 114 + 123 = 237
    
                const visibleArea = rectArea(newlyVisible);
                const hiddenArea = rectArea(newlyHidden);
                assert.equal(visibleArea, 237, `新可见面积应为 237, 实际 ${visibleArea}`);
                assert.equal(hiddenArea, 237, `新隐藏面积应为 237, 实际 ${hiddenArea}`);
    
                // 验证 newlyVisible 和 newlyHidden 不重叠
                const visCoords = new Set();
                for (const rect of newlyVisible) {
                    for (let gy = rect.minY; gy <= rect.maxY; gy++) {
                        for (let gx = rect.minX; gx <= rect.maxX; gx++) {
                            visCoords.add(`${gx},${gy}`);
                        }
                    }
                }
                for (const rect of newlyHidden) {
                    for (let gy = rect.minY; gy <= rect.maxY; gy++) {
                        for (let gx = rect.minX; gx <= rect.maxX; gx++) {
                            assert.equal(visCoords.has(`${gx},${gy}`), false,
                                `(gx=${gx},gy=${gy}) 不应同时出现在新可见和新隐藏中`);
                        }
                    }
                }
            });
        });
    });

    describe('boundsEqual', () => {

        it('相同范围返回 true', () => {
            const a = { minGx: -10, maxGx: 20, minGy: -5, maxGy: 30 };
            const b = { minGx: -10, maxGx: 20, minGy: -5, maxGy: 30 };
            assert.equal(FrustumCuller.boundsEqual(a, b), true);
        });

        it('不同范围返回 false', () => {
            const a = { minGx: -10, maxGx: 20, minGy: -5, maxGy: 30 };
            const b = { minGx: -10, maxGx: 21, minGy: -5, maxGy: 30 };
            assert.equal(FrustumCuller.boundsEqual(a, b), false);
        });

        it('两个 null 返回 true', () => {
            assert.equal(FrustumCuller.boundsEqual(null, null), true);
        });

        it('一个 null 一个非 null 返回 false', () => {
            const a = { minGx: -10, maxGx: 20, minGy: -5, maxGy: 30 };
            assert.equal(FrustumCuller.boundsEqual(null, a), false);
            assert.equal(FrustumCuller.boundsEqual(a, null), false);
        });
    });
});
