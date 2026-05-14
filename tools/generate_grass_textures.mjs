// @ts-check
/**
 * 草地块纹理生成脚本
 *
 * 用纯 Node.js（无外部依赖）生成三张 16×16 RGBA PNG 纹理：
 * - block_grass_top.png    — 顶面菱形（绿色草地）
 * - block_grass_left.png   — 左面平行四边形（草+泥土）
 * - block_grass_right.png  — 右面平行四边形（草+泥土）
 * 
 * 运行：node tools/generate_grass_textures.mjs
 * 
 * 输出：assets/blocks/grass/
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../assets/blocks/grass');

// ==================== PNG 编码工具 ====================

/** 将 32 位整数写入大端序 4 字节 */
function writeUint32BE(buf, offset, val) {
    buf[offset]     = (val >>> 24) & 0xFF;
    buf[offset + 1] = (val >>> 16) & 0xFF;
    buf[offset + 2] = (val >>> 8)  & 0xFF;
    buf[offset + 3] = val & 0xFF;
}

/**
 * 创建一个 PNG 文件 buffer
 * @param {number} w - 宽度
 * @param {number} h - 高度
 * @param {Buffer} pixelData - 原始 RGBA 像素数据（不含 filter bytes）
 * @returns {Buffer} 完整的 PNG 文件
 */
function encodePNG(w, h, pixelData) {
    const rawRowLen = w * 4; // 每行 RGBA 字节数
    
    // 1. 构造过滤后的数据（每行前加 filter byte = 0）
    const filtered = Buffer.alloc(h * (rawRowLen + 1));
    for (let y = 0; y < h; y++) {
        const rowOffset = y * (rawRowLen + 1);
        filtered[rowOffset] = 0; // filter type: None
        pixelData.copy(filtered, rowOffset + 1, y * rawRowLen, (y + 1) * rawRowLen);
    }
    
    // 2. zlib 压缩
    const compressed = zlib.deflateSync(filtered);
    
    // 3. 组装 PNG
    const chunks = [];
    
    // IHDR
    const ihdrData = Buffer.alloc(13);
    writeUint32BE(ihdrData, 0, w);
    writeUint32BE(ihdrData, 4, h);
    ihdrData[8]  = 8;  // bit depth
    ihdrData[9]  = 6;  // color type: RGBA
    ihdrData[10] = 0;  // compression
    ihdrData[11] = 0;  // filter
    ihdrData[12] = 0;  // interlace
    chunks.push(createChunk('IHDR', ihdrData));
    
    // IDAT
    chunks.push(createChunk('IDAT', compressed));
    
    // IEND
    chunks.push(createChunk('IEND', Buffer.alloc(0)));
    
    // 计算总大小
    let totalLen = 8; // PNG signature
    for (const c of chunks) {
        totalLen += c.length;
    }
    
    const result = Buffer.alloc(totalLen);
    let offset = 0;
    
    // PNG signature
    result[0] = 0x89;
    result[1] = 0x50; // P
    result[2] = 0x4E; // N
    result[3] = 0x47; // G
    result[4] = 0x0D;
    result[5] = 0x0A;
    result[6] = 0x1A;
    result[7] = 0x0A;
    offset = 8;
    
    for (const c of chunks) {
        c.copy(result, offset);
        offset += c.length;
    }
    
    return result;
}

/**
 * 创建一个 PNG chunk（length + type + data + CRC）
 * @param {string} type - 4 字符类型名
 * @param {Buffer} data - chunk 数据
 * @returns {Buffer}
 */
function createChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const crcInput = Buffer.concat([typeBuf, data]);
    const crc = crc32(crcInput);
    
    const chunk = Buffer.alloc(4 + 4 + data.length + 4);
    writeUint32BE(chunk, 0, data.length);
    typeBuf.copy(chunk, 4);
    data.copy(chunk, 8);
    writeUint32BE(chunk, 8 + data.length, crc >>> 0);
    
    return chunk;
}

/** CRC-32 查表法 */
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ==================== 像素绘制工具 ====================

/**
 * 检查像素是否在菱形的内部
 * 菱形顶点：left(w/2, 0), top(0, h/2), right(w/2, h), bottom(w, h/2)
 * 实际上是 45° 旋转的正方形
 */
function inDiamond(x, y, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    // 菱形：|x-cx|/halfW + |y-cy|/halfH <= 1
    const hw = w / 2;
    const hh = h / 2;
    return (Math.abs(x - cx) / hw + Math.abs(y - cy) / hh) <= 1.0;
}

/**
 * 检查像素是否在左平行四边形内（等轴左面）
 */
