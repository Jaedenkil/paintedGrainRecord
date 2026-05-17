// @ts-check

/**
 * @fileoverview
 * 角色骨骼 Z 轴排序配置——定义各骨架类型每根骨骼的 zIndex 偏移。
 *
 * 约定：
 * - zIndex < 0 = 后台肢体（背向观众，在身体之后渲染）
 * - zIndex = 0 = 身体主体
 * - zIndex > 0 = 前台肢体（朝向观众，在身体之前渲染）
 *
 * @module render/CharacterZOrder
 */

/**
 * 默认 zOrder 映射（骨架类型 → 骨骼名 → zIndex 偏移）。
 * @type {Object<string, Object<string, number>>}
 */
export const DEFAULT_Z_ORDER = {
    humanoid: {
        root: 0, spine: 0, head: 0,
        arm_l: 1, arm_r: -1,
        leg_l: 1, leg_r: -1
    },
    quadruped: {
        root: 0, spine: 0, neck: 0, head: 0,
        leg_bl: 1, leg_br: -1,
        leg_fl: 1, leg_fr: -1
    },
    alien: {
        root: 0, spine: 0, head: 0,
        arm_1: 1, arm_2: -1, arm_3: 1, arm_4: -1,
        wing_l: 1, wing_r: -1,
        leg_1: 1, leg_2: -1
    }
};
