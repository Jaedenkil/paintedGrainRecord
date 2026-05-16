// @ts-check

/**
 * @fileoverview
 * 体素块（Chunk）—— 16×16×16 体素数据容器。
 *
 * ## 核心职责
 *
 * - 以 `Uint16Array(4096)` 存储体素数据
 * - voxelId = 0 表示"空气"（空格），值 1~65535 为有效方块 ID
 * - 提供局部坐标 (lx, ly, lz) 的读写接口
 * - 维护脏标记 (dirty flag) 用于渲染管线增量更新
 *
 * ## 内存布局
 *
 * 使用 z-major 布局（同一竖向柱连续）：
 * ```text
 * index = lz + ly * 16 + lx * 256
 *
 * 竖向柱 (lx=0, ly=0) → indices [0..15]
 * 竖向柱 (lx=0, ly=1) → indices [16..31]
 * ...
 * 竖向柱 (lx=15, ly=15) → indices [3840..4095]
 * ```
 *
 * ## 设计原则
 *
 * - 纯数据容器，不感知渲染、物理或游戏逻辑
 * - 不持有任何外部引用，可安全序列化
 * - 所有修改操作自动设置脏标记，查询操作不修改状态
 *
 * @module voxel/Chunk
 */

import {
    CHUNK_SIZE,
    CHUNK_VOLUME,
    localToIndex,
    isInBounds
} from './ChunkCoordUtils.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = {
    info: () => {},
    warn: (...args) => console.warn('[Chunk]', ...args),
    error: (...args) => console.error('[Chunk]', ...args),
    debug: () => {}
};

/**
 * 体素块，管理 16×16×16 的体素数据。
 */
export class Chunk {
    /** Chunk 边长（体素单位） */
    static CHUNK_SIZE = CHUNK_SIZE;

    /** Chunk 体素总数 */
    static TOTAL_VOXELS = CHUNK_VOLUME;

    /**
     * @param {number} cx - Chunk X 坐标
     * @param {number} cy - Chunk Y 坐标
     * @param {Uint16Array} [data] - 可选预填充数据。
     *        提供此参数时直接使用（不拷贝），用于从存档恢复。
     *        长度必须为 CHUNK_VOLUME（4096），否则抛出错误。
     */
    constructor(cx, cy, data) {
        /** @private @readonly @type {number} */
        this._cx = cx;

        /** @private @readonly @type {number} */
        this._cy = cy;

        /**
         * 体素数据缓冲区。
         * @private @type {Uint16Array}
         */
        this._data = data
            ? this._validateData(data)
            : new Uint16Array(CHUNK_VOLUME);

        /**
         * 脏标记。数据被修改后置为 true，渲染管线消费后调用 clearDirty() 重置。
         * @private @type {boolean}
         */
        this._dirty = true; // 初始化为脏，确保首次渲染时全量构建
    }

    /**
     * 验证预填充数据长度。
     * @private
     * @param {Uint16Array} data
     * @returns {Uint16Array}
     */
    _validateData(data) {
        if (data.length !== CHUNK_VOLUME) {
            throw new Error(
                `Chunk 数据长度应为 ${CHUNK_VOLUME}，实际为 ${data.length}`
            );
        }
        return data;
    }

    // ==================== 体素读写 ====================

    /**
     * 获取指定位置的体素 ID。
     *
     * @param {number} lx - 局部 X [0, 16)
     * @param {number} ly - 局部 Y [0, 16)
     * @param {number} lz - 局部 Z [0, 16)
     * @returns {number} voxelId（0 = 空气/空格）。越界坐标返回 0。
     *
     * @example
     * ```js
     * const chunk = new Chunk(0, 0);
     * chunk.getVoxel(0, 0, 0); // → 0（初始全空）
     * ```
     */
    getVoxel(lx, ly, lz) {
        if (!isInBounds(lx, ly, lz)) return 0;
        return this._data[localToIndex(lx, ly, lz)];
    }

