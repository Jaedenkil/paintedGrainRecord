// @ts-check

/**
 * @fileoverview
 * ScreenToWorld —— 屏幕坐标 → 体素网格坐标的 O(1) 逆变换工具。
 *
 * 这是连接「输入系统」与「体素世界」的数学桥梁，提供三个核心能力：
 *
 * 1. **screenToGrid** — 将鼠标点击的屏幕像素反算为等轴网格坐标 (gx, gy)
 * 2. **screenToChunk** — 进一步映射到 Chunk 坐标 (cx, cy) + 局部坐标
 * 3. **getFace** — 判断点击位于方块的顶/左/右哪个面
 *
 * ## 数学原理
 *
 * 正变换（网格→屏幕）：
 * ```
 * worldX = (gx - gy) * TILE_HALF_W      // TILE_HALF_W = 12
 * worldY = (gx + gy) * TILE_HALF_H      // TILE_HALF_H = 6
 * screenX = viewW/2 + (worldX - cameraX) * zoom
 * screenY = viewH/2 + (worldY - cameraY) * zoom
 * ```
 *
 * 逆变换（屏幕→网格）：
 * ```
 * worldX = (screenX - viewW/2) / zoom + cameraX
 * worldY = (screenY - viewH/2) / zoom + cameraY
 * gx = (worldX / HW + worldY / HH) / 2
 * gy = (worldY / HH - worldX / HW) / 2
 * ```
 *
 * ## 面方向检测
 *
 * 将点击位置转换到方块的本地坐标空间后：
 * - 顶面：菱形命中测试（|lx/HW| + |ly/HH| ≤ 容差）
 * - 左面：位于菱形左侧（lx < 0）
 * - 右面：位于菱形右侧（lx ≥ 0）
 *
 * @module input/ScreenToWorld
 */

import { TILE_HALF_W, TILE_HALF_H, TILE_H } from '../render/block/BlockConstants.mjs';
import { CHUNK_SIZE } from '../voxel/ChunkCoordUtils.mjs';

// ==================== 类型定义 ====================

/**
 * 相机快照接口（与 IsoProjection 共用同一形状）。
 * @typedef {Object} CameraSnapshot
 * @property {number} x - 相机世界 X
 * @property {number} y - 相机世界 Y
 * @property {number} zoom - 当前缩放
 * @property {number} viewWidth - 视口宽度
 * @property {number} viewHeight - 视口高度
 */

/**
 * 网格坐标 + 面方向结果。
 * @typedef {Object} GridHitResult
 * @property {number} gx - 网格 X（浮点精度）
 * @property {number} gy - 网格 Y（浮点精度）
 * @property {number} gz - 网格 Z（高度，需外部传入或根据场景推断）
 * @property {'top'|'left'|'right'} face - 点击的面方向
 */

// ==================== 内部工具 ====================

/**
 * 从 Camera2D 实例读取当前快照。
 * @param {Object} camera - Camera2D 实例
 * @returns {CameraSnapshot}
 */
function takeCameraSnapshot(camera) {
    return {
        x: camera.x,
        y: camera.y,
        zoom: camera.zoom,
        viewWidth: camera.viewWidth,
        viewHeight: camera.viewHeight
    };
}

// ==================== ScreenToWorld 类 ====================

export class ScreenToWorld {

    /**
     * @param {Object} camera - Camera2D 实例（需含 x, y, zoom, viewWidth, viewHeight 属性）
     *
     * @example
     * ```javascript
     * const stw = new ScreenToWorld(camera2D);
     * const { gx, gy } = stw.screenToGrid(400, 300);
     * ```
     */
    constructor(camera) {
        /** @private @type {Object} */
        this._camera = camera;
    }

    /**
     * 屏幕像素坐标 → 等轴网格坐标（浮点精度）。
     *
     * 内部自动读取相机当前状态（位置、缩放、视口尺寸），
     * 无需调用者每次传入相机快照。
     *
     * @param {number} sx - 屏幕像素 X
     * @param {number} sy - 屏幕像素 Y
     * @returns {{ gx: number, gy: number }} 网格浮点坐标
     *
     * @example
     * ```javascript
     * // 假设相机在原点，zoom=1，视口 960×540
     * stw.screenToGrid(480, 270);  // → { gx: 0, gy: 0 }
     * ```
     */
    screenToGrid(sx, sy) {
        const cam = takeCameraSnapshot(this._camera);
        const halfW = cam.viewWidth / 2;
        const halfH = cam.viewHeight / 2;

        // 1. 反相机变换（屏幕坐标 → 等轴空间坐标）
        const worldX = (sx - halfW) / cam.zoom + cam.x;
        const worldY = (sy - halfH) / cam.zoom + cam.y;

        // 2. 反等轴投影（解线性方程组）
        //    worldX = (gx - gy) * HW
        //    worldY = (gx + gy) * HH
        //    → gx = (worldX / HW + worldY / HH) / 2
        //    → gy = (worldY / HH - worldX / HW) / 2
        const gx = (worldX / TILE_HALF_W + worldY / TILE_HALF_H) / 2;
        const gy = (worldY / TILE_HALF_H - worldX / TILE_HALF_W) / 2;

        return { gx, gy };
    }

