# 像素沙盒生存 RPG — 游戏设计文档（GDD）

> 文档版本：v1.0  
> 引擎架构师：Finch  
> 技术路线：路线 B — 体素数据 × 2D 渲染混合架构

---

## 1. 参考对象与设计目标

### 1.1 核心竞品参考

| 游戏 | 提取内容 | 差异化方向 |
|---|---|---|
| **Terraria** | 地形完全可破坏、随机世界生成、装备驱动进度 | 但我们采用俯视角 + 体素数据模型，挖掘体验保留但视觉改为俯视 |
| **Stardew Valley** | 俯视角自由移动、种田社交循环、NPC 关系系统 | 加入多层建筑、体素式自由建造，远超 Stardew 的建造深度 |
| **Stoneshard** | 像素美术氛围、部位伤害系统、高难度生存 | 保留部位伤害深度，但改为实时战斗而非回合制 |

### 1.2 设计目标

| 维度 | 目标 |
|---|---|
| **玩法定位** | 俯视角像素沙盒生存 RPG，融合建造/挖掘/战斗/种田/社交 |
| **核心体验** | 玩家可以在地表种田社交、在地下冒险战斗、在任何地方自由建造 |
| **目标用户** | 沙盒建造爱好者 + 像素 RPG 玩家 + 生存游戏玩家 |
| **单人完成度** | MVP 6~8 个月，完整版 12~18 个月 |
| **商业模式** | Steam 买断制 + 免费内容更新 |

---

## 2. 技术栈

### 2.1 选型清单

| 层 | 选型 | 版本 | 理由 |
|---|---|---|---|
| **壳** | Electron | 31 (Chromium 126) | 跨平台、自动更新、原生文件访问 |
| **语言** | TypeScript | 5.4+ | 类型安全，ECS 架构刚需 |
| **构建** | Vite | 5.x | HMR 极快，ESM 原生支持 |
| **渲染** | PixiJS | v8 | 2D WebGL 性能标杆，v8 支持模块化 Tree-shake |
| **物理** | 自建 Tile 碰撞 | — | 俯视角无重力，碰撞逻辑 O(1) 查表 |
| **音效** | Howler.js 或 Web Audio API | — | 2D 空间音效 + 音频池管理 |
| **UI** | 原生 DOM（HTML + CSS） | — | 瘦金体 CSS 效果 DOM 实现最灵活 |
| **测试** | Vitest | — | 与 Vite 集成，速度极快 |
| **存档** | IndexedDB（渲染进程） + IPC 文件写（主进程） | — | 适合结构化大数据 |

### 2.2 工具链

| 用途 | 工具 | 说明 |
|---|---|---|
| 像素画 | Aseprite | 角色精灵、Tile、UI 元素绘制 |
| 纹理图集打包 | FreeTexturePacker / TexturePacker CLI | 散图→图集+索引 JSON |
| 地图编辑 | Tiled（.tmx）→ 自定义导入器 | 快速搭建预设关卡 |
| 噪声调试 | 自建 PreviewTool | Perlin 噪声可视化，调参用 |
| 性能分析 | Chrome DevTools Performance | WebGL draw call、内存分析 |

---

## 3. 渲染分辨率规范

### 3.1 基础分辨率与放大策略

```
基础渲染分辨率：320 × 180 像素（复古像素基准）
─────────────────────────────────────────────
这个分辨率下，1 个 Tile = 32×32 像素
世界可见区域 = 10×5.6 个 Tile（横向 10 格，纵向 5.6 格）

但实际上我们会用更大的可视范围，所以：
  游戏逻辑分辨率：320 × 180（所有坐标和碰撞基于此）
  显示分辨率：基础分辨率 × 整数放大倍数

可选放大倍数：
  2x → 640 × 360  （低配/小窗模式）
  3x → 960 × 540  （推荐/默认）← 默认
  4x → 1280 × 720 （高配）
  6x → 1920 × 1080（全屏）

为什么用 320×180 而不是 1920×1080？
  - 像素艺术需要整数放大才能保持清晰
  - 非整数放大（如 1920/320=6.0 → 刚好 6x 整数）
  - 所有 sprite 在 320×180 下绘制，GPU/Canvas 放大到显示分辨率
  - 性能优势：GPU 只需处理 320×180 的像素量
```

