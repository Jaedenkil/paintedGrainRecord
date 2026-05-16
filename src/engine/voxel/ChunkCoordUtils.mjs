// @ts-check

/**
 * @fileoverview
 * Chunk 坐标系统转换工具（纯函数）。
 *
 * ## 坐标系统
 *
 * | 符号 | 含义 | 范围 |
 * |------|------|------|
 * | (wx, wy, wz) | 世界坐标（水平平面 + 高度） | 任意整数 |
 * | (cx, cy)     | Chunk 坐标（水平平面） | 任意整数 |
 * | (lx, ly, lz) | Chunk 内局部坐标 | [0, 16) |
 *
 * ## Chunk 空间映射
 *
 * 一个 Chunk 覆盖 `CHUNK_SIZE × CHUNK_SIZE × CHUNK_SIZE` 体素：
 * ```
 * wx ∈ [cx * 16, (cx + 1) * 16)
 * wy ∈ [cy * 16, (cy + 1) * 16)
 * wz ∈ [0, 16)
 * ```
 *
 * ## 扁平数组索引（z-major 布局）
 *
 * ```text
 * index = lz + ly * CHUNK_SIZE + lx * CHUNK_SIZE * CHUNK_SIZE
 *       = lz + ly * 16 + lx * 256
 *
 * 同一竖向柱 (lx, ly) 的 16 个体素在内存中连续。
 * ```
 *
 * @module voxel/ChunkCoordUtils
 */

/** Chunk 边长（体素单位） */
export const CHUNK_SIZE = 16;

/** CHUNK_SIZE 的以 2 为底的对数，用于位运算加速 */
export const CHUNK_SIZE_BITS = 4;

/** 低 4 位掩码，用于快速计算局部坐标：`value & CHUNK_SIZE_MASK` */
export const CHUNK_SIZE_MASK = 0x0F;

/** Chunk 体素总数：16³ = 4096 */
export const CHUNK_VOLUME = 4096;

/**
 * 从世界坐标计算 Chunk 坐标。
 *
 * 使用 `Math.floor` 保证负数世界坐标得到正确的 Chunk 坐标：
 * ```
 * wx =  0 → cx = 0
 * wx = 15 → cx = 0
 * wx = 16 → cx = 1
 * wx = -1 → cx = -1
 * ```
 *
 * @param {number} wx - 世界 X 坐标
 * @param {number} wy - 世界 Y 坐标
 * @returns {{ cx: number, cy: number }}
 *
 * @example
 * ```js
 * worldToChunk(0, 0);    // → { cx: 0, cy: 0 }
 * worldToChunk(16, 32);  // → { cx: 1, cy: 2 }
 * worldToChunk(-1, -1);  // → { cx: -1, cy: -1 }
 * ```
 */
export function worldToChunk(wx, wy) {
    return {
        cx: Math.floor(wx / CHUNK_SIZE),
        cy: Math.floor(wy / CHUNK_SIZE)
    };
}

/**
 * 从世界坐标计算 Chunk 内的局部坐标。
 *
 * 使用 `((v % n) + n) % n` 范式保证结果为非负，正确处理负数输入。
 *
 * @param {number} wx - 世界 X 坐标
 * @param {number} wy - 世界 Y 坐标
 * @returns {{ lx: number, ly: number }}
 *
 * @example
 * ```js
 * worldToLocal(0, 0);    // → { lx: 0, ly: 0 }
 * worldToLocal(15, 16);  // → { lx: 15, ly: 0 }
 * worldToLocal(-1, -1);  // → { lx: 15, ly: 15 }
 * ```
 */
export function worldToLocal(wx, wy) {
    return {
        lx: ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
        ly: ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
    };
}

/**
 * 从 Chunk 坐标 + 局部坐标恢复世界坐标。
 *
 * @param {number} cx - Chunk X
 * @param {number} cy - Chunk Y
 * @param {number} lx - 局部 X（应 < CHUNK_SIZE）
 * @param {number} ly - 局部 Y（应 < CHUNK_SIZE）
 * @returns {{ wx: number, wy: number }}
 *
 * @example
 * ```js
 * localToWorld(0, 0, 5, 7);   // → { wx: 5, wy: 7 }
 * localToWorld(1, -1, 0, 15); // → { wx: 16, wy: -1 }
 * ```
 */
export function localToWorld(cx, cy, lx, ly) {
    return {
        wx: cx * CHUNK_SIZE + lx,
        wy: cy * CHUNK_SIZE + ly
    };
}

/**
 * 将 (lx, ly, lz) 转换为 Chunk 扁平数组的索引。
 *
 * 使用 z-major 布局：同一 (lx, ly) 的 lz 连续排列。
 * 这使渲染时遍历竖向柱只需要一次缓存行加载。
 *
 * @param {number} lx - 局部 X [0, 16)
 * @param {number} ly - 局部 Y [0, 16)
 * @param {number} lz - 局部 Z [0, 16)
 * @returns {number} [0, 4096)
 *
 * @example
 * ```js
 * localToIndex(0, 0, 0);  // → 0
 * localToIndex(0, 0, 1);  // → 1
 * localToIndex(0, 1, 0);  // → 16
 * localToIndex(1, 0, 0);  // → 256
 * ```
 */
export function localToIndex(lx, ly, lz) {
    return lz + ly * CHUNK_SIZE + lx * CHUNK_SIZE * CHUNK_SIZE;
}

/**
 * 将 Chunk 扁平数组的索引反解为 (lx, ly, lz)。
 *
 * @param {number} index - [0, 4096)
 * @returns {{ lx: number, ly: number, lz: number }}
 *
 * @example
 * ```js
 * indexToLocal(0);    // → { lx: 0, ly: 0, lz: 0 }
 * indexToLocal(1);    // → { lx: 0, ly: 0, lz: 1 }
 * indexToLocal(16);   // → { lx: 0, ly: 1, lz: 0 }
 * indexToLocal(256);  // → { lx: 1, ly: 0, lz: 0 }
 * indexToLocal(4095); // → { lx: 15, ly: 15, lz: 15 }
 * ```
 */
export function indexToLocal(index) {
    const lx = Math.floor(index / (CHUNK_SIZE * CHUNK_SIZE));
    const remainder = index - lx * CHUNK_SIZE * CHUNK_SIZE;
    const ly = Math.floor(remainder / CHUNK_SIZE);
    const lz = remainder - ly * CHUNK_SIZE;
    return { lx, ly, lz };
}

/**
 * 检查局部坐标是否在 Chunk 范围内。
 *
 * @param {number} lx
 * @param {number} ly
 * @param {number} lz
 * @returns {boolean}
 *
 * @example
 * ```js
 * isInBounds(0, 0, 0);    // → true
 * isInBounds(15, 15, 15); // → true
 * isInBounds(16, 0, 0);   // → false
 * isInBounds(-1, 0, 0);   // → false
 * ```
 */
export function isInBounds(lx, ly, lz) {
    return lx >= 0 && lx < CHUNK_SIZE
        && ly >= 0 && ly < CHUNK_SIZE
        && lz >= 0 && lz < CHUNK_SIZE;
}

/**
 * 生成 Chunk 的字符串键，用作 Map 的 key。
 *
 * 格式：`"cx,cy"`，无空格，兼容负数。
 *
 * @param {number} cx - Chunk X
 * @param {number} cy - Chunk Y
 * @returns {string}
 *
 * @example
 * ```js
 * chunkKey(0, 0);    // → "0,0"
 * chunkKey(-1, 5);   // → "-1,5"
 * ```
 */
export function chunkKey(cx, cy) {
    return `${cx},${cy}`;
}