function inLeftParallelogram(x, y, w, h) {
    // 左平行四边形：顶部边缘从 (w*0.25, 0) 到 (w*0.75, 0)，底部从 (0, h) 到 (w*0.5, h)
    // 左侧边缘是垂直的？不对，在等轴投影中，左面的左侧边缘是斜的
    // 更准确：左面范围在容器坐标系中是从 (-w/2, 0) 到 (0, h)
    // 映射到纹理坐标系 (0,0) = 容器 (-w/2, 0)，(w, h) = 容器 (w/2, h)
    // 左面顶点在纹理中：左上(w/4, 0)，右上(3w/4, 0)，右下(w, h)，左下(w/4, h)
    
    const leftX   = w * 0.25;
    const rightX  = w;
    const topY    = 0;
    const botY    = h;
    const midTopX = w * 0.75;
    
    // 检查点是否在四边形内（简单射线法或边界比较）
    // 左边缘：从 (leftX, topY) 到 (leftX, botY) — 垂直
    // 上边缘：从 (leftX, topY) 到 (midTopX, topY) — 水平
    // 右边缘：从 (midTopX, topY) 到 (rightX, botY) — 斜线
    // 下边缘：从 (rightX, botY) 到 (leftX, botY) — 水平？不对
    
    // 实际上，这是一个梯形：左边缘垂直，上边缘水平，右边缘斜线
    // 梯形顶点：(leftX, topY), (midTopX, topY), (rightX, botY), (leftX, botY)
    
    if (x < leftX || x > rightX || y < topY || y > botY) return false;
    if (y === botY) return x >= leftX && x <= rightX;
    if (y === topY) return x >= leftX && x <= midTopX;
    
    // 右边缘是斜线：从 (midTopX, topY) 到 (rightX, botY)
    const rightEdgeX = midTopX + (x - midTopX) * (botY - topY) / (y - topY + 0.001);
    // 不对，应该根据 y 计算右边缘的 x
    const t = (y - topY) / (botY - topY);
    const rEdge = midTopX + (rightX - midTopX) * t;
    
    return x >= leftX && x <= rEdge;
}

/**
 * 检查像素是否在右平行四边形内（等轴右面）
 */
function inRightParallelogram(x, y, w, h) {
    // 右面：与左面对称
    // 右面顶点：左上(0, 0)，右上(w*0.75, 0)，右下(w*0.5, h)，左下(0, h)
    // 不对...在容器坐标系中右面范围是从 (0, 0) 到 (w/2, h)
    // 映射到纹理：(0,0) = 容器(0, 0)，(w, h) = 容器(w, h)
    // 右面顶点在纹理中：左上(0, 0)，右上(w*0.75, 0)，右下(w*0.5, h)，左下(0, h)
    
    const leftX   = 0;
    const rightX  = w * 0.75;
    const topY    = 0;
    const botY    = h;
    
    if (x < leftX || x > rightX || y < topY || y > botY) return false;
    
    // 上边缘：从 (0, 0) 到 (rightX, 0) — 水平
    // 下边缘：从 (0, h) 到 (w*0.5, h) — 水平
    // 左边缘：垂直
    // 右边缘：斜线从 (rightX, 0) 到 (w*0.5, h)
    
    if (y === topY) return x >= leftX && x <= rightX;
    if (y === botY) return x >= leftX && x <= w * 0.5;
    
    const t = (y - topY) / (botY - topY);
    const rEdge = rightX + (w * 0.5 - rightX) * t;
    
    return x >= leftX && x <= rEdge;
}

// ==================== 调色板 ====================

const COLOR = {
    // 草地绿色系
    GRASS_LIGHT:  [0x7C, 0xBF, 0x4A, 0xFF], // 亮绿
    GRASS_MID:    [0x5A, 0xA0, 0x34, 0xFF], // 中绿
    GRASS_DARK:   [0x3D, 0x7A, 0x22, 0xFF], // 暗绿
    GRASS_EDGE:   [0x4C, 0x8C, 0x2A, 0xFF], // 边缘绿
    
    // 泥土棕色系
    DIRT_LIGHT:   [0x8B, 0x6D, 0x4A, 0xFF],
    DIRT_MID:     [0x6B, 0x4F, 0x32, 0xFF],
    DIRT_DARK:    [0x4A, 0x35, 0x20, 0xFF],
    DIRT_SPECKLE: [0x5A, 0x42, 0x2A, 0xFF],
    
    // 透明
    TRANSPARENT:  [0x00, 0x00, 0x00, 0x00],
};

// ==================== 生成顶面纹理 ====================

function generateTopTexture(w, h) {
    const pixels = Buffer.alloc(w * h * 4);
    
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            
            if (!inDiamond(x, y, w, h)) {
                pixels.set(COLOR.TRANSPARENT, idx);
                continue;
            }
            
            // 菱形内部 — 草地纹理
            // 基于位置和简单噪声生成变化
            const cx = w / 2, cy = h / 2;
            const dx = Math.abs(x - cx) / (w / 2);
            const dy = Math.abs(y - cy) / (h / 2);
            const dist = dx + dy; // 0~1
            
            // 边缘暗一些
            const pseudoRand = ((x * 7 + y * 13) % 5) / 5;
            
            if (dist > 0.85) {
                pixels.set(COLOR.GRASS_EDGE, idx);
            } else if (pseudoRand < 0.2) {
                pixels.set(COLOR.GRASS_DARK, idx);
            } else if (pseudoRand < 0.6) {
                pixels.set(COLOR.GRASS_MID, idx);
            } else {
                pixels.set(COLOR.GRASS_LIGHT, idx);
            }
            
            // 边缘抗锯齿（半透明过渡）
            if (dist > 0.92) {
                const alpha = Math.max(0, 1 - (dist - 0.92) / 0.08);
                pixels[idx + 3] = Math.floor(alpha * 255);
            }
        }
    }
    
    return pixels;
}

