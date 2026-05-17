// @ts-check

/**
 * @fileoverview
 * 等轴方块纹理变换常量 — 从 IsoTextureTransformer 提取的纯常量模块。
 *
 * 所有尺寸常量均基于 16×16 源纹理和 45° 等轴投影几何推导。
 *
 * @module loader/IsoTexConstants
 */

/** 源纹理标准尺寸（像素） */
export const SRC_SIZE = 16;

/**
 * 45° 旋转后的外接画布边长。
 *
 * 数学上 16√2 ≈ 22.627，ceil 为 23。此处设为 24 是为了使菱形几何宽度
 * （ROTATED_SIZE=24）与侧面宽度（SIDE_WIDTH=12 × 2=24）完全匹配，
 * 消除顶面与侧面接缝处的 1px 间隙。
 * 多出的 1px 由 expandTopFaceEdges 在压缩后填充。
 */
export const ROTATED_SIZE = 24;

/** 压缩后的顶面高度：ceil(ROTATED_SIZE * 0.5) = 12 */
export const TOP_HEIGHT = 12;

/**
 * 侧面平行四边形宽度。
 *
 * 几何计算：对角线 sqrt(128) ≈ 11.314 → ceil 得 12。
 * 此值决定了 16×16 源纹理经水平压缩加剪切后，在等轴投影中的可见宽度。
 */
export const SIDE_WIDTH = 12;

/** 侧面平行四边形剪切偏移量：sqrt(128) / 2 ≈ 5.657 */
export const SHEAR_OFFSET = Math.sqrt(128) / 2;

/**
 * 侧面平行四边形输出高度。
 * 公式：floor(SRC_SIZE + SHEAR_OFFSET) = floor(21.657) = 21
 */
export const SIDE_HEIGHT = Math.floor(SRC_SIZE + SHEAR_OFFSET);

/** 装配后的预期总宽度：与 ROTATED_SIZE 一致 */
export const BLOCK_WIDTH = ROTATED_SIZE; // 24

/** 装配后的预期总高度：TOP_HEIGHT + SIDE_HEIGHT - 1 = 32 */
export const BLOCK_HEIGHT = TOP_HEIGHT + SIDE_HEIGHT - 1;

/** @private 角度常量：cos(45°) */
export const COS45 = Math.cos(Math.PI / 4);

/** @private 角度常量：sin(45°) */
export const SIN45 = Math.sin(Math.PI / 4);
