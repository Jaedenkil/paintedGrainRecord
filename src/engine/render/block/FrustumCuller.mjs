// @ts-check

/**
 * @fileoverview
 * FrustumCuller —— 等轴视锥体裁剪纯数学工具。
 *
 * 根据相机当前状态（位置、缩放、视口尺寸），计算可见的等轴网格范围，
 * 供 BlockGridManager 过滤不可见方块的渲染。
 *
 * ## 原理
 *
 * ```
 * 1. 从相机获取世界空间中心点 (cx, cy)、缩放 zoom、视口尺寸 (vw, vh)
 * 2. 计算 4 个视口角点在世界空间中的坐标
 * 3. 通过等轴逆投影将每个角点转换为网格坐标 (gx, gy)
 * 4. 取 min/max 并外扩 1 格容差 → 得到可见网格矩形范围
 * 5. 此范围内的方块显示，范围外的隐藏
 * ```
 *
 * ## 为什么不需要 gz 裁剪
 *
 * 等轴投影中，gz（高度）只影响屏幕 Y 偏移，不影响可见性判定。
 * 高处的方块如果 gx/gy 在视口内，其屏幕 Y 可能上移出视口，
 * 但 gz 裁剪的收益与复杂度不成正比，暂不实现。
 *
 * @module render/block/FrustumCuller
 */

import { TILE_HALF_W, TILE_HALF_H } from './BlockConstants.mjs';

// ==================== 类型定义 ====================

/**
 * 相机快照接口（与 IsoProjection / ScreenToWorld 共享同一形状）。
 * @typedef {Object} CameraSnapshot
 * @property {number} x - 相机世界 X
 * @property {number} y - 相机世界 Y
 * @property {number} zoom - 当前缩放
 * @property {number} viewWidth - 视口宽度（像素）
 * @property {number} viewHeight - 视口高度（像素）
 */

/**
 * 可见网格范围。
 * @typedef {Object} VisibleGridBounds
 * @property {number} minGx - 最小网格 X（含）
 * @property {number} maxGx - 最大网格 X（含）
 * @property {number} minGy - 最小网格 Y（含）
 * @property {number} maxGy - 最大网格 Y（含）
 */

/**
 * 网格矩形区域（用于增量裁剪的差值条带）。
 *
 * @typedef {Object} GridRect
 * @property {number} minX - 起始 X（含）
 * @property {number} maxX - 结束 X（含）
 * @property {number} minY - 起始 Y（含）
 * @property {number} maxY - 结束 Y（含）
 */

// ==================== FrustumCuller ====================

/**
 * 等轴视锥体裁剪纯数学工具。
 *
 * 所有方法均为静态，无内部状态，可在游戏循环外安全调用。
 *
 * @example
 * ```javascript
 * import { FrustumCuller } from './FrustumCuller.mjs';
 *
 * const bounds = FrustumCuller.getVisibleGridBounds({
 *     x: 0, y: 0, zoom: 1,
 *     viewWidth: 960, viewHeight: 540
 * });
 * // → { minGx: -23, maxGx: 23, minGy: -12, maxGy: 34 }
 * ```
 */
export class FrustumCuller {