### 3.2 视口与 Chunk 可见范围

```
基础分辨率下：
  Canvas 尺寸：320×180
  Tile 尺寸：32×32
  可见 Tile 数：10 × 5.625 = ~60 tile

实际游戏中会使用 3x 放大：
  显示分辨率：960×540
  但 Canvas 逻辑尺寸仍为 320×180
  CSS 或 WebGL 做 3x 整数放大

每个 Chunk = 16×16 Tile = 512×512 像素（在 320×180 逻辑分辨率下）
可见 Chunk 数 ~ (10 tiles / 16) × (5.6 / 16) ≈ 1 个 Chunk 不够
  实际需要 2×2 = 4 个 Chunk 可见（含边缘）
  加上 1 个 Chunk 缓冲 → 3×3 = 9 个 Chunk 常驻显存
```

---

## 4. 核心设计

### 4.1 体素世界数据模型

```
VoxelWorld
  ├─ chunks: Map<"cx,cy,cz", Chunk>
  │
  ├─ getVoxel(x, y, z): VoxelID      // O(1) 读取
  ├─ setVoxel(x, y, z, id): void     // O(1) 写入，自动标注 dirty
  ├─ getChunkByVoxel(x, y, z): Chunk // 坐标→Chunk 映射
  └─ generate(seed): void            // 程序世界生成

Chunk
  ├─ cx, cy, cz: number              // Chunk 坐标（不是世界坐标）
  ├─ voxels: Uint16Array(4096)       // 16×16×16 = 4096 个体素，每个 2 字节
  │                                    // 总内存：4096×2 = 8KB / Chunk
  ├─ dirty: boolean                  // 修改标记，true 需重建渲染纹理
  ├─ lightMap: Uint8Array(4096)      // 光照值 0~255，每个体素 1 字节
  │
  ├─ get(lx, ly, lz): number         // 局部坐标读取 (0~15)
  ├─ set(lx, ly, lz, id): void
  └─ isAir(lx, ly, lz): boolean      // 快捷判断

Voxel Registry（体素类型表）
  以 Uint16 为索引的静态数组，每个条目描述一种体素的全部属性：
  {
    id: number;           // 0 = AIR（空气）
    name: string;         // "grass"
    solid: boolean;       // 是否碰撞
    transparent: boolean; // 是否透光
    color: [number,number,number]; // 基础色（无纹理时回退）
    atlasFrame: string;   // "grass_01" 对应图集中的帧名
    health: number;       // 挖掘耐久
    dropItem: string;     // 掉落物 ID
    variants: string[];   // 随机变体帧名列表
    category: 'terrain'|'wall'|'floor'|'stairs'|'liquid'|'decoration';
    connectionGroup: string; // auto-tiling 连接组（同组 tile 自动衔接）
  }
```

### 4.2 世界生成管线

