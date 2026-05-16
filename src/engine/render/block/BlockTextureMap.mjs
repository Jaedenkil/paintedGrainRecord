// @ts-check

/**
 * @fileoverview
 * 方块类型纹理注册表 — 每种方块类型映射到三面（顶/左/右）的贴图路径。
 *
 * 每条记录包含三个字段：
 * - top   ：顶面贴图路径（16×16 源纹理）
 * - left  ：左面贴图路径（16×16 源纹理）
 * - right ：右面贴图路径（16×16 源纹理）
 *
 * 贴图路径相对于 index.html 的加载路径。
 *
 * @module render/block/BlockTextureMap
 */

/**
 * 方块类型纹理注册表。
 * 每个条目包含三面贴图的文件路径（16×16 源纹理）。
 * @type {Object<string, { top: string, left: string, right: string }>}
 */
export const BLOCK_TEXTURE_MAP = {
    grass: {
        top:   'assets/blocks/grass/grass_005_top.png',
        left:  'assets/blocks/grass/grass_001_left.png',
        right: 'assets/blocks/grass/grass_003_right.png'
    },
    dirt: {
        top:   'assets/blocks/dirt/dirt_005_top.png',
        left:  'assets/blocks/dirt/dirt_001_left.png',
        right: 'assets/blocks/dirt/dirt_003_right.png'
    },
    stone: {
        top:   'assets/blocks/stone/stone_005_top.png',
        left:  'assets/blocks/stone/stone_001_left.png',
        right: 'assets/blocks/stone/stone_003_right.png'
    },
    sand: {
        top:   'assets/blocks/sand/sand_005_top.png',
        left:  'assets/blocks/sand/sand_001_left.png',
        right: 'assets/blocks/sand/sand_003_right.png'
    },
    snow: {
        top:   'assets/blocks/snow/snow_005_top.png',
        left:  'assets/blocks/snow/snow_001_left.png',
        right: 'assets/blocks/snow/snow_003_right.png'
    },
    brick: {
        top:   'assets/blocks/brick/brick_005_top.png',
        left:  'assets/blocks/brick/brick_001_left.png',
        right: 'assets/blocks/brick/brick_003_right.png'
    },
    plank: {
        top:   'assets/blocks/plank/plank_005_top.png',
        left:  'assets/blocks/plank/plank_001_left.png',
        right: 'assets/blocks/plank/plank_003_right.png'
    },
    jade: {
        top:   'assets/blocks/jade/jade_005_top.png',
        left:  'assets/blocks/jade/jade_001_left.png',
        right: 'assets/blocks/jade/jade_003_right.png'
    },
    water: {
        top:   'assets/blocks/water/water_005_top.png',
        left:  'assets/blocks/water/water_001_left.png',
        right: 'assets/blocks/water/water_003_right.png'
    },
    roof: {
        top:   'assets/blocks/roof/roof_005_top.png',
        left:  'assets/blocks/roof/roof_001_left.png',
        right: 'assets/blocks/roof/roof_003_right.png'
    },
    cloud: {
        top:   'assets/blocks/cloud/cloud_005_top.png',
        left:  'assets/blocks/cloud/cloud_001_left.png',
        right: 'assets/blocks/cloud/cloud_003_right.png'
    },
    farm: {
        top:   'assets/blocks/farm/farm_005_top.png',
        left:  'assets/blocks/farm/farm_001_left.png',
        right: 'assets/blocks/farm/farm_003_right.png'
    },
    glow: {
        top:   'assets/blocks/glow/glow_001_top.png',
        left:  'assets/blocks/glow/glow_001_left.png',
        right: 'assets/blocks/glow/glow_001_right.png'
    },
    magma: {
        top:   'assets/blocks/magma/magma_005_top.png',
        left:  'assets/blocks/magma/magma_001_left.png',
        right: 'assets/blocks/magma/magma_003_right.png'
    }
};

/** 缺失贴图的占位路径（当方块类型未注册时使用）。@type {string} */
export const MISSING_TEXTURE = 'assets/placeholder/placeholder_block_grass_top.png';
