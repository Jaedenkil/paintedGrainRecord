# AI 像素素材生成提示词 — 2.5D 等轴方块纹理

> **对应项目：** 《云汲仙田录》
> **引擎管线：** [`IsoTextureTransformer.mjs`](../src/engine/loader/IsoTextureTransformer.mjs)
> **美术规范：** [`docs/05_美术设计/01_美术风格.md`](docs/05_美术设计/01_美术风格.md)
> **生成目标：** 供等轴纹理变换管道（旋转45° + 垂直压缩 + 平行四边形剪切）使用的 16×16 像素三面源贴图

---

## 一、核心约束

你的 AI 工具需要生成 **三张独立的 16×16 像素 PNG 贴图**（顶面/左面/右面），分别对应一个物块类型的三个可见面。引擎管线会对这三张贴图自动执行等轴变换（顶面旋转 45° 并垂直压缩 50% 为菱形；左/右面剪切为平行四边形），最终预烘焙为一张完整的等轴方块纹理。

**你不需要生成等轴视角的成品图，只需生成三张平铺的 16×16 方形纹理。**

---

## 二、像素绘制规范

### 2.1 光源方向与明度

| 面 | 光源强度 | 明度比例 |
|----|---------|---------|
| **顶面 (Top)** | 100% 光照（正对光源） | 基准色 × 100% |
| **左面 (Left)** | 80% 光照（侧对光源） | 基准色 × 80% |
| **右面 (Right)** | 60% 光照（背光侧） | 基准色 × 60% |

### 2.2 轮廓区分规则（禁止描边）

三个面之间的轮廓完全依靠**三层明暗渐变层次**区分，禁止任何形式的自带描边线或外轮廓线。

| 面 | 明度层次 | 说明 |
|---|---------|------|
| **顶面 (Top)** | 100% 光照 → 像素间明度差 ≤ 15% | 仅通过纹理内部明暗变化勾勒细节，无硬边缘线 |
| **左面 (Left)** | 80% 光照 → 像素间明度差 ≤ 15% | 与顶面交界处靠 20% 整体明度差自然区分，无描边 |
| **右面 (Right)** | 60% 光照 → 像素间明度差 ≤ 15% | 与左面交界处靠 20% 整体明度差自然区分，无描边 |

**禁止条款：**
- ❌ 禁止任何 1px 深色描边线（面间或外轮廓）
- ❌ 禁止使用 `#1a1a1a` 或类似深色做外框
- ❌ 禁止像素级硬边缘勾勒

**允许的做法：**
- ✅ 使用像素间 ±10%~15% 的明度渐变来暗示边缘转折
- ✅ 依靠三面整体明度差（100%/80%/60%）形成自然的面边界
- ✅ 在转角处通过像素颜色渐变（而非线条）过渡

### 2.3 纹理精度

- 每个面保留完整的 16×16 像素纹理细节
- 顶面：地表纹理（草叶杂点、石板裂缝、沙粒、土垄等）
- 左/右面：截面纹理（土粒层理、木纹竖线、石纹横线、砖缝等）
- 两垂直面的纹理图案相同，仅颜色按明度公式区分

---

## 三、场景色板与方块类型

### 场景一：青竹谷（翠绿/暖棕色调）

| 方块类型 | 顶面色 (Top) | 左面色 (Left) | 右面色 (Right) |
|---------|-------------|--------------|---------------|
| **草地 (grass)** | `#4a7c59` | `#3b6347` | `#2c4a35` |
| **泥路 (dirt)** | `#9c7a3c` | `#7d6130` | `#5e4924` |
| **木板 (plank)** | `#b8946a` | `#937652` | `#6e583a` |
| **耕田 (farm)** | `#5a4a2a` 带平行田垄线 | `#4a3a20` | `#3a2a18` |

### 场景二：落霞山脉（灰岩/暖沙色调）

