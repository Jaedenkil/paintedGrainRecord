// @ts-check

/**
 * @fileoverview
 * 渲染系统统一导出入口。
 *
 * 外部使用方式：
 * ```javascript
 * // 插件方式
 * import { renderSystem } from './src/engine/render/index.mjs';
 * engine.use(renderSystem);
 *
 * // 直接访问模块
 * import { RendererAdapter, PixiRendererAdapter, LayerStack, Camera2D,
 *          CharacterSprite, SkeletalAnimationController }
 *     from './src/engine/render/index.mjs';
 * ```
 *
 * @module render
 */

export { renderSystem } from './RenderSystem.mjs';
export { RendererAdapter } from './RendererAdapter.mjs';
export { PixiRendererAdapter } from './PixiRendererAdapter.mjs';
export { LayerStack } from './LayerStack.mjs';
export { Camera2D } from './Camera2D.mjs';
export { BlockSprite, TILE_W, TILE_H, TILE_HALF_W, TILE_HALF_H, Z_BASE, BLOCK_TEXTURE_MAP }
    from './BlockSprite.mjs';
export { BlockRenderer } from './BlockRenderer.mjs';
export { IsoGridOverlay } from './IsoGridOverlay.mjs';

// 骨骼动画渲染模块（T8 / T9 / T13B）
export { CharacterSprite } from './CharacterSprite.mjs';
export { SkeletalAnimationController } from './SkeletalAnimationController.mjs';
export { Slot } from './Slot.mjs';
export { BoneTextureAtlas } from './BoneTextureAtlas.mjs';

// Y-Sort 排序系统（T10）
export { SortManager, LayerType, DEFAULT_LAYER_TYPES, getSortKey, Z_BASE }
    from './SortManager.mjs';

// 场景图管理（T11）
export { SceneGraph } from './SceneGraph.mjs';
