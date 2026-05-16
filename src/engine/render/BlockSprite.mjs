// @ts-check

/**
 * @fileoverview
 * 【兼容桥】旧路径转发模块。
 *
 * 重组后 BlockSprite 及其相关常量/数据已迁移至 `src/engine/render/block/` 子目录。
 * 此文件保留在原路径作为 re-export 桥接，确保所有现有导入路径不中断。
 *
 * 新代码请直接导入 `src/engine/render/block/BlockSprite.mjs`。
 *
 * @module render/BlockSprite
 */

export { BlockSprite } from './block/BlockSprite.mjs';
export {
    TILE_W,
    TILE_H,
    TILE_HALF_W,
    TILE_HALF_H,
    Z_BASE,
    BLOCK_TOP_OFFSET,
    TEXTURE_SCALE_X,
    TEXTURE_SCALE_Y,
    SRC_TILE_W,
    SRC_TILE_H,
    ROTATED_SIZE,
    TOP_HEIGHT,
    SIDE_WIDTH,
    SIDE_HEIGHT,
    SHEAR_OFFSET
} from './block/BlockConstants.mjs';
export { BLOCK_TEXTURE_MAP } from './block/BlockTextureMap.mjs';