    /**
     * 屏幕像素坐标 → 整数等轴网格坐标（取整到最近格子）。
     *
     * @param {number} sx - 屏幕像素 X
     * @param {number} sy - 屏幕像素 Y
     * @returns {{ gx: number, gy: number }} 整数网格坐标
     *
     * @example
     * ```javascript
     * stw.screenToGridRounded(400, 300);
     * // → { gx: -4, gy: 12 } （示例值）
     * ```
     */
    screenToGridRounded(sx, sy) {
        const { gx, gy } = this.screenToGrid(sx, sy);
        return {
            gx: Math.round(gx),
            gy: Math.round(gy)
        };
    }

    /**
     * 屏幕像素坐标 → Chunk 坐标 + 局部坐标。
     *
     * 适用于需要定位到具体 Chunk 的操作（如区域加载/卸载）。
     *
     * @param {number} sx - 屏幕像素 X
     * @param {number} sy - 屏幕像素 Y
     * @returns {{ cx: number, cy: number, localGx: number, localGy: number }}
     *
     * @example
     * ```javascript
     * const { cx, cy, localGx, localGy } = stw.screenToChunk(400, 300);
     * ```
     */
    screenToChunk(sx, sy) {
        const { gx, gy } = this.screenToGrid(sx, sy);
        const gxInt = Math.round(gx);
        const gyInt = Math.round(gy);

        return {
            cx: Math.floor(gxInt / CHUNK_SIZE),
            cy: Math.floor(gyInt / CHUNK_SIZE),
            localGx: ((gxInt % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
            localGy: ((gyInt % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
        };
    }

    /**
     * 判断屏幕点击位置对应方块的面方向。
     *
     * 算法原理：
     * 1. 计算方块在屏幕上的投射位置
     * 2. 计算点击偏移量（相对方块屏幕中心）
     * 3. 去缩放，得到等轴空间偏移
     * 4. 菱形测试 → 顶面；左侧 → 左面；右侧 → 右面
     *
     * @param {number} sx - 屏幕像素 X
     * @param {number} sy - 屏幕像素 Y
     * @param {number} blockGx - 方块的网格 X 坐标
     * @param {number} blockGy - 方块的网格 Y 坐标
     * @param {number} [blockGz=0] - 方块的网格 Z 坐标（高度）
     * @returns {'top'|'left'|'right'} 点击的面方向
     *
     * @example
     * ```javascript
     * const face = stw.getFace(400, 300, 5, 3, 0);
     * // → 'top' | 'left' | 'right'
     * ```
     */
    getFace(sx, sy, blockGx, blockGy, blockGz = 0) {
        const cam = takeCameraSnapshot(this._camera);

        // 1. 计算方块中心的屏幕坐标
        //    等轴空间坐标（菱形中心 - 高度偏移）
        const blockWorldX = (blockGx - blockGy) * TILE_HALF_W;
        const blockWorldY = (blockGx + blockGy) * TILE_HALF_H - blockGz * TILE_H;

        //    屏幕坐标
        const halfW = cam.viewWidth / 2;
        const halfH = cam.viewHeight / 2;
        const screenBX = halfW + (blockWorldX - cam.x) * cam.zoom;
        const screenBY = halfH + (blockWorldY - cam.y) * cam.zoom;

        // 2. 计算点击偏移（像素）
        const dx = sx - screenBX;
        const dy = sy - screenBY;

        // 3. 去缩放 → 等轴空间偏移
        const localX = dx / cam.zoom;
        const localY = dy / cam.zoom;

        // 4. 面方向判定
        //    顶面：菱形测试，使用等轴半宽/半高
        const nx = localX / TILE_HALF_W;   // 归一化 x
        const ny = localY / TILE_HALF_H;    // 归一化 y

        // 菱形边界：|nx| + |ny| ≤ 1（允许 0.15 容差应对像素级误差）
        if (Math.abs(nx) + Math.abs(ny) <= 1.15) {
            return 'top';
        }

        // 非顶面：根据 x 符号判断左右
        return localX < 0 ? 'left' : 'right';
    }
}
