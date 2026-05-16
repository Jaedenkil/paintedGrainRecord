// @ts-check

/**
 * @fileoverview
 * 体素世界 —— Chunk 容器，提供世界坐标下的体素读写。
 *
 * ## 职责
 *
 * - 管理所有已加载的 Chunk 实例（以 `Map<cx,cy, Chunk>` 存储）
 * - 世界坐标 (wx, wy, wz) ↔ Chunk 坐标 (cx, cy) + 局部坐标 (lx, ly, lz) 的自动转换
 * - 懒加载：读取或写入未加载的 Chunk 时自动创建空 Chunk
 * - 视口遍历：以给定 Chunk 坐标为中心、半径为范围遍历 Chunk
 * - 世界存档：serialize / deserialize 完整写入/恢复
 *
 * ## 坐标映射示例
 *
 * ```text
 * 世界坐标 (wx=18, wy=-3, wz=5)
 *   → Chunk 坐标：cx = floor(18/16) = 1, cy = floor(-3/16) = -1
 *   → 局部坐标：lx = 2, ly = 13, lz = 5
 *   → VoxelWorld.getVoxel(18, -3, 5) 内部自动转换
 * ```
 *
 * ## 设计原则
 *
 * - 纯数据管理，不持有渲染或物理引用
 * - 线程安全友好（纯 JS 单线程执行，无竞态）
 * - 所有公共方法对越界坐标宽容处理（返回 0 或静默忽略）
 *
 * @module voxel/VoxelWorld
 */

import { Chunk } from './Chunk.mjs';
import {
    CHUNK_SIZE,
    CHUNK_VOLUME,
    worldToChunk,
    worldToLocal,
    chunkKey
} from './ChunkCoordUtils.mjs';

/**
 * 体素世界管理器。
 */
export class VoxelWorld {
    /**
     * @param {number} [seed=0] - 随机种子（保留供未来世界生成器使用）
     */
    constructor(seed = 0) {
        /** @private @type {Map<string, Chunk>} */
        this._chunks = new Map();

        /** @private @type {number} */
        this._seed = seed;
    }

    // ==================== Chunk 管理 ====================

    /**
     * 获取指定坐标的 Chunk。如果不存在则自动创建空 Chunk（懒加载）。
     *
     * @param {number} cx - Chunk X
     * @param {number} cy - Chunk Y
     * @returns {Chunk}
     *
     * @example
     * ```js
     * const world = new VoxelWorld();
     * const chunk = world.getOrCreateChunk(0, 0);
     * // chunk 是一个全新的空 Chunk
     * ```
     */
    getOrCreateChunk(cx, cy) {
        const key = chunkKey(cx, cy);
        if (this._chunks.has(key)) {
            return /** @type {Chunk} */ (this._chunks.get(key));
        }
        const chunk = new Chunk(cx, cy);
        this._chunks.set(key, chunk);
        return chunk;
    }

    /**
     * 获取指定坐标的 Chunk。不存在时返回 `null`（不自动创建）。
     *
     * @param {number} cx - Chunk X
     * @param {number} cy - Chunk Y
     * @returns {Chunk|null}
     *
     * @example
     * ```js
     * const world = new VoxelWorld();
     * const chunk = world.getChunk(0, 0);
     * // → null（尚未创建）
     * ```
     */
    getChunk(cx, cy) {
        return this._chunks.get(chunkKey(cx, cy)) || null;
    }

    /**
     * 检查指定坐标的 Chunk 是否存在。
     *
     * @param {number} cx - Chunk X
     * @param {number} cy - Chunk Y
     * @returns {boolean}
     */
    hasChunk(cx, cy) {
        return this._chunks.has(chunkKey(cx, cy));
    }

    /**
     * 移除指定坐标的 Chunk。
     *
     * @param {number} cx - Chunk X
     * @param {number} cy - Chunk Y
     * @returns {Chunk|null} 被移除的 Chunk，不存在时返回 null
     *
     * @example
     * ```js
     * const world = new VoxelWorld();
     * world.getOrCreateChunk(1, 1);
     * world.removeChunk(1, 1); // → Chunk 实例
     * world.removeChunk(99, 99); // → null
     * ```
     */
    removeChunk(cx, cy) {
        const key = chunkKey(cx, cy);
        if (this._chunks.has(key)) {
            const chunk = /** @type {Chunk} */ (this._chunks.get(key));
            this._chunks.delete(key);
            return chunk;
        }
        return null;
    }

    // ==================== 体素读写（世界坐标） ====================