```
输入：worldSeed: number（玩家输入或随机生成）
  │
  ▼
Step 1: 基础地形层（Base Terrain）
  ├── 使用 3 层 Perlin 噪声叠加（2D, 只看 x,y）
  │    ├─ 低频噪声（频率 0.005, 振幅 30）→ 大陆轮廓
  │    ├─ 中频噪声（频率 0.02, 振幅 15） → 丘陵起伏
  │    └─ 高频噪声（频率 0.08, 振幅 5）  → 局部凹凸
  │
  ├── 输出：elevation(x, y) → -5 ~ +5 的地表高度值
  │     height = baseSeaLevel + elevation
  │     海水面以下 → 水/沙；以上 → 草地/石头
  │
  ▼
Step 2: 生物群落层（Biome Distribution）
  ├── 使用 2 层附加噪声计算"温度"和"湿度"
  │    ├─ temperature(x, y) = perlin2D(x, y, freq=0.01)
  │    └─ humidity(x, y) = perlin2D(x, y, freq=0.015)
  │
  ├── 查表决定 biome 类型：
  │     ┌─────────────┬──────────────┬──────────────┐
  │     │ 高温高湿 → 丛林   │ 高温低湿 → 沙漠   │ 低温高湿 → 雪原   │
  │     │ 中温中湿 → 森林   │ 中温低湿 → 草原   │ 低温低湿 → 冻土   │
  │     └─────────────┴──────────────┴──────────────┘
  │
  ├── biome 类型影响地表 Tile 选择：
  │     森林 → grass + dirt + 树木
  │     沙漠 → sand + sandstone + 仙人掌
  │     雪原 → snow + stone + 冰
  │
  ▼
Step 3: 地下填充（Underground Fill）
  ├── Z < 0 的区域根据深度填充：
  │     Z=0 ~ -3:  泥土（带随机石头变体）
  │     Z=-3 ~ -8: 岩石（带随机矿石变体）
  │     Z=-8 以下: 深石（硬度更高）
  │
  ├── 洞穴雕刻：使用 3D Perlin 噪声
  │     for each (x, y, z) underground:
  │       if perlin3D(x, y, z, freq=0.05) > 0.3:
  │         setVoxel(x, y, z, AIR)  // 挖出洞穴
  │
  ├── 矿石分布：基于深度 + 噪声
  │     煤矿：Z=-1~-5, 阈值 0.45
  │     铁矿：Z=-3~-10, 阈值 0.50
  │     金矿：Z=-6~-15, 阈值 0.55
  │     钻石：Z=-10 以下, 阈值 0.60
  │
  ▼
Step 4: 地表装饰（Surface Decoration）
  ├── 树木：在 grass tile 上按 5% 概率放置
  │     树 = 树干 voxel (Z=0~+3) + 树冠 leaf voxel (Z=+3~+5)
  ├── 花草：在 grass tile 上按 15% 概率放置装饰 tile
  ├── 石头：2% 概率
  ├── 洞穴入口：随机选择 2~5 个地下洞穴连通到地表
  │
  ▼
输出：完整的 VoxelWorld 实例
```

### 4.3 交互机制

| 操作 | 按键 | 实现 |
|---|---|---|
| 移动 | WASD | 8 方向自由像素移动，速度 3px/frame（60fps 下 180px/s） |
| 交互 | E | 检测面前/脚下 tile → 开门/楼梯/对话/拾取 |
| 攻击 | 鼠标左键 | 朝鼠标方向挥砍，检测命中 |
| 挖掘 | 鼠标长按 | 持续对目标 tile 造成 damage，破坏后 setVoxel(AIR) |
| 建造 | B 进入模式 → 鼠标点击 | setVoxel(x, y, z, selectedTile) |
| 跳跃 | Space | 俯视角无重力跳跃（用于跨越 1 格障碍） |
| 切换视角 | R | top_down ↔ isometric |
| 背包 | Tab/B | 打开/关闭背包面板 |
| 合成 | C | 打开合成面板 |
| 菜单 | Esc | 暂停 + 系统菜单 |

---

## 5. 渲染器 — Voxel2DRenderer

### 5.1 整体架构

```
Input: VoxelWorld + CameraState (position, mode, zoom)
  │
  ▼
Step 1: 可见 Chunk 收集
  ── 根据 Camera.position 和视口大小，计算哪些 Chunk 在视口内
  ── 额外加载边缘缓冲 1 个 Chunk
  │
  ▼
Step 2: Chunk 纹理重建（仅 dirty 的 Chunk）
  ── 对每个 dirty 的可见 Chunk：
      俯视模式 → projectTopDown(chunk)
      等距模式 → projectIsometric(chunk)
  ── 结果存入 chunk.cachedTexture（OffscreenCanvas）
  ── chunk.dirty = false
  │
  ▼
Step 3: 纹理合成
  ── 将所有可见 Chunk 的 cachedTexture 按照世界坐标绘制到主 Canvas
  ── 俯视模式：Chunk 之间无缝拼接
  ── 等距模式：按距离（远→近）排序后绘制
  │
  ▼
Step 4: 实体叠加
  ── 在 Tile 层之上绘制角色、物品、NPC
  ── 使用 Y-sorting：y 坐标越大（越靠下），绘制次序越靠后
  │
  ▼
Step 5: 光照叠加
  ── 在实体层之上叠加阴影遮罩（Lightmap）
  ── blend mode: multiply
  │
  ▼
Step 6: UI 叠加
  ── DOM 层覆盖在 Canvas 之上
```

### 5.2 俯视投影算法 — `projectTopDown(chunk)`

