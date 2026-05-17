// @ts-check

/**
 * @fileoverview
 * 骨架预设定义——三种内置骨架类型（humanoid / quadruped / alien）的骨骼结构数据。
 * @module core/SkeletonPresets
 */

/**
 * 单根骨骼的预设定义。
 * @typedef {Object} BonePreset
 * @property {string} name - 骨骼名称
 * @property {number} [x=0] - 相对父骨骼的 X 偏移
 * @property {number} [y=0] - 相对父骨骼的 Y 偏移
 * @property {number} [rotation=0] - 本地旋转（角度）
 * @property {number} [scaleX=1] - 水平缩放
 * @property {number} [scaleY=1] - 垂直缩放
 * @property {number} [length=0] - 骨骼长度
 * @property {string|null} [parent=null] - 父骨骼名称
 */

/**
 * 骨架类型预设。
 * @typedef {Object} SkeletonPreset
 * @property {string} type - 类型名
 * @property {string} description - 描述
 * @property {BonePreset[]} bones - 骨骼定义数组
 */

/**
 * 骨骼预设集合。
 *
 * 坐标约定：所有角色面朝屏幕右侧，+X=右，+Y=下，旋转角度会被自动量化到 45° 倍数。
 *
 * @type {Object<string, SkeletonPreset>}
 */
export const SKELETON_PRESETS = {
    /**
     * 人形骨骼（7 根）。结构：root → spine (→ head, arm_l, arm_r), leg_l, leg_r
     * 适用：玩家、NPC 人类、人形怪物
     */
    humanoid: {
        type: 'humanoid',
        description: '人形骨骼，7 根骨骼：root → spine(→head, arm_l, arm_r), leg_l, leg_r',
        bones: [
            { name: 'root',   x: 0,  y: 0,   parent: null, length: 0 },
            { name: 'spine',  x: 0,  y: -18, parent: 'root',  length: 0 },
            { name: 'head',   x: 0,  y: -14, parent: 'spine', length: 0 },
            { name: 'arm_l',  x: 7,  y: -10, parent: 'spine', length: 12 },
            { name: 'arm_r',  x: -7, y: -10, parent: 'spine', length: 12 },
            { name: 'leg_l',  x: 5,  y: 0,   parent: 'root',  length: 14 },
            { name: 'leg_r',  x: -5, y: 0,   parent: 'root',  length: 14 }
        ]
    },
    /**
     * 四足骨骼（8 根）。结构：root → spine (→ neck → head, leg_bl, leg_br), leg_fl, leg_fr
     * 适用：狼、虎、灵兽等四足动物
     */
    quadruped: {
        type: 'quadruped',
        description: '四足骨骼，8 根骨骼：root → spine(→neck→head, leg_bl, leg_br), leg_fl, leg_fr',
        bones: [
            { name: 'root',    x: 0,   y: 0,   parent: null, length: 0 },
            { name: 'spine',   x: 10,  y: -14, parent: 'root',  length: 10 },
            { name: 'neck',    x: 10,  y: -6,  parent: 'spine', length: 0 },
            { name: 'head',    x: 0,   y: -6,  parent: 'neck',  length: 0 },
            { name: 'leg_bl',  x: -6,  y: 0,   parent: 'spine', length: 14 },
            { name: 'leg_br',  x: 6,   y: 0,   parent: 'spine', length: 14 },
            { name: 'leg_fl',  x: -6,  y: 6,   parent: 'root',  length: 14 },
            { name: 'leg_fr',  x: 6,   y: 6,   parent: 'root',  length: 14 }
        ]
    },
    /**
     * 异形骨骼（11 根）。结构：root → spine (→ head, arm_1~4, wing_l, wing_r), leg_1, leg_2
     * 适用：妖魔、多臂 Boss、触手系怪物
     */
    alien: {
        type: 'alien',
        description: '异形骨骼，11 根骨骼：root → spine(→head, arm_1~4, wing_l, wing_r), leg_1, leg_2',
        bones: [
            { name: 'root',   x: 0,   y: 0,   parent: null, length: 0 },
            { name: 'spine',  x: 0,   y: -22, parent: 'root',  length: 0 },
            { name: 'head',   x: 0,   y: -18, parent: 'spine', length: 0 },
            { name: 'arm_1',  x: 10,  y: -14, parent: 'spine', length: 14 },
            { name: 'arm_2',  x: -10, y: -14, parent: 'spine', length: 14 },
            { name: 'arm_3',  x: 12,  y: -4,  parent: 'spine', length: 12 },
            { name: 'arm_4',  x: -12, y: -4,  parent: 'spine', length: 12 },
            { name: 'wing_l', x: 6,   y: -16, parent: 'spine', length: 12 },
            { name: 'wing_r', x: -6,  y: -16, parent: 'spine', length: 12 },
            { name: 'leg_1',  x: 8,   y: 0,   parent: 'root',  length: 16 },
            { name: 'leg_2',  x: -8,  y: 0,   parent: 'root',  length: 16 }
        ]
    }
};