    /**
     * 获取世界坐标 (wx, wy, wz) 处的体素 ID。
     *
     * 自动处理坐标转换和跨 Chunk 边界读取。
     * 越界 wz（< 0 或 >= 16）返回 0。
     *
     * @param {number} wx - 世界 X
     * @param {number} wy - 世界 Y
     * @param {number} wz - 世界 Z（高度，0 ~ 15）
     * @returns {number} voxelId（0 = 空气，越界坐标返回 0）
     *
     * @example
     * ```js
     * const world = new VoxelWorld();
     * world.getVoxel(0, 0, 0); // → 0（全空）
     * ```
     */
    getVoxel(wx, wy, wz) {
        // wz 越界快速返回
        if (wz < 0 || wz >= CHUNK_SIZE) return 0;

        const { cx, cy } = worldToChunk(wx, wy);
        const chunk = this._chunks.get(chunkKey(cx, cy));
        if (!chunk) return 0;

        const { lx, ly } = worldToLocal(wx, wy);
        return chunk.getVoxel(lx, ly, wz);
    }

    /**
     * 设置世界坐标 (wx, wy, wz) 处的体素 ID。
     *
     * 自动创建不存在的 Chunk（懒加载）。
     * wz 越界时静默忽略。
     *
     * @param {number} wx - 世界 X
     * @param {number} wy - 世界 Y
     * @param {number} wz - 世界 Z（高度，0 ~ 15）
     * @param {number} voxelId - 体素 ID（0 = 清除方块）
     * @returns {boolean} 是否成功设置
     *
     * @example
     * ```js
     * const world = new VoxelWorld();
     * world.setVoxel(5, 5, 0, 1); // 在 (5,5,0) 放置 ID=1
     * world.getVoxel(5, 5, 0);    // → 1
     * ```
     */
    setVoxel(wx, wy, wz, voxelId) {
        if (wz < 0 || wz >= CHUNK_SIZE) return false;

        const { cx, cy } = worldToChunk(wx, wy);
        const chunk = this.getOrCreateChunk(cx, cy);
        const { lx, ly } = worldToLocal(wx, wy);
        return chunk.setVoxel(lx, ly, wz, voxelId);
    }

    // ==================== 视口遍历 ====================

    /**
     * 以 (cx, cy) 为中心、radius 为半径遍历所有已加载的 Chunk。
     *
     * 遍历顺序：从左到右、从下到上（行主序），不保证跨行顺序。
     * radius = 0 时只遍历中心 Chunk。
     *
     * **注意**：此方法**不会**自动创建 Chunk。只遍历 `getChunk()` 返回
     * 非 `null` 的 Chunk。
     *
     * @param {number} cx - 中心 Chunk X
     * @param {number} cy - 中心 Chunk Y
     * @param {number} radius - 遍历半径（Chunk 单位，≥ 0）
     * @param {function(Chunk): void} callback - 每个 Chunk 的回调
     *
     * @example
     * ```js
     * const world = new VoxelWorld();
     * world.getOrCreateChunk(0, 0);
     * world.getOrCreateChunk(1, 0);
     *
     * const visited = [];
     * world.forEachChunkInView(0, 0, 1, (chunk) => {
     *   visited.push(chunk.getChunkCoord());
     * });
     * // visited → [{ cx: 0, cy: 0 }, { cx: 1, cy: 0 }, ...]
     * ```
     */
    forEachChunkInView(cx, cy, radius, callback) {
        const minCX = cx - radius;
        const maxCX = cx + radius;
        const minCY = cy - radius;
        const maxCY = cy + radius;

        for (let rcx = minCX; rcx <= maxCX; rcx++) {
            for (let rcy = minCY; rcy <= maxCY; rcy++) {
                const chunk = this.getChunk(rcx, rcy);
                if (chunk) {
                    callback(chunk);
                }
            }
        }
    }

    /**
     * 遍历指定 Chunk 内所有非空气体素。
     *
     * 按 z-major 顺序（竖向柱优先）遍历，确保同一 (lx, ly) 的
     * 所有 lz 被连续访问，利于渲染管线批量处理。
     *
     * @param {number} cx - Chunk X
     * @param {number} cy - Chunk Y
     * @param {function(wx: number, wy: number, wz: number, voxelId: number): void} callback
     *        非空体素回调。参数为世界坐标和体素 ID。
     * @returns {number} 遍历到的非空体素数量
     *
     * @example
     * ```js
     * const world = new VoxelWorld();
     * world.setVoxel(0, 0, 0, 1);
     * world.setVoxel(0, 0, 1, 2);
     *
     * let count = 0;
     * world.forEachVoxelInChunk(0, 0, (wx, wy, wz, id) => {
     *   count++;
     * });
     * // count → 2
     * ```
     */
    forEachVoxelInChunk(cx, cy, callback) {
        const chunk = this.getChunk(cx, cy);
        if (!chunk) return 0;

        const rawData = chunk.getRawData();
        const baseWX = cx * CHUNK_SIZE;
        const baseWY = cy * CHUNK_SIZE;
        let count = 0;

        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const wx = baseWX + lx;
            for (let ly = 0; ly < CHUNK_SIZE; ly++) {
                const wy = baseWY + ly;
                const baseIndex = lx * CHUNK_SIZE * CHUNK_SIZE + ly * CHUNK_SIZE;
                for (let lz = 0; lz < CHUNK_SIZE; lz++) {
                    const voxelId = rawData[baseIndex + lz];
                    if (voxelId !== 0) {
                        callback(wx, wy, lz, voxelId);
                        count++;
                    }
                }
            }
        }