```javascript
/**
 * 俯视投影：从 Z 轴正方向看下去，Z 值越大的体素越靠前
 * 每个体素最多绘制 3 个面：顶面（top）、南侧面（south）、东侧面（east）
 * 
 * 伪代码：
 */
function projectTopDown(chunk, atlas) {
  const canvas = new OffscreenCanvas(512, 512); // 16×16 × 32px
  const ctx = canvas.getContext('2d');
  
  // 从高到低遍历 Z（高处的体素可能遮挡低处的顶面）
  for (let z = 15; z >= 0; z--) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const voxelId = chunk.voxels[z * 256 + y * 16 + x];
        if (voxelId === 0) continue; // 空气跳过
        
        const tileDef = registry.get(voxelId);
        const pixelX = x * 32;
        const pixelY = y * 32;
        
        // 画顶面 —— 始终绘制
        drawTileFace(ctx, atlas, tileDef.atlasFrame, pixelX, pixelY);
        
        // 画南侧面 —— 只有南侧暴露时才画（z-1 是空气或 chunk 边界）
        if (z === 0 || chunk.voxels[(z-1) * 256 + y * 16 + x] === 0) {
          const variant = tileDef.category === 'wall' ? tileDef.atlasFrame + '_side' : tileDef.atlasFrame;
          drawSouthFace(ctx, atlas, variant, pixelX, pixelY);
        }
        
        // 画东侧面 —— 只有东侧暴露时才画（y+1...）
        if (y === 15 || chunk.voxels[z * 256 + (y+1) * 16 + x] === 0) {
          drawEastFace(ctx, atlas, variant, pixelX + 1, pixelY + 1);
        }
      }
    }
  }
  
  return canvas;
}
```

### 5.3 等距投影算法 — `projectIsometric(chunk)`

```
等距投影规则：
  将 3D 体素坐标 (x, y, z) 投影到 2D 屏幕坐标 (screenX, screenY)：
  
  screenX = (x - y) * TILE_W * 0.5
  screenY = (x + y) * TILE_H * 0.25 - z * TILE_H * 0.5
  
  其中 TILE_W = 32, TILE_H = 32
  
  投影后效果（从东北方向 45° 俯视）：
  
       ╱‾‾‾╲‾‾‾╲
      ╱  高  ╲  中  ╲
     ╱  层  ╲  层  ╲
     ╲  Z=2 ╱  Z=1 ╱
      ╲    ╱    ╱
       ╲╱  ╲╱
        地表 Z=0

排序规则（画家算法）：
  按照 (x + y + z) 的值从小到大排序 → 近的（小）先画，远的（大）后画
  或者更精确：按从远到近（屏幕坐标从远到近）排序
       d = x + y - z
  按 d 从小到大绘制，确保远处的体素先画，近处的后画（覆盖远处的）
```

### 5.4 Auto-Tiling 规则（纹理自动融合）

```
核心原理：
  每个 Tile 根据其 4 个相邻 tile（上下左右）的类型，自动选择纹理变体。
  使用 4-bit mask 编码相邻状态。

mask 编码规则：
  bit 0 (值 1): ↑ 上方邻居与自己不同
  bit 1 (值 2): ↓ 下方邻居与自己不同  
  bit 2 (值 4): ← 左方邻居与自己不同
  bit 3 (值 8): → 右方邻居与自己不同

  mask 范围：0（四面相同）~ 15（四面都不同）

对于 "草地" 这类 tile，需要 16 个过渡变体：
  mask=0: 纯草地（四面都是草地）
  mask=1: 上边缘（上方是泥土）
  mask=2: 下边缘
  mask=3: 上下边缘
  mask=4: 左边缘
  mask=8: 右边缘
  mask=12: 左右边缘
  mask=5: 上+左
  ...共 16 种

纹理图集中的布局：
  16 个变体按 mask 顺序排列在 4×4 网格中：
  
  ┌─────┬─────┬─────┬─────┐
  │ 0   │ 1   │ 2   │ 3   │
  ├─────┼─────┼─────┼─────┤
  │ 4   │ 5   │ 6   │ 7   │
  ├─────┼─────┼─────┼─────┤
  │ 8   │ 9   │ 10  │ 11  │
  ├─────┼─────┼─────┼─────┤
  │ 12  │ 13  │ 14  │ 15  │
  └─────┴─────┴─────┴─────┘

Auto-tiling 函数：
  function getAutoTileVariant(chunk, lx, ly, lz, tileDef) {
    const group = tileDef.connectionGroup;
    if (!group) return 'default'; // 不参与自动连接
    
    let mask = 0;
    // 检查上
    if (ly > 0 && chunk.get(lx, ly-1, lz) !== tileDef.id) mask |= 1;
    // 检查下
    if (ly < 15 && chunk.get(lx, ly+1, lz) !== tileDef.id) mask |= 2;
    // 检查左
    if (lx > 0 && chunk.get(lx-1, ly, lz) !== tileDef.id) mask |= 4;
    // 检查右
    if (lx < 15 && chunk.get(lx+1, ly, lz) !== tileDef.id) mask |= 8;
    
    return `${tileDef.name}_transition_${mask}`;
  }
```

