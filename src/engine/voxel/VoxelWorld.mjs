// @ts-check

/**
 * @fileoverview 体素世界 —— Chunk 容器，提供世界坐标下的体素读写。
 * - 管理所有已加载的 Chunk 实例（Map<cx,cy, Chunk>）
 * - 世界坐标 ↔ Chunk 坐标自动转换
 * - 懒加载：读/写未加载 Chunk 时自动创建
 * - 视口遍历与序列化存档
 * @module voxel/VoxelWorld
 */

import { Chunk } from './Chunk.mjs';
import { CHUNK_SIZE, worldToChunk, worldToLocal, chunkKey } from './ChunkCoordUtils.mjs';
import { VoxelWorldSerializer } from './VoxelWorldSerializer.mjs';

/**
 * 体素世界管理器。
 */
export class VoxelWorld {
    /** @param {number} [seed=0] */
    constructor(seed = 0) {
        /** @private @type {Map<string, Chunk>} */ this._chunks = new Map();
        /** @private @type {number} */ this._seed = seed;
    }

    // ==================== Chunk 管理 ====================

    /** 获取 Chunk，不存在则自动创建（懒加载）。@param {number} cx @param {number} cy @returns {Chunk} */
    getOrCreateChunk(cx, cy) {
        const key = chunkKey(cx, cy);
        if (this._chunks.has(key)) return /** @type {Chunk} */ (this._chunks.get(key));
        const chunk = new Chunk(cx, cy);
        this._chunks.set(key, chunk);
        return chunk;
    }

    /** 获取 Chunk，不存在返回 null。@param {number} cx @param {number} cy @returns {Chunk|null} */
    getChunk(cx, cy) {
        return this._chunks.get(chunkKey(cx, cy)) || null;
    }

    /** @param {number} cx @param {number} cy @returns {boolean} */
    hasChunk(cx, cy) {
        return this._chunks.has(chunkKey(cx, cy));
    }

    /** 移除 Chunk。@param {number} cx @param {number} cy @returns {Chunk|null} */
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

    /** 获取世界坐标处体素 ID。wz 越界返回 0。@param {number} wx @param {number} wy @param {number} wz @returns {number} */
    getVoxel(wx, wy, wz) {
        if (wz < 0 || wz >= CHUNK_SIZE) return 0;
        const { cx, cy } = worldToChunk(wx, wy);
        const chunk = this._chunks.get(chunkKey(cx, cy));
        if (!chunk) return 0;
        const { lx, ly } = worldToLocal(wx, wy);
        return chunk.getVoxel(lx, ly, wz);
    }

    /** 设置世界坐标处体素 ID。wz 越界忽略，自动创建 Chunk。@param {number} wx @param {number} wy @param {number} wz @param {number} voxelId @returns {boolean} */
    setVoxel(wx, wy, wz, voxelId) {
        if (wz < 0 || wz >= CHUNK_SIZE) return false;
        const { cx, cy } = worldToChunk(wx, wy);
        const chunk = this.getOrCreateChunk(cx, cy);
        const { lx, ly } = worldToLocal(wx, wy);
        return chunk.setVoxel(lx, ly, wz, voxelId);
    }

    // ==================== 视口遍历 ====================

    /** 以 (cx,cy) 为中心、radius 半径遍历已加载 Chunk。不自动创建。@param {number} cx @param {number} cy @param {number} radius @param {function(Chunk): void} callback */
    forEachChunkInView(cx, cy, radius, callback) {
        const minCX = cx - radius, maxCX = cx + radius;
        const minCY = cy - radius, maxCY = cy + radius;
        for (let rcx = minCX; rcx <= maxCX; rcx++) {
            for (let rcy = minCY; rcy <= maxCY; rcy++) {
                const chunk = this.getChunk(rcx, rcy);
                if (chunk) callback(chunk);
            }
        }
    }

    /** 遍历 Chunk 内所有非空气体素（z-major 顺序）。
     * @param {number} cx @param {number} cy
     * @param {function(wx: number, wy: number, wz: number, voxelId: number): void} callback
     * @returns {number} 非空体素数量 */
    forEachVoxelInChunk(cx, cy, callback) {
        const chunk = this.getChunk(cx, cy);
        if (!chunk) return 0;
        const rawData = chunk.getRawData();
        const baseWX = cx * CHUNK_SIZE, baseWY = cy * CHUNK_SIZE;
        let count = 0;
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const wx = baseWX + lx;
            for (let ly = 0; ly < CHUNK_SIZE; ly++) {
                const wy = baseWY + ly;
                const baseIndex = lx * CHUNK_SIZE * CHUNK_SIZE + ly * CHUNK_SIZE;
                for (let lz = 0; lz < CHUNK_SIZE; lz++) {
                    const id = rawData[baseIndex + lz];
                    if (id !== 0) { callback(wx, wy, lz, id); count++; }
                }
            }
        }
        return count;
    }

    // ==================== 存档 ====================

    /** 序列化为 ArrayBuffer。@returns {ArrayBuffer} */
    serialize() { return VoxelWorldSerializer.serialize(this); }

    /** 从 ArrayBuffer 恢复。@param {ArrayBuffer} buffer @returns {boolean} */
    deserialize(buffer) { return VoxelWorldSerializer.deserialize(this, buffer); }

    // ==================== 统计与清理 ====================

    /** 已加载 Chunk 数量。@returns {number} */
    get loadedChunkCount() { return this._chunks.size; }

    /** 所有非空气体素总数。@returns {number} */
    get totalVoxelCount() {
        let total = 0;
        for (const [, chunk] of this._chunks) total += chunk.getVoxelCount();
        return total;
    }

    /** 清除所有 Chunk。*/
    clear() { this._chunks.clear(); }

    /** @returns {number} */
    get seed() { return this._seed; }
}