    /**
     * 设置指定位置的体素 ID。
     *
     * @param {number} lx - 局部 X [0, 16)
     * @param {number} ly - 局部 Y [0, 16)
     * @param {number} lz - 局部 Z [0, 16)
     * @param {number} voxelId - 体素 ID（0 = 清除方块）
     * @returns {boolean} 是否成功设置（越界返回 false）
     *
     * @example
     * ```js
     * const chunk = new Chunk(0, 0);
     * chunk.setVoxel(7, 7, 0, 1); // 在 (7,7,0) 放置 ID=1 的方块
     * chunk.getVoxel(7, 7, 0);    // → 1
     * ```
     */
    setVoxel(lx, ly, lz, voxelId) {
        if (!isInBounds(lx, ly, lz)) return false;
        const index = localToIndex(lx, ly, lz);
        if (this._data[index] !== voxelId) {
            this._data[index] = voxelId;
            this._dirty = true;
        }
        return true;
    }

    // ==================== 批量操作 ====================

    /**
     * 用指定 voxelId 填充 Chunk 的所有体素。
     *
     * @param {number} voxelId - 填充用的体素 ID（0 = 清空）
     *
     * @example
     * ```js
     * const chunk = new Chunk(0, 0);
     * chunk.fill(1); // 全部填满 ID=1
     * chunk.fill(0); // 全部清空
     * ```
     */
    fill(voxelId) {
        this._data.fill(voxelId);
        this._dirty = true;
    }

    /**
     * 获取指定 (lx, ly) 位置最顶部的非空体素高度。
     *
     * 从最高层 (lz=15) 向下遍历，返回第一个非空格的高度。
     *
     * @param {number} lx - 局部 X [0, 16)
     * @param {number} ly - 局部 Y [0, 16)
     * @returns {number} 顶部体素的 lz 值（0~15）。整列全空时返回 -1。
     *
     * @example
     * ```js
     * const chunk = new Chunk(0, 0);
     * chunk.setVoxel(5, 5, 3, 1);
     * chunk.getTopHeight(5, 5); // → 3（顶部方块在 lz=3）
     * chunk.getTopHeight(0, 0); // → -1（全空）
     * ```
     */
    getTopHeight(lx, ly) {
        if (!isInBounds(lx, ly, 0)) return -1;
        const base = localToIndex(lx, ly, 0);
        // 从顶向下遍历
        for (let lz = CHUNK_SIZE - 1; lz >= 0; lz--) {
            if (this._data[base + lz] !== 0) {
                return lz;
            }
        }
        return -1;
    }

    // ==================== 脏标记 ====================

    /**
     * 检查 Chunk 自上次 `clearDirty()` 以来是否有数据变更。
     *
     * @returns {boolean}
     */
    isDirty() {
        return this._dirty;
    }

    /**
     * 清除脏标记。通常在渲染管线消费完变更后调用。
     */
    clearDirty() {
        this._dirty = false;
    }

    /**
     * 强制标记 Chunk 为脏。当外部逻辑直接操作 _data 时需要调用。
     */
    markDirty() {
        this._dirty = true;
    }

    // ==================== 序列化与统计 ====================

    /**
     * 返回 Chunk 坐标。
     *
     * @returns {{ cx: number, cy: number }}
     */
    getChunkCoord() {
        return { cx: this._cx, cy: this._cy };
    }

    /**
     * 返回体素数据的扁平数组副本。
     *
     * @returns {Uint16Array} 长度为 4096 的数组副本
     */
    toFlatArray() {
        return new Uint16Array(this._data);
    }

    /**
     * 获取内部数据缓冲区的直接引用（只读用途）。
     *
     * ⚠️ 警告：修改返回的数组不会触发脏标记。
     * 如需修改请使用 `setVoxel()` 或 `fill()`。
     *
     * @returns {Uint16Array}
     */
    getRawData() {
        return this._data;
    }

    /**
     * 统计 Chunk 中非空气体素的数量。
     *
     * @returns {number}
     */
    getVoxelCount() {
        let count = 0;
        for (let i = 0; i < CHUNK_VOLUME; i++) {
            if (this._data[i] !== 0) count++;
        }
        return count;
    }
}