| 方块类型 | 顶面色 (Top) | 左面色 (Left) | 右面色 (Right) |
|---------|-------------|--------------|---------------|
| **石头 (stone)** | `#8d8d8d` | `#717171` | `#555555` |
| **沙地 (sand)** | `#d4c48a` | `#aa9c6e` | `#807452` |
| **砖块 (brick)** | `#c47a5a` | `#9d6148` | `#764836` |
| **屋顶瓦 (roof)** | `#8a3a2a` (深红) | `#6e2e20` | `#522218` |

### 场景三：幽暗密林（深绿/暗棕色调）

| 方块类型 | 顶面色 (Top) | 左面色 (Left) | 右面色 (Right) |
|---------|-------------|--------------|---------------|
| **草地 (grass)** | `#3a5c44` | `#2e4a36` | `#223828` |
| **泥路 (dirt)** | `#7a5e3e` | `#624b32` | `#4a3826` |

### 场景四：特殊方块

| 方块类型 | 顶面色 (Top) | 特殊规则 |
|---------|-------------|---------|
| **水面 (water)** | `#4a8fc0` (50% alpha 半透明) | 顶面半透明显示下方纹理；垂直面使用渐变透明度（上深下浅） |
| **岩浆 (magma)** | `#e76f51` (自发光) | 顶面需要 4 帧循环的动态发光，垂直面暗红渐变 |
| **玉石 (jade)** | `#6aac8a` (翠绿半透光) | 翠绿色带白色脉络纹理，模拟玉石质感 |
| **雪块 (snow)** | `#e8e8f0` | 白色带浅蓝色调，表面有颗粒感 |
| **云块 (cloud)** | `#f0f0f8` (半透明白) | 蓬松卷云纹理，边缘柔化 |
| **发光方块** | 任意基准色 + 叠加发光光晕 | 聚灵阵、灵脉等，可在顶面叠加额外发光层 |

---

## 四、分面纹理设计指南

### 4.1 顶面（Top Face）— 16×16

这是物块最显眼的面，需要最丰富的纹理细节。

**纹理图案类型：**
- **草地**：随机布置 2-3px 大小的草叶点阵（使用更亮的绿色点），散布 1px 的杂色颗粒
- **石板**：1-2px 宽的裂缝线（2~3 条），交叉成不规则多边形
- **泥土**：均匀散布的深色/浅色杂点，模拟土粒质感
- **木板**：2-3 条平行木纹线，沿 45° 方向延伸
- **沙地**：密集的小颗粒点阵，颜色微变
- **耕田**：等距平行田垄线（间距 4px），线间颜色略深
- **水面**：波浪形透明渐变，可叠加 1-2 个白色高光点
- **岩浆**：橙色/红色渐变，中间亮边缘暗，模拟熔岩流动
- **玉石**：白色不规则脉纹（1px 宽，2-3 条分叉）
- **雪块**：白色基底 + 浅蓝阴影 + 散布的高光白点

### 4.2 左面（Left Face）— 16×16

垂直截面纹理，表现物块的侧面材质。

**纹理图案类型：**
- **泥土/草地**：水平层理线（2-3 条，间距 4-6px），上层浅下层深，模拟土层
- **石头**：横向裂纹（1px 宽，1-2 条），垂直方向少量杂质点
- **木板**：2-3 条垂直木纹线，间距不等，模拟木板截面
- **砖块**：水平砖缝线（每 8px 一条），垂直砖缝线交错（错缝排列）
- **沙地**：松散颗粒垂直线条
- **水面**：从上到下由浅蓝渐变到深蓝，透明度 40%→20%
- **岩浆**：暗红色基底 + 垂直亮橙色条纹（模拟岩浆流动路径）

### 4.3 右面（Right Face）— 16×16

纹理图案与左面相同，颜色按明度公式取 60%，更暗。

---

## 五、变体生成规则

每种方块类型至少需要 **2 个变体**（通过像素级微调实现），变体之间的色值差异 ≤ 10%。

