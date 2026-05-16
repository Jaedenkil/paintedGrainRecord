# 🎯 全面审查与任务执行规划报告

> 项目：像素沙盒生存 RPG — 云汲仙田录  
> 引擎架构师：Finch  
> 报告版本：v1.0  
> 生成日期：2026-05-14  
> 目标：从当前 2.5D 静态场景 → 可交互体素世界

---

## 目录

1. [已完成工作概述](#1-已完成工作概述)
2. [设计缺陷清单（Design-Phase Deficiencies）](#2-设计缺陷清单design-phase-deficiencies)
3. [实现缺陷清单（Implementation-Phase Defects）](#3-实现缺陷清单implementation-phase-defects)
4. [综合问题矩阵](#4-综合问题矩阵)
5. [五阶段任务执行规划](#5-五阶段任务执行规划)
6. [阶段 P0 — 止血重构](#6-阶段-p0--止血重构)
7. [阶段 P1 — 体素数据核心](#7-阶段-p1--体素数据核心)
8. [阶段 P2 — 渲染适配器](#8-阶段-p2--渲染适配器)
9. [阶段 P3 — 输入系统](#9-阶段-p3--输入系统)
10. [阶段 P4 — 纹理管线](#10-阶段-p4--纹理管线)
11. [阶段 P5 — 工程化](#11-阶段-p5--工程化)
12. [优先级与时间线](#12-优先级与时间线)
13. [附录：文件行数现状](#13-附录文件行数现状)

---

## 1. 已完成工作概述

### 1.1 第一轮审查：GDD vs 实现对照报告

**任务 ID**：`REVIEW-001`  
**状态**：✅ 已完成  
**描述**：将 `docs/GDD.md` 设计方案与当前整体方案进行对照，比较技术栈、核心架构、模块实现、渲染管线的差异，描述差异但不做改动。  
**输出**：口头报告（已交付）

### 1.2 第二轮审查：设计缺陷与实现缺陷全面分析

**任务 ID**：`REVIEW-002`  
**状态**：✅ 已完成  
**描述**：基于项目当前状态，全面审查架构设计、技术选型、模块接口、性能优化、交互实现五个维度，明确区分设计阶段不足与实现阶段缺陷。  
**输出**：口头报告（已交付）

### 1.3 任务执行规划

**任务 ID**：`PLAN-001`  
**状态**：✅ 已完成  
**描述**：制定五阶段执行计划，包含子任务步骤、交付物形式、优先级及预期时间节点。  
**输出**：本文档

---

## 2. 设计缺陷清单（Design-Phase Deficiencies）

> 这些是 GDD 设计文档本身的问题，需在设计层面修补。

### D1：GDD 对渲染管线描述不足 — 「只管要什么，不管怎么造」

| 属性 | 内容 |
|------|------|
| **ID** | `DESIGN-DEFECT-001` |
| **状态** | 🔴 待修补 |
| **严重级别** | 高 |
| **现象** | GDD §5.1–5.6 描述了渲染流程的输入输出（体素 → 投影 → 排序 → 光照），但完全没有涉及**纹理变换管线**这一核心中间层 |
| **根因** | 设计阶段将"体素数据"和"等轴渲染"视为两个独立层，低估了从 16×16 像素纹理到等轴三面体的数学变换复杂度 |
| **后果** | 当前 `IsoTextureTransformer.mjs`（703行）是**完全由实现驱动逆向生成的设计**，GDD 中没有对应章节 |
| **修复建议** | GDD 应新增 §5.7「等轴纹理变换管线」，记录旋转/压缩/剪切的数学原理与三种装配模式的取舍 |

### D2：GDD 未定义 Chunk 渲染适配器接口

| 属性 | 内容 |
|------|------|
| **ID** | `DESIGN-DEFECT-002` |
| **状态** | 🔴 待修补 |
| **严重级别** | 高 |
| **现象** | GDD §4.1 定义了 `Chunk(16×16×16)` 和 `VoxelWorld` 数据模型，§5.1 提到"Chunk 级渲染用 OffscreenCanvas 缓存"，但**从未定义 Chunk 与 PixiJS 渲染管线的接口契约** |
| **后果** | 当前 `BlockRenderer.mjs`（1147行）接受的是 `string[][]` 矩阵，而不是 `Chunk` 对象。未来接入 VoxelWorld 时需要一个桥接层 |
| **修复建议** | GDD 应新增 §5.1.1，描述 `ChunkRendererAdapter` 接口定义 |

### D3：GDD 中的性能目标脱离实际渲染模型

| 属性 | 内容 |
|------|------|
| **ID** | `DESIGN-DEFECT-003` |
| **状态** | 🟡 待验证 |
| **严重级别** | 中 |
| **现象** | GDD §8 设定"10 万体素 @ 60fps"目标，但 §5.1 的渲染策略是每个 Chunk 一张 OffscreenCanvas 缓存——这些约束没有被交叉验证 |
| **修复建议** | GDD §8 增加「Chunk 脏标记传播策略」和「增量渲染预算模型」 |

### D4：GDD 对交互模式描述模糊

| 属性 | 内容 |
|------|------|
| **ID** | `DESIGN-DEFECT-004` |
| **状态** | 🟡 待修补 |
| **严重级别** | 中 |
| **现象** | GDD §4.3 描述了玩家交互（点击放置/破坏），但没有定义屏幕坐标 → 体素网格坐标的逆变换算法 |
| **后果** | 当前使用基于 sprite hitTest 的 O(n) 算法，不可扩展至大规模体素场景 |
| **修复建议** | GDD 应增加 §4.3.1「射线拾取算法」，定义 O(1) 数学逆变换公式 |

---

## 3. 实现缺陷清单（Implementation-Phase Defects）

> 这些是当前代码实现中需要修改的问题。

### I1：多个核心文件超过 300 行铁律红线

| 属性 | 内容 |
|------|------|
| **ID** | `IMPL-DEFECT-001` |
| **状态** | 🔴 待修复 |
| **严重级别** | 高 |
| **涉及文件** | `BlockSprite.mjs`（933行 ❌）、`BlockRenderer.mjs`（1147行 ❌）、`IsoTextureTransformer.mjs`（703行 ❌）、`Camera2D.mjs`（437行 ❌）、`SceneGraph.mjs`（465行 ❌） |
| **根因** | 实现时未做好关注点分离，将"一个类"等同于"一个文件" |
| **修复方案** | 拆分为模块族，详见 P0 阶段 |

### I2：BLOCK_TEXTURE_MAP 使用文件路径而非纹理图集

| 属性 | 内容 |
|------|------|
| **ID** | `IMPL-DEFECT-002` |
| **状态** | 🔴 待修复 |
| **严重级别** | 高 |
| **现象** | 14 个方块类型使用独立图片路径（42 个 HTTP 请求），违反 GDD §7 纹理图集规范 |
| **根因** | 实现时采用了快速验证路径 |
| **修复路径** | 短期提取为独立文件 → 中期实现 TextureAtlas → 长期构建时烘焙 |

### I3：BlockRenderer 接受 string[][] 而非 VoxelWorld

| 属性 | 内容 |
|------|------|
| **ID** | `IMPL-DEFECT-003` |
| **状态** | 🔴 待修复 |
| **严重级别** | 高 |
| **现象** | 渲染层接口与 GDD §4.1 定义的体素数据模型完全脱节 |
| **根因** | 实现时没有先实现 VoxelWorld 数据层，直接从渲染层开建 |
| **修复路径** | 先实现 VoxelWorld → 再实现 VoxelRenderAdapter → 最后重构 BlockRenderer |

### I4：交互层全在渲染模块中，无独立 InputSystem

| 属性 | 内容 |
|------|------|
| **ID** | `IMPL-DEFECT-004` |
| **状态** | 🟡 待修复 |
| **严重级别** | 中 |
| **现象** | 交互逻辑散布在 `BlockRenderer.mjs` 和 `boot.mjs` 中，无独立 InputSystem 模块 |
| **根因** | 直接使用 PixiJS 的 interactive 事件系统，跳过了输入抽象层 |
| **修复路径** | 新建 InputSystem + ScreenToWorld + InputCommand 模块 |

### I5：纹理装配使用运行时 Canvas 而非预烘焙

| 属性 | 内容 |
|------|------|
| **ID** | `IMPL-DEFECT-005` |
| **状态** | 🟡 待修复 |
| **严重级别** | 中 |
| **现象** | `batchLoadAndTransform()` 在运行时操作 Canvas 进行纹理变换，阻塞主线程 |
| **根因** | 没有区分构建时处理与运行时加载的边界 |
| **修复路径** | 短期加内存缓存 → 中期构建时烘焙脚本 |

### I6：Electron 集成 — 版本落后且配置不完整

| 属性 | 内容 |
|------|------|
| **ID** | `IMPL-DEFECT-006` |
| **状态** | 🟡 待修复 |
| **严重级别** | 中 |
| **现象** | Electron v28.3.3（GDD 要求 v31）、无 TypeScript、无 Vite、无 contextBridge、无预加载脚本 |
| **评估** | 当前阶段 Electron 非必需，引擎核心开发在浏览器中即可完成 |

---

## 4. 综合问题矩阵

| 维度 | 设计缺陷 | 实现缺陷 | 影响等级 |
|------|---------|---------|---------|
| **架构设计** | D1 纹理管线未定义 | I2 无图集 / I5 运行时变换 | 🔴 阻塞 |
| | D2 Chunk 适配器未定义 | I3 无 VoxelWorld / RenderAdapter | 🔴 阻塞 |
| | D4 拾取算法未定义 | I4 无 InputSystem | 🟡 高 |
| **技术选型** | — | I6 Electron/TS/Vite 缺失 | 🟡 高 |
| **模块接口** | D2 接口契约缺失 | I3 string[][] 而非 Chunk | 🔴 阻塞 |
| **性能优化** | D3 性能目标未交叉验证 | I5 运行时变换 / I2 未用图集 | 🟡 高 |
| | — | I1 超长文件（不利于 Lazy Loading） | 🟢 低 |
| **交互实现** | D4 逆变换未定义 | I4 O(n) hitTest / 无命令模式 | 🟡 高 |

---

## 5. 五阶段任务执行规划

### 总览

| 阶段 | 名称 | 工期 | 依赖 | 新文件数 | 修改文件数 | 核心风险 |
|------|------|------|------|---------|-----------|---------|
| **P0** | 止血重构 | 1.5 天 | 无 | 6 | 4 | 拆分时引入回归 |
| **P1** | 体素数据核心 | 3–4 天 | P0 | 3 | 0 | 接口设计不当 |
| **P2** | 渲染适配器 | 3 天 | P1 | 2 | 1 | Chunk 变换性能 |
| **P3** | 输入系统 | 2 天 | P1 | 3 | 1 | 逆变换精度 |
| **P4** | 纹理管线 | 4 天 | P0 | 3 + 脚本 | 1 | 构建工具链 |
| **P5** | 工程化 | 并行 3–5 天 | 无 | 多 | 多 | 旧测试兼容性 |

---

## 6. 阶段 P0 — 止血重构

**工期**：1.5 天  
**依赖**：无  
**目标**：在不改变任何行为的前提下，将超长文件拆分至铁律规定的 300 行以内，并提取共享数据。

### P0.1 — BlockSprite 拆分为模块族

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P0.1` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🔴 最高 |
| **工期** | 0.5 天 |

**步骤**：

1. 新建 `src/engine/render/block/` 目录
2. 新建 `src/engine/render/block/BlockConstants.mjs`
   - 提取：`TILE_W, TILE_H, TILE_HALF_W, TILE_HALF_H, Z_BASE, ROTATED_SIZE, TOP_HEIGHT, SIDE_WIDTH, SIDE_HEIGHT, SHEAR_OFFSET`
   - 行数：~30 行
3. 新建 `src/engine/render/block/BlockTextureMap.mjs`
   - 提取：`BLOCK_TEXTURE_MAP`（14 种方块 × 3 面路径）、`BLOCK_COLORS`（调试色板）
   - 行数：~80 行
4. 新建 `src/engine/render/block/BlockFaceTransform.mjs`
   - 提取：三面 Sprite 的纹理坐标变换逻辑（anchor、position、rotation 设置）
   - 行数：~120 行
5. 新建 `src/engine/render/block/BlockAssembler.mjs`
   - 提取：`assembleBlockTexture()` 和纹理裁剪逻辑
   - 行数：~150 行
6. 精简 `BlockSprite.mjs` 至 ~180 行
   - 只保留：三个 Sprite 的子容器管理 + `setGridPosition()` + `setBlockType()` + `destroy()`

**交付物**：
```
src/engine/render/block/BlockConstants.mjs       — 新建
src/engine/render/block/BlockTextureMap.mjs      — 新建
src/engine/render/block/BlockFaceTransform.mjs   — 新建
src/engine/render/block/BlockAssembler.mjs       — 新建
src/engine/render/block/BlockSprite.mjs          — 精简版本（替换原文件位置）
```

**依赖方向**：
```
BlockConstants ← BlockTextureMap ← BlockFaceTransform ← BlockAssembler ← BlockSprite
```
（绝对不可反向引用）

**风险**：拆出的模块间循环引用 → 缓解：严格单向依赖

---

### P0.2 — BlockRenderer 拆分为交互层 + 渲染层

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P0.2` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🔴 最高 |
| **工期** | 0.5 天 |

**步骤**：

1. 新建 `src/engine/render/block/GridInteractionHandler.mjs`
   - 提取：`_onGridClick, _onGridHover, _highlightBlock, _clearHighlight`
   - 暴露接口：`mount(stage) / unmount()`
   - 行数：~200 行
2. 新建 `src/engine/render/block/BlockGridManager.mjs`
   - 提取：`_gridMap`（Map<string, BlockSprite> 的增删查改）、`_buildGridMapping()`, `_clearGridMapping()`
   - 行数：~180 行
3. 精简 `BlockRenderer.mjs` 至 ~300 行
   - 只负责：`buildFromGrid → GridManager + GridInteraction` 的编排

**交付物**：
```
src/engine/render/block/GridInteractionHandler.mjs   — 新建
src/engine/render/block/BlockGridManager.mjs         — 新建
src/engine/render/block/BlockRenderer.mjs            — 精简版本（替换原文件位置）
```

**测试**：补充 `GridInteractionHandler.test.mjs`、`BlockGridManager.test.mjs`

---

### P0.3 — IsoTextureTransformer 添加纹理缓存

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P0.3` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🔴 最高 |
| **工期** | 0.5 天 |

**步骤**：

1. 在 `IsoTextureTransformer.mjs` 顶部添加 `const textureCache = new Map()`
2. `batchLoadAndTransform()` 执行前先查缓存，命中则跳过 Canvas 操作
3. 新增接口：`clearTextureCache()`, `prewarmTextureCache(blockTypes)`

**交付物**：
```
src/engine/loader/IsoTextureTransformer.mjs   — 修改（+缓存逻辑 ~50行）
```

**注意**：`IsoTextureTransformer.mjs` 本身也超红线（703行），但其结构拆分纳入 P4 阶段。

---

## 7. 阶段 P1 — 体素数据核心

**工期**：3–4 天  
**依赖**：P0  
**目标**：实现 GDD §4.1 定义的 `VoxelWorld` + `Chunk` 数据模型，这是整个引擎的数据基石。

### P1.1 — 实现 VoxelWorld 与 Chunk

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P1.1` |
| **状态** | ⏳ 待开始（需先确认接口设计） |
| **优先级** | 🔴 最高 |
| **工期** | 2 天实现 + 1 天测试 |

**接口草案**（待确认）：

```javascript
// src/engine/voxel/Chunk.mjs
class Chunk {
  static CHUNK_SIZE = 16       // 16×16×16
  static TOTAL_VOXELS = 4096
  constructor(cx, cy)          // Chunk 坐标
  getVoxel(gx, gy, gz)        // → voxelId: number（0 = 空）
  setVoxel(gx, gy, gz, id)    // → void，设置脏标记
  fill(id)                     // 填充所有体素
  isDirty()                    // → boolean
  clearDirty()                 // 清除脏标记
  toFlatArray()                // → Uint16Array(4096)
  getChunkCoord()              // → { cx, cy }
}

// src/engine/voxel/VoxelWorld.mjs
class VoxelWorld {
  constructor(seed)
  getChunk(cx, cy)             // → Chunk（自动创建空块）
  getVoxel(wx, wy, wz)        // → voxelId（世界坐标）
  setVoxel(wx, wy, wz, id)    // → void
  getOrCreateChunk(cx, cy)    // → Chunk
  forEachChunkInView(cx, cy, radius) // 遍历视口内 Chunk
  serialize()                  // → ArrayBuffer
  deserialize(buffer)          // → void
}
```

**交付物**：
```
src/engine/voxel/Chunk.mjs                — 新建 ~120 行
src/engine/voxel/VoxelWorld.mjs           — 新建 ~200 行
src/engine/voxel/ChunkCoordUtils.mjs      — 新建 ~60 行
src/engine/voxel/__tests__/Chunk.test.mjs       — 新建
src/engine/voxel/__tests__/VoxelWorld.test.mjs  — 新建
```

**测试重点**：
- Chunk：getVoxel/setVoxel 越界保护、脏标记正确性、序列化/反序列化一致性
- VoxelWorld：跨 Chunk 读写、视口遍历不产生空洞

---

### P1.2 — 实现简化版世界生成器

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P1.2` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🟡 高 |
| **工期** | 0.5 天 |

**注意**：这不是 Perlin Noise 完整实现，而是为 P2 渲染适配器提供测试数据源的简化生成器。

```javascript
// src/engine/voxel/SimpleWorldGenerator.mjs
class SimpleWorldGenerator {
  static generateFlat(world, height, blockId)
  static generateTestTower(world, cx, cy, height)
  static generatePerlin(world, seed, config)     // 存根
}
```

**交付物**：`src/engine/voxel/SimpleWorldGenerator.mjs`（~100 行）

---

## 8. 阶段 P2 — 渲染适配器

**工期**：3 天  
**依赖**：P1  
**目标**：桥接 VoxelWorld 数据与现有的 BlockRenderer 渲染管线。

### P2.1 — 实现 VoxelRenderAdapter

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P2.1` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🟡 高 |
| **工期** | 2 天 |

```javascript
// src/engine/render/VoxelRenderAdapter.mjs
class VoxelRenderAdapter {
  constructor(blockRenderer)
  loadChunk(chunk)                  // Chunk → 调用 blockRenderer.buildFromGrid()
  unloadChunk(cx, cy)               // 卸载 Chunk 对应的渲染节点
  syncDirtyChunks(world)            // 遍历所有脏 Chunk，增量更新
  setViewCenter(wx, wy, wz)         // 设置视口中心，触发 Chunk 进退
  getChunkSpriteMap()               // → Map<chunkKey, BlockSprite[]>
}
```

**交付物**：`src/engine/render/VoxelRenderAdapter.mjs`（~250 行）

---

### P2.2 — 重构 BlockRenderer.buildFromGrid

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P2.2` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🟡 高 |
| **工期** | 1 天 |

将 `buildFromGrid` 标记为 `@deprecated`，新增 `loadGrid(grid, offsetX, offsetY)` 支持相对坐标。

**交付物**：修改 `BlockRenderer.mjs`（+~50 行，标记旧接口 deprecated）

---

## 9. 阶段 P3 — 输入系统

**工期**：2 天  
**依赖**：P1  
**目标**：实现 O(1) 屏幕坐标 → 体素坐标逆变换，将交互逻辑从渲染层解耦。

### P3.1 — 实现 ScreenToWorld 逆变换

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P3.1` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🟡 高 |
| **工期** | 0.5 天 |

**数学原理**：
```
// 正变换:
screenX = (gx - gy) * TILE_HALF_W
screenY = (gx + gy) * TILE_HALF_H - gz * TILE_H

// 逆变换（去相机 + 去缩放后）:
gx = ( wx / TILE_HALF_W + wy / TILE_HALF_H ) / 2
gy = ( -wx / TILE_HALF_W + wy / TILE_HALF_H ) / 2
gz = 从深度缓冲区推断，或从点击的面方向推断
```

```javascript
// src/engine/input/ScreenToWorld.mjs
class ScreenToWorld {
  constructor(camera2D)
  screenToGrid(sx, sy)            // → { gx, gy, gz }（O(1)）
  screenToChunk(sx, sy)           // → { cx, cy, localGx, localGy }
  screenToFace(sx, sy, blockSprite) // → 'top' | 'left' | 'right'
}
```

**交付物**：`src/engine/input/ScreenToWorld.mjs`（~150 行 + 数学注释）

---

### P3.2 — 实现 InputSystem 与 InputCommand

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P3.2` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🟡 高 |
| **工期** | 1 天 |

```javascript
// src/engine/input/InputSystem.mjs
class InputSystem {
  constructor(engine)
  mount(canvas)
  unmount()
  on(event, handler)             // 'click', 'hover', 'keydown'
  // 内部使用 EventBus 发射 input:click, input:hover
}

// src/engine/input/InputCommand.mjs
class InputCommand {
  static PlaceBlock(world, gx, gy, gz, blockType)
  static RemoveBlock(world, gx, gy, gz)
  static SelectBlock(world, gx, gy, gz)
}
```

**交付物**：
```
src/engine/input/InputSystem.mjs       — 新建 ~120 行
src/engine/input/InputCommand.mjs      — 新建 ~80 行
```

---

### P3.3 — 从 BlockRenderer 剥离交互逻辑

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P3.3` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🟡 高 |
| **工期** | 0.5 天 |

将 `GridInteractionHandler` 中的交互处理迁移至 `InputSystem` 的响应链中。

**交付物**：修改 `GridInteractionHandler.mjs`（事件源从 DOM → EventBus）

---

## 10. 阶段 P4 — 纹理管线

**工期**：4 天  
**依赖**：P0  
**目标**：实现符合 GDD §7 规格的纹理图集 + 构建时烘焙管线。

### P4.1 — TextureAtlas 加载器

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P4.1` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🟢 中 |
| **工期** | 1 天 |

```javascript
// src/engine/loader/TextureAtlas.mjs
class TextureAtlas {
  constructor(atlasJsonUrl, basePath)
  async load()
  getTexture(blockType, face)    // → PIXI.Texture
  getTextureRect(blockType, face)// → { x, y, w, h }
}
```

**交付物**：`src/engine/loader/TextureAtlas.mjs`（~200 行）

---

### P4.2 — 构建时图集烘焙脚本

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P4.2` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🟢 中 |
| **工期** | 2 天 |

```javascript
// tools/bake-texture-atlas.mjs
// 1. 扫描 assets/blocks/**/*.png
// 2. 分组：每个方块类型 3 面
// 3. 合并为单张图集 PNG
// 4. 输出 atlas.json（GDD §7.2 格式）
```

**交付物**：
```
tools/bake-texture-atlas.mjs              — 新建 ~300 行
assets/atlas/block-atlas.png              — 生成文件
assets/atlas/block-atlas.json             — 生成文件
```

---

### P4.3 — 拆分 IsoTextureTransformer

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P4.3` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🟢 中 |
| **工期** | 1 天 |

将 703 行的 `IsoTextureTransformer.mjs` 拆分为：
- `IsoMath.mjs`（纯数学函数：旋转矩阵、剪切变换 → ~120 行）
- `IsoCanvasOps.mjs`（Canvas2D 绘图操作 → ~150 行）
- `IsoTextureTransformer.mjs`（编排层 + 缓存 → ~200 行）

**交付物**：
```
src/engine/loader/IsoMath.mjs                 — 新建
src/engine/loader/IsoCanvasOps.mjs            — 新建
src/engine/loader/IsoTextureTransformer.mjs   — 精简版本
```

---

## 11. 阶段 P5 — 工程化

**工期**：并行 3–5 天  
**依赖**：无  
**目标**：补齐 GDD §2 规定的技术栈。

### P5.1 — 引入 Vite

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P5.1` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🟢 中 |
| **工期** | 1 天 |

**步骤**：
1. 安装 Vite 5.x
2. 创建 `vite.config.mjs`
3. 迁移 `index.html` 到 Vite 入口
4. 迁移测试到 Vitest

---

### P5.2 — 引入 TypeScript（渐进式）

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P5.2` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🟢 低 |
| **工期** | 2–3 天 |

**策略**：
1. 先为 `.mjs` 文件补充 `.d.ts` 类型声明
2. 新建文件直接使用 `.ts`
3. 存量文件分批迁移（从 VoxelWorld → EventBus → GameLoop 优先级）

---

### P5.3 — Electron 安全加固

| 属性 | 内容 |
|------|------|
| **任务 ID** | `TASK-P5.3` |
| **状态** | ⏳ 待开始 |
| **优先级** | 🟢 低 |
| **工期** | 1 天 |

**步骤**：
1. 升级 Electron 至 v31
2. 添加 `preload.cjs`（contextBridge 暴露最小 API）
3. `main.cjs` 启用 `contextIsolation: true, sandbox: true`
4. 创建 `ElectronAdapter.mjs`（应用层，不污染引擎核心）

---

## 12. 优先级与时间线

### 优先级矩阵

```
                紧迫        不紧迫
              ┌──────────┬──────────┐
      重要    │  P0.1    │  P4      │
              │  P0.2    │          │
              │  P0.3    │          │
              │  P1.1    │          │
              │  P1.2    │          │
              │  P2.1    │          │
              ├──────────┼──────────┤
     不重要   │  P3.1    │  P5      │
              │  P3.2    │          │
              │  P3.3    │          │
              └──────────┴──────────┘
```

### 预期时间线

```
Week 1（2026-05-18 ~ 2026-05-22）
  Mon-Tue:   P0 止血重构（TASK-P0.1, P0.2, P0.3）
  Wed-Fri:   P1 体素数据核心（TASK-P1.1, P1.2）

Week 2（2026-05-25 ~ 2026-05-29）
  Mon-Wed:   P2 渲染适配器（TASK-P2.1, P2.2）
  Thu-Fri:   P3 输入系统（TASK-P3.1, P3.2, P3.3）

  → Week 2 结束时：应能从 VoxelWorld 数据生成可交互的等轴场景

Week 3（2026-06-01 ~ 2026-06-05）
  可选：P4 纹理管线 或 P5 工程化（按需推进）
```

### 里程碑

| 里程碑 | 时间 | 验证标准 |
|--------|------|---------|
| **M0** 代码规范达标 | P0 完成后 | 所有文件 ≤ 300 行 |
| **M1** 体素世界可运行 | P1 完成后 | `new VoxelWorld(seed).getVoxel(0,0,0)` 返回 0 |
| **M2** 体素世界可见 | P2 完成后 | Chunk 数据渲染为等轴场景 |
| **M3** 体素世界可交互 | P3 完成后 | 点击体素可放置/破坏 |
| **M4** 纹理管线就绪 | P4 完成后 | 图集加载替代独立文件 |
| **M5** 工程化就绪 | P5 完成后 | Vite dev server + 测试通过 |

---

## 13. 附录：文件行数现状

### 超过 300 行红线的文件

| 文件 | 当前行数 | 超标量 | 处理阶段 |
|------|---------|--------|---------|
| `src/engine/render/BlockRenderer.mjs` | 1,147 | +847 | P0.2 |
| `src/engine/render/BlockSprite.mjs` | 933 | +633 | P0.1 |
| `src/engine/loader/IsoTextureTransformer.mjs` | 703 | +403 | P4.3 |
| `src/engine/render/SceneGraph.mjs` | 465 | +165 | 后续 |
| `src/engine/render/Camera2D.mjs` | 437 | +137 | 后续 |

### 符合规范的文件（≤ 300 行）

| 文件 | 行数 |
|------|------|
| `src/engine/core/Engine.mjs` | 356 ⚠️（边缘超标） |
| `src/engine/core/GameLoop.mjs` | 356 ⚠️（边缘超标） |
| `src/engine/core/EventBus.mjs` | 329 ⚠️（边缘超标） |
| `src/engine/render/RenderSystem.mjs` | 309 ⚠️（边缘超标） |
| `src/engine/render/LayerStack.mjs` | 312 ⚠️（边缘超标） |
| `src/engine/render/SortManager.mjs` | ~200 ✅ |
| `src/engine/render/PixiRendererAdapter.mjs` | ~150 ✅ |
| `src/engine/render/RendererAdapter.mjs` | ~80 ✅ |
| `src/engine/core/Time.mjs` | ~100 ✅ |
| `src/engine/boot.mjs` | 262 ✅ |

---

> **文档维护者**：Finch（引擎架构师）  
> **更新记录**：
> - v1.0 (2026-05-14) — 初版，含完整审查结果与任务规划