### 5.5 纹理融合（Biome 边界过渡）

```
Biome 边界的纹理融合分 3 层：

第 1 层：Biome 基础 Tile（如 forest_grass vs desert_sand）
  在 biome 边界，直接使用 auto-tiling 的 mask 机制
  mask 检查的是"与自己不同的 tile"→ 如果森林和沙漠相邻
  → 森林 tile 检测到邻居是沙地 → 选择"边缘变体"
  → 沙地 tile 检测到邻居是草地 → 选择"边缘变体" 
  → 视觉上是森林→沙地之间有 1 格宽的过渡带

第 2 层：随机变体选择
  在过渡带上，除了 auto-tiling 的 mask 变体，还叠加随机变体：
  
  function getTileVariant(x, y, z, biomeMask, seed) {
    const baseVariant = getAutoTileVariant(chunk, lx, ly, lz, tileDef);
    // 叠加随机装饰（花、草、小石头）
    const hash = hash3(x, y, z, seed);
    if (hash % 100 < 15) { // 15% 概率
      return baseVariant + '_deco_' + (hash % 4);
    }
    return baseVariant;
  }

第 3 层：色彩混合（可选）
  在 biome 边界 2~3 格范围内，对 tile 颜色做线性插值：
  forest_grass 的绿色 (#4a7a2e) → desert_sand 的黄色 (#c4a64a)
  通过修改 tile 渲染时的色相/饱和度实现
  实现方式：在 OffscreenCanvas 绘制时使用 ctx.globalAlpha + 覆盖层
```

### 5.6 光照系统

```
双 Pass 渲染：

Pass 1 — 基础色层：
  绘制所有可见 tile（已含 auto-tiling 和随机变体）
  绘制所有实体（角色、NPC、物品）
  输出：baseColorLayer（全彩色）

Pass 2 — 光照遮罩层（Lightmap）：
  每个光源生成径向渐变纹理：
    中心：亮 (rgba 255,255,255,255)
    边缘：暗 (rgba 0,0,0,255)
  使用 "multiply" 混合模式与 baseColorLayer 合成：
  
  光源类型：
    火把：半径 6 tile, 暖色 (#ff8833)
    篝火：半径 10 tile, 暖色 (#ff5500)
    发光矿石：半径 4 tile, 冷色 (#44aaff)
    月光（全局）：半径无限, 冷色 (#2244aa, alpha=0.3)
  
  玩家周围始终有一个半径 2 tile 的不可见光源（防止全黑）
  
  性能优化：
    1. Lightmap 在单独的 OffscreenCanvas 上计算（分辨率减半 160×90）
    2. 放大到 320×180 后与场景合成
    3. 静态光源（火把、篝火）的 Lightmap 缓存到 Chunk 中
    4. 仅动态光源（玩家火把、发光怪物）每帧更新
```

---

## 6. 角色动画 — 精灵表与骨骼动画混合

### 6.1 混合策略