// ==================== 生成左面纹理 ====================

function generateLeftTexture(w, h) {
    const pixels = Buffer.alloc(w * h * 4);
    
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            
            if (!inLeftParallelogram(x, y, w, h)) {
                pixels.set(COLOR.TRANSPARENT, idx);
                continue;
            }
            
            // 左面纹理：上部草（约 25%），下部泥土（约 75%）
            const grassHeight = h * 0.25;
            const pseudoRand = ((x * 11 + y * 17) % 7) / 7;
            
            if (y < grassHeight) {
                // 草地区域
                if (pseudoRand < 0.3) {
                    pixels.set(COLOR.GRASS_DARK, idx);
                } else if (pseudoRand < 0.7) {
                    pixels.set(COLOR.GRASS_MID, idx);
                } else {
                    pixels.set(COLOR.GRASS_LIGHT, idx);
                }
            } else {
                // 泥土区域
                if (pseudoRand < 0.15) {
                    pixels.set(COLOR.DIRT_SPECKLE, idx);
                } else if (pseudoRand < 0.4) {
                    pixels.set(COLOR.DIRT_DARK, idx);
                } else if (pseudoRand < 0.75) {
                    pixels.set(COLOR.DIRT_MID, idx);
                } else {
                    pixels.set(COLOR.DIRT_LIGHT, idx);
                }
            }
            
            // 边缘抗锯齿（右边缘斜线）
            // 简化处理：右边缘附近渐变透明
            if (x > w * 0.7) {
                const t = (x - w * 0.7) / (w * 0.3);
                // 根据 y 计算是否在边缘附近
                const edgeX = w * 0.75 + (w * 0.25) * (y / h); // 从 0.75w 到 1.0w
                const edgeDist = Math.abs(x - edgeX);
                if (edgeDist < 2) {
                    const alpha = Math.max(0, Math.min(1, edgeDist / 2));
                    pixels[idx + 3] = Math.floor(alpha * 255);
                }
            }
        }
    }
    
    return pixels;
}

// ==================== 生成右面纹理 ====================

function generateRightTexture(w, h) {
    const pixels = Buffer.alloc(w * h * 4);
    
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            
            if (!inRightParallelogram(x, y, w, h)) {
                pixels.set(COLOR.TRANSPARENT, idx);
                continue;
            }
            
            const grassHeight = h * 0.25;
            const pseudoRand = ((x * 13 + y * 19) % 7) / 7;
            
            if (y < grassHeight) {
                if (pseudoRand < 0.3) {
                    pixels.set(COLOR.GRASS_DARK, idx);
                } else if (pseudoRand < 0.7) {
                    pixels.set(COLOR.GRASS_MID, idx);
                } else {
                    pixels.set(COLOR.GRASS_LIGHT, idx);
                }
            } else {
                if (pseudoRand < 0.15) {
                    pixels.set(COLOR.DIRT_SPECKLE, idx);
                } else if (pseudoRand < 0.4) {
                    pixels.set(COLOR.DIRT_DARK, idx);
                } else if (pseudoRand < 0.75) {
                    pixels.set(COLOR.DIRT_MID, idx);
                } else {
                    pixels.set(COLOR.DIRT_LIGHT, idx);
                }
            }
        }
    }
    
    return pixels;
}

// ==================== 主流程 ====================

const W = 16;
const H = 16;

console.log('正在生成草地块纹理...');

// 顶面
const topPixels = generateTopTexture(W, H);
const topPNG = encodePNG(W, H, topPixels);
fs.writeFileSync(path.join(OUT_DIR, 'block_grass_top.png'), topPNG);
console.log(`  ✅ block_grass_top.png    (${topPNG.length} bytes)`);

// 左面
const leftPixels = generateLeftTexture(W, H);
const leftPNG = encodePNG(W, H, leftPixels);
fs.writeFileSync(path.join(OUT_DIR, 'block_grass_left.png'), leftPNG);
console.log(`  ✅ block_grass_left.png   (${leftPNG.length} bytes)`);

// 右面
const rightPixels = generateRightTexture(W, H);
const rightPNG = encodePNG(W, H, rightPixels);
fs.writeFileSync(path.join(OUT_DIR, 'block_grass_right.png'), rightPNG);
console.log(`  ✅ block_grass_right.png  (${rightPNG.length} bytes)`);

console.log('\n纹理生成完成！');