    /**
     * 计算当前相机可见的等轴网格范围。
     *
     * 算法步骤：
     * 1. 计算 4 个视口角点的世界空间坐标
     * 2. 通过等轴逆投影（screenToWorld 数学）转换为网格坐标
     * 3. 取 min/max 并外扩 1 格容差（应对部分在视口外的方块）
     *
     * @param {CameraSnapshot} camera - 相机快照
     * @returns {VisibleGridBounds} 可见网格范围（整数，含边界）
     *
     * @example
     * ```javascript
     * const bounds = FrustumCuller.getVisibleGridBounds({
     *     x: 288, y: 144, zoom: 1,
     *     viewWidth: 960, viewHeight: 540
     * });
     * ```
     */
    static getVisibleGridBounds(camera) {
        const { x: cx, y: cy, zoom, viewWidth: vw, viewHeight: vh } = camera;

        const halfW = vw / 2;
        const halfH = vh / 2;

        // 4 个视口角点的屏幕坐标 → 世界坐标 → 网格坐标
        const corners = [
            { sx: 0, sy: 0 },                       // 左上
            { sx: vw, sy: 0 },                       // 右上
            { sx: 0, sy: vh },                       // 左下
            { sx: vw, sy: vh }                       // 右下
        ];

        let minGx = Infinity;
        let maxGx = -Infinity;
        let minGy = Infinity;
        let maxGy = -Infinity;

        for (let i = 0; i < corners.length; i++) {
            const { sx, sy } = corners[i];

            // 反相机变换：屏幕坐标 → 等轴世界坐标
            const worldX = (sx - halfW) / zoom + cx;
            const worldY = (sy - halfH) / zoom + cy;

            // 反等轴投影：世界坐标 → 网格坐标
            //   worldX = (gx - gy) * HW
            //   worldY = (gx + gy) * HH
            //   → gx = (worldX / HW + worldY / HH) / 2
            //   → gy = (worldY / HH - worldX / HW) / 2
            const gx = (worldX / TILE_HALF_W + worldY / TILE_HALF_H) / 2;
            const gy = (worldY / TILE_HALF_H - worldX / TILE_HALF_W) / 2;

            if (gx < minGx) minGx = gx;
            if (gx > maxGx) maxGx = gx;
            if (gy < minGy) minGy = gy;
            if (gy > maxGy) maxGy = gy;
        }

        // 外扩 1 格容差（处理部分在视口外的方块），取整
        const MARGIN = 1;
        return {
            minGx: Math.floor(minGx - MARGIN),
            maxGx: Math.ceil(maxGx + MARGIN),
            minGy: Math.floor(minGy - MARGIN),
            maxGy: Math.ceil(maxGy + MARGIN)
        };
    }

    /**
     * 判断网格坐标是否在可见范围内。
     *
     * @param {number} gx - 网格 X
     * @param {number} gy - 网格 Y
     * @param {VisibleGridBounds} bounds - 可见范围
     * @returns {boolean} 是否在可见范围内
     *
     * @example
     * ```javascript
     * const visible = FrustumCuller.isInBounds(5, 3, bounds);
     * // → true / false
     * ```
     */
    static isInBounds(gx, gy, bounds) {
        return gx >= bounds.minGx && gx <= bounds.maxGx
            && gy >= bounds.minGy && gy <= bounds.maxGy;
    }

    /**
     * 判断两个可见范围是否相同（用于防抖跳过）。
     *
     * @param {VisibleGridBounds|null} a
     * @param {VisibleGridBounds|null} b
     * @returns {boolean}
     */
    static boundsEqual(a, b) {
        if (a === b) return true;
        if (!a || !b) return false;
        return a.minGx === b.minGx && a.maxGx === b.maxGx
            && a.minGy === b.minGy && a.maxGy === b.maxGy;
    }