```
本游戏采用分层混合方案：

┌──────────────────────────────────────────┐
│  基础动作：精灵表（Sprite Sheet 序列帧）   │  ← 行走、跑步、待机
│  用逐帧序列帧播放，每帧 32×48 像素         │
├──────────────────────────────────────────┤
│  装备层：骨骼动画（Skeletal Attachment）   │  ← 武器、盾牌、头盔
│  骨骼附着点在精灵帧上固定位置              │
├──────────────────────────────────────────┤
│  效果层：粒子/覆盖（Particle Overlay）    │  ← 受伤闪红、Buff 光环
│  独立于精灵帧之上的视觉效果                │
└──────────────────────────────────────────┘
```

### 6.2 精灵表（Sprite Sheet）规范

```
每张精灵表 = 一个角色的一个动作的所有方向帧

文件命名规则：
  {角色名}_{动作}_{方向}.png
  ───────────────────
  角色名: player, npc_villager, monster_slime, ...
  动作: idle, walk, attack, hurt, die, mine, use, ...
  方向: down, left, right, up (4 方向)

精灵表布局（每个方向一横行）：
  
  player_walk.png (128×192 像素)
  ┌─────┬─────┬─────┬─────┐
  │ F1  │ F2  │ F3  │ F4  │  ← 朝下 (down) 4 帧
  ├─────┼─────┼─────┼─────┤
  │ F1  │ F2  │ F3  │ F4  │  ← 朝左 (left) 4 帧
  ├─────┼─────┼─────┼─────┤
  │ F1  │ F2  │ F3  │ F4  │  ← 朝右 (right) 4 帧
  ├─────┼─────┼─────┼─────┤
  │ F1  │ F2  │ F3  │ F4  │  ← 朝上 (up) 4 帧
  └─────┴─────┴─────┴─────┘
  每帧尺寸: 32×48 像素
  总尺寸: 128×192 像素

图集索引 JSON 示例：
{
  "player_walk": {
    "image": "assets/sprites/player_walk.png",
    "frameWidth": 32,
    "frameHeight": 48,
    "framesPerRow": 4,
    "directions": ["down", "left", "right", "up"],
    "frameCount": 4,          // 每方向 4 帧
    "animationSpeed": 0.15,    // 每帧 150ms
    "loop": true
  }
}
```

### 6.3 骨骼附着点（Attachment Points）

```
骨骼动画在这里不是完整的骨架系统，
而是指"精灵帧上的固定坐标点，用于附加装备/配件"。

脊椎骨的 X 光概念 — 角色只有几个关键附着点：
  
  角色精灵 (32×48)：
  ┌──────────────────┐
  │                  │
  │   😊 头部       │  ← head: (16, 8)
  │                  │
  │     身体         │
  │   💪╲    ╱👉    │  ← leftHand: (6, 24), rightHand: (26, 24)
  │      ╲  ╱       │
  │       ╲╱        │
  │     🦵  🦵       │  ← feet: (10, 44), (22, 44)
  │                  │
  └──────────────────┘

附着点在 atlas-index.json 中定义：
{
  "player_skeleton": {
    "attachments": {
      "head":       { "x": 16, "y": 8,  "slot": "helmet" },
      "body":       { "x": 16, "y": 24, "slot": "chestplate" },
      "leftHand":   { "x": 6,  "y": 24, "slot": "weapon" },
      "rightHand":  { "x": 26, "y": 24, "slot": "shield" },
      "feet":       { "x": 16, "y": 44, "slot": "boots" }
    }
  }
}

渲染时：
  1. 先画角色精灵帧
  2. 然后在每个附着点位置叠加装备 sprite
  3. 装备 sprite 跟着精灵帧一起旋转（基于角色朝向）

切换逻辑：
  如果角色没有装备 → 只画精灵帧（省略骨骼层）
  如果有装备 → 精灵帧 + 装备 sprite 叠加
  如果动画帧切换 → 附着点坐标跟随帧变化（每帧的附着点坐标可不同）
```

### 6.4 动画状态机

```
角色动画由有限状态机控制：

        ┌──────────┐
        │   idle    │ ←──── 默认状态
        └────┬─────┘
             │ 移动输入
             ▼
        ┌──────────┐
        │  walk    │ ←──── 4 方向 + 8 方向混合
        └────┬─────┘
             │ 停止移动
             ▼
        ┌──────────┐
        │   idle   │
        └────┬─────┘
             │ 攻击键
             ▼
        ┌──────────┐      动画播放完毕后
        │  attack  │ ────────────→ idle
        └────┬─────┘
             │ 受伤
             ▼
        ┌──────────┐      动画播放完毕后
        │  hurt    │ ────────────→ idle
        └────┬─────┘
             │ HP=0
             ▼
        ┌──────────┐
        │  die     │ ────────────→ 游戏结束/复活
        └──────────┘

状态转移由 Input 事件和 CombatSystem 事件驱动，
通过 EventBus 通信：
  bus.emit('input:action', { action: 'attack', state: 'pressed' });
  → AnimationSystem 监听到 → 切换到 attack 动画
```

