// @ts-check

/**
 * @fileoverview
 * IsoProjection —— 等轴投影正向/逆向数学工具类。
 *
 * 集中管理 2.5D 等轴网格坐标 ↔ 屏幕坐标的相互转换。
 * 所有方法均为静态，无内部状态，纯函数式设计。
 *
 * ## 正向投影公式
 *
 * ```
 * // 菱形中心（相机空间坐标）
 * cx = (gx - gy) * TILE_HALF_W     // TILE_HALF_W = 12
 * cy = (gx + gy) * TILE_HALF_H     // TILE_HALF_H = 6
 *
 * // 相机变换（Camera2D._applyTransform）
 * screenX = viewW/2 + (cx - cameraX) * zoom
 * screenY = viewH/2 + (cy - cameraY) * zoom
 * ```
 *
 * ## 逆向投影公式（Screen → World）
 *
 * ```
 * // 反相机变换
 * worldX = (screenX - viewW/2) / zoom + cameraX
 * worldY = (screenY - viewH/2) / zoom + cameraY
 *
 * // 反等轴投影（解线性方程组）
 * gx = (worldX / TILE_HALF_W + worldY / TILE_HALF_H) / 2
 * gy = (worldY / TILE_HALF_H - worldX / TILE_HALF_W) / 2
 * ```
 *
 * ## 使用场景
 *
 * - 鼠标/触摸事件 → 确定点击的网格位置（InputSystem）
 * - 将实体坐标转换到屏幕坐标以定位 UI 元素
 * - 拖拽放置方块时的实时网格高亮
 *
 * @module render/IsoProjection
 */

import { TILE_HALF_W, TILE_HALF_H } from './block/BlockConstants.mjs';

// ==================== 类型定义 ====================

/**
 * 相机快照接口。
 * IsoProjection 不引用 Camera2D 实例，仅读取其位置和缩放值，
 * 降低耦合度，便于测试和 mock。
 *
 * @typedef {Object} CameraSnapshot
 * @property {number} x - 相机世界 X 坐标（currentX）
 * @property {number} y - 相机世界 Y 坐标（currentY）
 * @property {number} zoom - 当前缩放值（currentZoom）
 */

// ==================== IsoProjection 类 ====================

/**
 * 等轴投影数学工具。
 *
 * 所有方法均为静态，可在游戏循环外安全调用。
 *
 * @example
 * ```javascript
 * import { IsoProjection } from './IsoProjection.mjs';
 *
 * // 网格 → 屏幕
 * const screen = IsoProjection.gridToScreen(3, 5, camera, 960, 540);
 * // → { x: 位置, y: 位置 }
 *
 * // 屏幕 → 网格浮点
 * const world = IsoProjection.screenToWorld(400, 300, camera, 960, 540);
 * // → { gx: 浮点, gy: 浮点 }
 *
 * // 屏幕 → 网格整数（最接近格子）
 * const grid = IsoProjection.screenToGrid(400, 300, camera, 960, 540);
 * // → { gx: 整数, gy: 整数 }
 * ```
 */
export class IsoProjection {

    /**
     * 将等轴网格坐标投影到屏幕像素坐标（正向投影）。
     *
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {CameraSnapshot} camera - 相机快照（{x, y, zoom}）
     * @param {number} viewWidth - 视口宽度（像素）
     * @param {number} viewHeight - 视口高度（像素）
     * @returns {{ x: number, y: number }} 屏幕像素坐标
     *
     * @example
     * ```javascript
     * // 网格原点 → 屏幕中心（相机在原点，zoom=1）
     * IsoProjection.gridToScreen(0, 0, { x: 0, y: 0, zoom: 1 }, 960, 540);
     * // → { x: 480, y: 270 }
     * ```
     */
    static gridToScreen(gx, gy, camera, viewWidth, viewHeight) {
        // 等轴投影：菱形中心
        const cx = (gx - gy) * TILE_HALF_W;
        const cy = (gx + gy) * TILE_HALF_H;

        // 相机变换（同 Camera2D._applyTransform）
        const halfW = viewWidth / 2;
        const halfH = viewHeight / 2;

        const screenX = halfW + (cx - camera.x) * camera.zoom;
        const screenY = halfH + (cy - camera.y) * camera.zoom;

        return { x: screenX, y: screenY };
    }

    /**
     * 将屏幕像素坐标反算为等轴网格坐标（浮点精度）。
     *
     * 返回值是浮点数，不进行取整。
     * 如需定位到具体格子，使用 `screenToGrid`。
     *
     * @param {number} screenX - 屏幕像素 X
     * @param {number} screenY - 屏幕像素 Y
     * @param {CameraSnapshot} camera - 相机快照（{x, y, zoom}）
     * @param {number} viewWidth - 视口宽度（像素）
     * @param {number} viewHeight - 视口高度（像素）
     * @returns {{ gx: number, gy: number }} 网格浮点坐标
     *
     * @example
     * ```javascript
     * // 屏幕中心 → 网格原点
     * IsoProjection.screenToWorld(480, 270, { x: 0, y: 0, zoom: 1 }, 960, 540);
     * // → { gx: 0, gy: 0 }
     * ```
     */
    static screenToWorld(screenX, screenY, camera, viewWidth, viewHeight) {
        const halfW = viewWidth / 2;
        const halfH = viewHeight / 2;

        // 1. 反相机变换
        const worldX = (screenX - halfW) / camera.zoom + camera.x;
        const worldY = (screenY - halfH) / camera.zoom + camera.y;

        // 2. 反等轴投影（解线性方程组）
        //   worldX = (gx - gy) * HW
        //   worldY = (gx + gy) * HH
        //   → gx = (worldX / HW + worldY / HH) / 2
        //   → gy = (worldY / HH - worldX / HW) / 2
        const gx = (worldX / TILE_HALF_W + worldY / TILE_HALF_H) / 2;
        const gy = (worldY / TILE_HALF_H - worldX / TILE_HALF_W) / 2;

        return { gx, gy };
    }

    /**
     * 将屏幕像素坐标反算为整数等轴网格坐标。
     *
     * 使用 `Math.round` 取整到最近格子。
     * 适用于鼠标点击定位、放置方块等需要精确格子的场景。
     *
     * @param {number} screenX - 屏幕像素 X
     * @param {number} screenY - 屏幕像素 Y
     * @param {CameraSnapshot} camera - 相机快照（{x, y, zoom}）
     * @param {number} viewWidth - 视口宽度（像素）
     * @param {number} viewHeight - 视口高度（像素）
     * @returns {{ gx: number, gy: number }} 整数网格坐标
     *
     * @example
     * ```javascript
     * const grid = IsoProjection.screenToGrid(400, 300, camera, 960, 540);
     * // → { gx: 整数, gy: 整数 }
     * ```
     */
    static screenToGrid(screenX, screenY, camera, viewWidth, viewHeight) {
        const { gx, gy } = this.screenToWorld(screenX, screenY, camera, viewWidth, viewHeight);
        return {
            gx: Math.round(gx),
            gy: Math.round(gy)
        };
    }
}