        return count;
    }

    // ==================== 存档 ====================

    /**
     * 将整个世界序列化为 ArrayBuffer。
     *
     * 格式（紧凑二进制）：
     * ```
     * [4 bytes] 魔数 "VOXW"
     * [4 bytes] 种子 (Int32)
     * [4 bytes] Chunk 数量 (Int32)
     *   ┌─ 每个 Chunk：
     *   │  [4 bytes] cx (Int32)
     *   │  [4 bytes] cy (Int32)
     *   │  [8192 bytes] Uint16Array(4096) 体素数据
     *   └─
     * ```
     *
     * @returns {ArrayBuffer}
     *
     * @example
     * ```js
     * const buffer = world.serialize();
     * // buffer.byteLength = 12 + chunks.size * (8 + 8192)
     * ```
     */
    serialize() {
        const MAGIC = 0x564F5857; // "VOXW" (little-endian: 'V','O','X','W')
        const HEADER_SIZE = 12; // 魔数(4) + 种子(4) + Chunk数量(4)
        const CHUNK_DATA_SIZE = 8 + 8192; // cx(4) + cy(4) + data(8192)
        const chunkCount = this._chunks.size;
        const buffer = new ArrayBuffer(HEADER_SIZE + chunkCount * CHUNK_DATA_SIZE);
        const view = new DataView(buffer);
        let offset = 0;

        // 写入头部
        view.setUint32(offset, MAGIC, true); offset += 4;
        view.setInt32(offset, this._seed, true); offset += 4;
        view.setInt32(offset, chunkCount, true); offset += 4;

        // 写入每个 Chunk
        for (const [, chunk] of this._chunks) {
            const { cx, cy } = chunk.getChunkCoord();
            view.setInt32(offset, cx, true); offset += 4;
            view.setInt32(offset, cy, true); offset += 4;

            const rawData = chunk.getRawData();
            new Uint16Array(buffer, offset, CHUNK_VOLUME).set(rawData);
            offset += 8192; // 4096 * 2 bytes
        }

        return buffer;
    }

    /**
     * 从 ArrayBuffer 恢复整个世界。
     *
     * @param {ArrayBuffer} buffer - 由 `serialize()` 生成的存档数据
     * @returns {boolean} 反序列化是否成功
     *
     * @example
     * ```js
     * const buffer = world.serialize();
     * const newWorld = new VoxelWorld();
     * newWorld.deserialize(buffer);
     * ```
     */
    deserialize(buffer) {
        const MAGIC = 0x564F5857;
        const HEADER_SIZE = 12;
        const CHUNK_DATA_SIZE = 8 + 8192;

        if (buffer.byteLength < HEADER_SIZE) {
            console.error('[VoxelWorld] 反序列化失败：数据过短');
            return false;
        }

        const view = new DataView(buffer);

        // 验证魔数
        const magic = view.getUint32(0, true);
        if (magic !== MAGIC) {
            console.error('[VoxelWorld] 反序列化失败：魔数不匹配');
            return false;
        }

        // 清空当前世界
        this._chunks.clear();

        // 读取头部
        this._seed = view.getInt32(4, true);
        const chunkCount = view.getInt32(8, true);

        // 验证数据长度
        const expectedSize = HEADER_SIZE + chunkCount * CHUNK_DATA_SIZE;
        if (buffer.byteLength < expectedSize) {
            console.error('[VoxelWorld] 反序列化失败：数据长度不足');
            return false;
        }

        let offset = HEADER_SIZE;

        for (let i = 0; i < chunkCount; i++) {
            const cx = view.getInt32(offset, true); offset += 4;
            const cy = view.getInt32(offset, true); offset += 4;

            const data = new Uint16Array(buffer, offset, CHUNK_VOLUME);
            // Uint16Array 的 TypedArray 构造函数只拷贝视图内的元素
            const chunkData = new Uint16Array(CHUNK_VOLUME);
            chunkData.set(data);
            offset += 8192;

            const chunk = new Chunk(cx, cy, chunkData);
            chunk.clearDirty(); // 从存档恢复的数据标记为"不脏"
            this._chunks.set(chunkKey(cx, cy), chunk);
        }

        return true;
    }

    // ==================== 统计与清理 ====================

    /**
     * 当前已加载的 Chunk 数量。
     *
     * @returns {number}
     */
    get loadedChunkCount() {
        return this._chunks.size;
    }

    /**
     * 统计所有已加载 Chunk 中的非空气体素总数。
     *
     * @returns {number}
     */
    get totalVoxelCount() {
        let total = 0;
        for (const [, chunk] of this._chunks) {
            total += chunk.getVoxelCount();
        }
        return total;
    }

    /**
     * 清除所有 Chunk 并重置状态。
     */
    clear() {
        this._chunks.clear();
    }

    /**
     * 获取随机种子。
     *
     * @returns {number}
     */
    get seed() {
        return this._seed;
    }
}
