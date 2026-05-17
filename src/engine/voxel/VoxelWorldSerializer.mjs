// @ts-check

/**
 * @fileoverview VoxelWorld 序列化/反序列化工具。
 *
 * 将世界的 Chunk 数据和种子编码为紧凑二进制格式：
 * ```
 * [4 bytes] 魔数 "VOXW" (0x564F5857)
 * [4 bytes] 种子 (Int32LE)
 * [4 bytes] Chunk 数量 (Int32LE)
 *   ┌─ 每个 Chunk：
 *   │  [4 bytes] cx (Int32LE)
 *   │  [4 bytes] cy (Int32LE)
 *   │  [8192 bytes] Uint16Array(4096) 体素数据
 *   └─
 * ```
 *
 * @module voxel/VoxelWorldSerializer
 */

import { Chunk } from './Chunk.mjs';
import { CHUNK_VOLUME, chunkKey } from './ChunkCoordUtils.mjs';

const MAGIC = 0x564F5857; // "VOXW"
const HEADER_SIZE = 12;
const CHUNK_DATA_SIZE = 8 + 8192; // cx(4) + cy(4) + data(8192)

/**
 * VoxelWorld 序列化工具（纯静态方法）。
 */
export class VoxelWorldSerializer {
    /**
     * 将 VoxelWorld 序列化为 ArrayBuffer。
     * @param {import('./VoxelWorld.mjs').VoxelWorld} world
     * @returns {ArrayBuffer}
     */
    static serialize(world) {
        const chunkCount = world._chunks.size;
        const buffer = new ArrayBuffer(HEADER_SIZE + chunkCount * CHUNK_DATA_SIZE);
        const view = new DataView(buffer);
        let offset = 0;

        view.setUint32(offset, MAGIC, true); offset += 4;
        view.setInt32(offset, world._seed, true); offset += 4;
        view.setInt32(offset, chunkCount, true); offset += 4;

        for (const [, chunk] of world._chunks) {
            const { cx, cy } = chunk.getChunkCoord();
            view.setInt32(offset, cx, true); offset += 4;
            view.setInt32(offset, cy, true); offset += 4;
            new Uint16Array(buffer, offset, CHUNK_VOLUME).set(chunk.getRawData());
            offset += 8192;
        }

        return buffer;
    }

    /**
     * 从 ArrayBuffer 恢复 VoxelWorld 状态。
     * @param {import('./VoxelWorld.mjs').VoxelWorld} world
     * @param {ArrayBuffer} buffer
     * @returns {boolean} 反序列化是否成功
     */
    static deserialize(world, buffer) {
        if (buffer.byteLength < HEADER_SIZE) {
            console.error('[VoxelWorld] 反序列化失败：数据过短');
            return false;
        }

        const view = new DataView(buffer);
        if (view.getUint32(0, true) !== MAGIC) {
            console.error('[VoxelWorld] 反序列化失败：魔数不匹配');
            return false;
        }

        world._chunks.clear();
        world._seed = view.getInt32(4, true);
        const chunkCount = view.getInt32(8, true);

        const expectedSize = HEADER_SIZE + chunkCount * CHUNK_DATA_SIZE;
        if (buffer.byteLength < expectedSize) {
            console.error('[VoxelWorld] 反序列化失败：数据长度不足');
            return false;
        }

        let offset = HEADER_SIZE;
        for (let i = 0; i < chunkCount; i++) {
            const cx = view.getInt32(offset, true); offset += 4;
            const cy = view.getInt32(offset, true); offset += 4;
            const chunkData = new Uint16Array(buffer, offset, CHUNK_VOLUME).slice();
            offset += 8192;

            const chunk = new Chunk(cx, cy, chunkData);
            chunk.clearDirty();
            world._chunks.set(chunkKey(cx, cy), chunk);
        }

        return true;
    }
}