    /**
     * 计算新旧可见范围之间**可见性发生变化**的差值矩形区域。
     *
     * 用于增量裁剪优化：只处理这些区域的网格坐标，跳过重叠区域（可见性不变）。
     *
     * ## 算法
     *
     * 1. 计算新范围 B 与旧范围 A 的交集 I
     * 2. 交集 I 内的块可见性不变 → 跳过
     * 3. **新可见** (newlyVisible) = B - I：B 中不在 I 内的部分
     *    - 左/右/上/下四个方向的矩形条带
     * 4. **新隐藏** (newlyHidden) = A - I：A 中不在 I 内的部分
     *    - 左/右/上/下四个方向的矩形条带
     *
     * 若 `oldBounds === null`（首次裁剪），返回 B 全部为新可见。
     * 若 A 与 B 无交集，返回 A 全部为新隐藏、B 全部为新可见。
     *
     * @param {VisibleGridBounds|null} oldBounds - 旧可见范围（首次裁剪为 null）
     * @param {VisibleGridBounds} newBounds - 新可见范围
     * @returns {{ newlyVisible: GridRect[], newlyHidden: GridRect[] }}
     *
     * @example
     * ```javascript
     * // 相机向右下移动后的差值区域
     * const { newlyVisible, newlyHidden } = FrustumCuller.getDeltaRegions(
     *     { minGx: 0, maxGx: 10, minGy: 0, maxGy: 10 },
     *     { minGx: 5, maxGx: 15, minGy: 5, maxGy: 15 }
     * );
     * // newlyVisible → [{ minX: 11, maxX: 15, minY: 5, maxY: 10 },  // 右侧条
     * //                 { minX: 5,  maxX: 15, minY: 11, maxY: 15 }]  // 底部条（含右下角）
     * // newlyHidden   → [{ minX: 0,  maxX: 4,  minY: 0, maxY: 10 },  // 左侧条
     * //                 { minX: 0,  maxX: 10, minY: 0, maxY: 4  }]  // 顶部条（含左上角）
     * ```
     */
    static getDeltaRegions(oldBounds, newBounds) {
        if (!oldBounds) {
            // 首次裁剪：全部为新可见
            return {
                newlyVisible: [{
                    minX: newBounds.minGx,
                    maxX: newBounds.maxGx,
                    minY: newBounds.minGy,
                    maxY: newBounds.maxGy
                }],
                newlyHidden: []
            };
        }

        // 计算交集 I
        const interMinX = Math.max(oldBounds.minGx, newBounds.minGx);
        const interMaxX = Math.min(oldBounds.maxGx, newBounds.maxGx);
        const interMinY = Math.max(oldBounds.minGy, newBounds.minGy);
        const interMaxY = Math.min(oldBounds.maxGy, newBounds.maxGy);

        const hasOverlap = interMinX <= interMaxX && interMinY <= interMaxY;

        /** @type {import('./FrustumCuller.mjs').GridRect[]} */
        const newlyVisible = [];
        /** @type {import('./FrustumCuller.mjs').GridRect[]} */
        const newlyHidden = [];

        if (!hasOverlap) {
            // 无交集：A 全部隐藏，B 全部新可见
            newlyVisible.push({
                minX: newBounds.minGx, maxX: newBounds.maxGx,
                minY: newBounds.minGy, maxY: newBounds.maxGy
            });
            newlyHidden.push({
                minX: oldBounds.minGx, maxX: oldBounds.maxGx,
                minY: oldBounds.minGy, maxY: oldBounds.maxGy
            });
            return { newlyVisible, newlyHidden };
        }

        // ── newlyVisible: B 中不在 I 内的部分 ──
        // 左侧条
        if (newBounds.minGx < interMinX) {
            newlyVisible.push({
                minX: newBounds.minGx, maxX: interMinX - 1,
                minY: interMinY, maxY: interMaxY
            });
        }
        // 右侧条
        if (newBounds.maxGx > interMaxX) {
            newlyVisible.push({
                minX: interMaxX + 1, maxX: newBounds.maxGx,
                minY: interMinY, maxY: interMaxY
            });
        }
        // 上方条（全宽：包含可能同时左右扩展的角落区域）
        if (newBounds.minGy < interMinY) {
            newlyVisible.push({
                minX: newBounds.minGx, maxX: newBounds.maxGx,
                minY: newBounds.minGy, maxY: interMinY - 1
            });
        }
        // 下方条（全宽）
        if (newBounds.maxGy > interMaxY) {
            newlyVisible.push({
                minX: newBounds.minGx, maxX: newBounds.maxGx,
                minY: interMaxY + 1, maxY: newBounds.maxGy
            });
        }

        // ── newlyHidden: A 中不在 I 内的部分 ──
        // 左侧条
        if (oldBounds.minGx < interMinX) {
            newlyHidden.push({
                minX: oldBounds.minGx, maxX: interMinX - 1,
                minY: interMinY, maxY: interMaxY
            });
        }
        // 右侧条
        if (oldBounds.maxGx > interMaxX) {
            newlyHidden.push({
                minX: interMaxX + 1, maxX: oldBounds.maxGx,
                minY: interMinY, maxY: interMaxY
            });
        }
        // 上方条（全宽）
        if (oldBounds.minGy < interMinY) {
            newlyHidden.push({
                minX: oldBounds.minGx, maxX: oldBounds.maxGx,
                minY: oldBounds.minGy, maxY: interMinY - 1
            });
        }
        // 下方条（全宽）
        if (oldBounds.maxGy > interMaxY) {
            newlyHidden.push({
                minX: oldBounds.minGx, maxX: oldBounds.maxGx,
                minY: interMaxY + 1, maxY: oldBounds.maxGy
            });
        }

        return { newlyVisible, newlyHidden };
    }
}