---

## 7. 纹理图集标准

### 7.1 图集分类

| 图集名称 | 内容 | 单 tile 尺寸 | 图集尺寸 | 格式 |
|---|---|---|---|---|
| `terrain.png` | 地形 tile + 过渡变体 | 32×32 | 2048×2048 | PNG RGBA 8bit |
| `buildings.png` | 建筑部件 | 32×32 | 1024×1024 | PNG RGBA 8bit |
| `items.png` | 物品图标 | 32×32 | 512×512 | PNG RGBA 8bit |
| `ui.png` | UI 元素 | 可变 | 1024×1024 | PNG RGBA 8bit |
| `player_sheet.png` | 角色精灵表 | 32×48 | 每动作 128×192 | PNG RGBA 8bit |
| `effects.png` | 粒子/特效 | 16×16~32×32 | 512×512 | PNG RGBA 8bit |

### 7.2 图集索引文件格式

```json
{
  "atlasName": "terrain",
  "imagePath": "assets/textures/atlas/terrain.png",
  "tileWidth": 32,
  "tileHeight": 32,
  "tiles": {
    "grass_01": { "x": 0, "y": 0 },
    "grass_02": { "x": 1, "y": 0 },
    "grass_03": { "x": 2, "y": 0 },
    "grass_04": { "x": 3, "y": 0 },
    "grass_transition_0":  { "x": 0, "y": 1 },
    "grass_transition_1":  { "x": 1, "y": 1 },
    "...": {}
  }
}
```

---

## 8. 性能目标

| 指标 | 目标 |
|---|---|
| 固定帧率（fixedUpdate） | 60 Hz (16.67ms 步长) |
| 渲染帧率（render） | ≥ 60fps（低配 30fps 保底） |
| 可见 Chunk 数 | ~9 Chunks (3×3) |
| 同时活动实体数 | ≤ 200 |
| 动态光源数 | ≤ 32 |
| 单 Chunk 重建耗时 | ≤ 3ms |
| 全量 Lightmap 计算 | ≤ 2ms |
| 内存占用（世界 100×100 Chunk）| ≤ 200MB |
| 首次加载时间 | ≤ 5 秒 |

---

## 9. 开发路线图

```
Phase 1 (Month 1-2) — 引擎骨架
  ├── Electron + Vite + TypeScript 脚手架
  ├── GameLoop + EventBus + Time
  ├── VoxelWorld + Chunk 数据层
  ├── Voxel2DRenderer（俯视模式）
  └── 输入系统 + 玩家移动 + Tile 碰撞

Phase 2 (Month 3-4) — 世界与建造
  ├── 世界生成器（Perlin 噪声 + Biome）
  ├── Auto-tiling + 随机变体
  ├── BuildingSystem（搭建）
  ├── 挖掘/破坏系统
  └── 相机切换（俯视↔等距）

Phase 3 (Month 5-6) — 战斗与生存
  ├── 武器 + 攻击方向判定
  ├── 部位伤害 + 状态效果
  ├── NPC AI（寻路 + 行为树）
  ├── 生存数值（HP/饥饿/理智/体力）
  └── 物品系统 + 背包 UI

Phase 4 (Month 7-8) — 种田与社交
  ├── 耕作系统（耕地/播种/浇水/收获）
  ├── 季节系统
  ├── NPC 社交 + 对话树
  └── 任务/节日系统

Phase 5 (Month 9-10) — 打磨
  ├── 光照系统 + 粒子效果
  ├── 音效/音乐集成
  ├── 存档/读档
  ├── 性能优化
  ├── 瘦金体 UI 主题完善
  └── Electron 打包发布准备
```

---

*文档结束 — 所有规格参数可直接用于开发实现*