**变体生成方法：**
1. 对基础纹理的图案元素做 ±1~2px 的随机偏移
2. 对杂色颗粒做随机增/减
3. 对裂缝/木纹的位置做微调偏移
4. 整体颜色色相偏移 ≤ 5°（保持不变体感）

---

## 六、输出格式要求

```
output/
  block_{type}_top.png     — 16×16 PNG，顶面纹理
  block_{type}_left.png    — 16×16 PNG，左面纹理  
  block_{type}_right.png   — 16×16 PNG，右面纹理
```

示例（现有占位资源结构）：
```
assets/placeholder/placeholder_block_grass_top.png
assets/placeholder/placeholder_block_grass_left.png
assets/placeholder/placeholder_block_grass_right.png
assets/placeholder/placeholder_block_stone_top.png
assets/placeholder/placeholder_block_stone_left.png
assets/placeholder/placeholder_block_stone_right.png
```

---

## 七、提示词模板（供 AI 图像生成工具使用）

### 针对 Midjourney / DALL-E / Stable Diffusion 的通用提示词

```
16x16 pixel art texture tile, [方块类型] top surface, isometric game asset,
top-down view, [场景色系] color palette,
detailed pixel texture with [纹理图案描述],
light source from top-left corner,
flat square tile, seamless tileable, no perspective,
game asset style, retro pixel art, 16x16 resolution, pure square, no background
```

### 具体示例 — 草地方块顶面

```
16x16 pixel art texture tile, grass block top surface, isometric game asset,
top-down view, green color palette (#4a7c59 base),
detailed pixel texture with grass blade dots and scattered dirt particles,
light source from top-left corner,
flat square tile, seamless tileable, no perspective,
game asset style, retro pixel art, 16x16 resolution, pure square, no background
```

### 具体示例 — 草地方块左面（注意颜色更暗）

```
16x16 pixel art texture tile, grass block left side surface, isometric game asset,
side view, darker green color palette (#3b6347 base),
detailed pixel texture with horizontal soil layers and root particles,
light source from top-left corner, 80% brightness,
flat square tile, seamless tileable, no perspective,
game asset style, retro pixel art, 16x16 resolution, pure square, no background
```

### 具体示例 — 石砖方块顶面

```
16x16 pixel art texture tile, stone brick block top surface, isometric game asset,
top-down view, gray color palette (#8d8d8d base),
detailed pixel texture with 2-3 crack lines forming irregular polygons,
light source from top-left corner,
flat square tile, seamless tileable, no perspective,
game asset style, retro pixel art, 16x16 resolution, pure square, no background
```

---

## 八、现有占位资源清单（供参考替换）

目前已生成的占位资源（位于 `assets/placeholder/`），可用新的高质量纹理替换：

| 方块类型 | 三面文件 | 色系 |
|---------|---------|------|
| brick | `placeholder_block_brick_{top,left,right}.png` | 红砖 |
| cloud | `placeholder_block_cloud_{top,left,right}.png` | 白色半透 |
| dirt | `placeholder_block_dirt_{top,left,right}.png` | 棕色 |
| farm | `placeholder_block_farm_{top,left,right}.png` | 耕田土色 |
| grass | `placeholder_block_grass_{top,left,right}.png` | 翠绿 |
| jade | `placeholder_block_jade_{top,left,right}.png` | 翠玉 |
| plank | `placeholder_block_plank_{top,left,right}.png` | 木色 |
| roof | `placeholder_block_roof_{top,left,right}.png` | 深红瓦 |
| sand | `placeholder_block_sand_{top,left,right}.png` | 沙色 |
| snow | `placeholder_block_snow_{top,left,right}.png` | 雪白 |
| stone | `placeholder_block_stone_{top,left,right}.png` | 灰色 |
| water | `placeholder_block_water_{top,left,right}.png` | 蓝色半透 |
