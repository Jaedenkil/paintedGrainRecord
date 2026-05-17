// @ts-check

/**
 * @fileoverview
 * IsoGridOverlay 的视觉主题配置 —— 色彩常量与默认样式参数。
 *
 * 设计遵循"瘦金体·极简华贵"美学：
 * - 主色（耀金）：#d4a847 至 #f0c97d
 * - 辅色（暗金）：#8b6f3c 至 #b8943a
 * - 强调色（点金光）：#ffd966
 * - 铜金：用于垂直面下边缘斜线
 *
 * @module render/IsoGridTheme
 */

/** 耀金 — 主网格线色 */
export const GOLD_MAIN = 0xd4a847;

/** 暗金 — 节点色、辅线色 */
export const GOLD_DARK = 0x8b6f3c;

/** 点金光 — 高亮中心点 */
export const GOLD_ACCENT = 0xffd966;

/** 铜金 — 垂直面下边缘斜线色 */
export const EDGE_COPPER = 0xc9953e;

/** 辉光层透明度 */
export const GLOW_ALPHA = 0.12;

/** 辉光层线宽 */
export const GLOW_WIDTH = 3;

/**
 * 默认网格参数。
 * @type {{ alpha: number, color: number, lineWidth: number,
 *          showCenterDot: boolean, centerDotRadius: number, centerDotColor: number,
 *          showVertexDots: boolean, vertexDotRadius: number, vertexDotColor: number,
 *          showGlow: boolean, showAxisLabels: boolean }}
 */
export const DEFAULT_GRID_OPTIONS = {
    alpha: 0.35,
    color: GOLD_MAIN,
    lineWidth: 1.5,
    showCenterDot: false,
    centerDotRadius: 1.5,
    centerDotColor: GOLD_ACCENT,
    showVertexDots: true,
    vertexDotRadius: 0.75,
    vertexDotColor: GOLD_DARK,
    showGlow: true,
    showAxisLabels: false
};
