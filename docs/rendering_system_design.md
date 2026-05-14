# 渲染系统完整设计方案

> **对应项目：** 《云汲仙田录》
> **技术栈：** Electron + JavaScript (ES2022+) + WebGL (PixiJS v8+) + 自研核心框架
> **关联文档：** [`Electron_JS_自研引擎技术方案.md`](Electron_JS_自研引擎技术方案.md) · [`技术设计/02_架构与模块.md`](04_技术设计/02_架构与模块.md)
> **核心模块：** [`core/Engine.js`](../src/engine/core/Engine.js) · [`core/GameLoop.js`](../src/engine/core/GameLoop.js) · [`core/EventBus.js`](../src/engine/core/EventBus.js) · [`core/Time.js`](../src/engine/core/Time.js)

---

## 目录

1. [渲染管线的分层结构](#一渲染管线的分层结构)
2. [与核心循环的集成方式](#二与核心循环的集成方式)
3. [渲染上下文的选择与初始化方案](#三渲染上下文的选择与初始化方案)
4. [场景图与渲染对象的组织](#四场景图与渲染对象的组织)
5. [Y-Sort 排序实现原理](#五y-sort-排序实现原理)
6. [与事件系统和时间系统的协作](#六与事件系统和时间系统的协作)
7. [完整渲染系统设计总结](#七完整渲染系统设计总结)

---

## 一、渲染管线的分层结构

渲染管线不是一条平铺的流水线，而是一个 **四层栈**，从底层的 GPU 驱动一直堆到上层的游戏对象。每一层只对相邻层负责，不越级通信。

### 第 0 层：硬件抽象层（WebGL Surface）

这是最靠近金属的一层。引擎不直接调用 WebGL API，而是通过 **PixiJS v8+** 封装。选 PixiJS 而非裸 WebGL 的理由有三：

- **对 2D 像素游戏而言，PixiJS 的 Sprite 批处理（WebGL 下的 instanced draw）是开箱即用的核心能力**，我们自己写至少多花三周来实现等价的合批逻辑。
- **PixiJS 的 Texture 管理直接对接 GPU 显存**，它内部的 Texture GC（当引用计数归零时自动释放 WebGLTexture）恰好契合我们"场景切换需快速释放/加载资源"的需求。
- **最重要的技术绑定点**：`PixiJS.Renderer` 的 `render()` 调用是整个管线的出口，我们所有上层操作最终都汇聚到这一行。

但技术方案明确了一件事：**核心引擎代码不直接 import PixiJS**。我们在 `render/` 目录下设计一个 `RendererAdapter` 接口层，PixiJS 的实现作为适配器注入。这是为了将来万一 PixiJS 不再维护，我们可以换到 Canvas2D 或 Three.js 的 SpriteRenderer，而不动引擎核心一行代码。

### 第 1 层：渲染对象管理层（Sprite / BlockSprite / CharacterSprite / SkeletalAnimationController）

这一层是"游戏对象 ←→ 可渲染对象"的映射层。每个在场景中可见的东西，最终都对应一个 `PIXI.Container` 子类实例。但关键在于：

- **`BlockSprite` 是 2.5D 专有的**：它内部包含三个子 Sprite（顶面、左面、右面），对应"云汲仙田录"45° 斜视角方块的三面渲染。它的 `setGridPosition(gx, gy, gz)` 方法负责将网格坐标变换为屏幕坐标——这是整个 2.5D 渲染系统的数学基石。
- **`SkeletalAnimationController` 是骨骼动画的驱动引擎**：角色动画采用骨骼动画系统驱动，而非传统精灵表。每个角色拥有一个骨架（`Skeleton`），由若干带父子层级关系的骨骼（`Bone`）组成，每根骨骼绑定纹理插槽（`Slot`）。动画通过关键帧插值驱动骨骼的旋转/平移/缩放，而非逐帧切换整张纹理。**动画更新仍在 variableUpdate 中**（视觉表现跟随渲染帧率），但骨骼的世界变换计算在每帧 `update()` 中执行。为确保像素风格不走样，所有旋转角度强制量化为 8 方向（45° 步进），配合 `roundPixels = true` 防止像素抖动。
- **角色在场景中不是裸 Sprite，而是 `CharacterSprite` 容器**：重构后的 `CharacterSprite` 内部不再是单个 `PIXI.Sprite`，而是一个骨架驱动的一组插槽 Sprite + `SkeletalAnimationController`（动画控制）+ `PIXI.Sprite`（阴影）+ `PIXI.Container`（血条/状态图标）。这个组合体作为一个整体添加到图层中。

### 第 2 层：图层管理栈（LayerStack）

`LayerStack` 是渲染管线的"交通警察"。它维护 8 个 `PIXI.Container`，每个对应一个语义化的渲染层。为什么是 8 层？因为"云汲仙田录"的场景构成恰好可被拆解为 8 个视觉深度：

| 层索引 | 名称 | 内容 | 是否受相机影响 | 设计理由 |
|--------|------|------|---------------|----------|
| 0 | Sky/Background | 远景山脉、天空渐变色、云层 | 是（视差） | 像素仙侠世界需要层次感的远景 |
| 1 | Ground | 地面方块 (gz=0) | 是 | 2.5D 方块世界的地基 |
| 2 | Structures | 建筑/墙壁/高地 (gz≥1) | 是 | 区分地面与上层建筑 |
| 3 | Decorations | 花草、作物、装饰物 | 是 | 与方块分离，便于区域性刷新 |
| 4 | Characters | 玩家、NPC、敌人 | 是 | 动作游戏的核心交互层 |
| 5 | Effects | 粒子特效、符箓光芒、伤害数字 | 是 | 叠加混合模式，半透明发光 |
| 6 | Shadows | 角色/方块阴影 | 是 | 2.5D 深度感的关键 |
| 7 | UI | HUD、菜单、对话 | 否 | UI 永远覆盖在画面上 |

**层间排序是固定的**（0 在最下，7 在最上），但 **层内排序由 Y-sort 动态决定**。这引出了下一个核心机制。

### 第 3 层：相机系统（Camera2D）

相机本质上是 **一个作用于 PixiJS Container 的变换矩阵**。Camera2D 每帧在 variableUpdate 阶段计算 `position + zoom + rotation`，然后通过 `container.setTransform()` 应用到包含 Layer 0~6 的根容器。Layer 7（UI）不受影响，这是通过将 UI 层挂在另一个独立的 Container 上实现的。

相机的跟随逻辑使用了 **指数平滑**（`smoothing = 0.1`），即 `pos += (target - pos) * smoothing`。为什么不用线性 lerp？因为指数平滑在目标停止时自然减速，产生"相机缓缓停住"的效果，比线性插值更符合动作游戏的视觉直觉。

---

## 二、与核心循环的集成方式

这是整个引擎最关键的接口点。渲染系统不是独立运行的，它作为 **一个 variable 类型的 GameSystem** 注册到 `GameLoop` 中。具体的集成点如下：

### 固定时间步长（fixedUpdate）阶段

渲染系统在 fixedUpdate 中 **不做任何事**。因为 fixedUpdate 是为物理和确定性逻辑准备的（60Hz），而渲染不需要确定性。但有一个例外：**`GridCollision.pickBlock()`** 的碰撞体位置更新需要随 fixedUpdate 同步，因为物理体位置在 fixedUpdate 中更新，碰撞检测的拾取区域必须与之对齐。

### 可变帧率（variableUpdate）阶段

这是渲染系统的主战场，每个游戏线程周期的执行顺序是：

```
variableUpdate(dt, interp) → 渲染系统分为三个子阶段：
  1. CameraSystem.update(dt)
     - 更新相机位置（跟随平滑）
     - 边界钳位
     - 应用变换矩阵到根 Container

  2. LayerStack.render(dt, interp)
     - 遍历 0~6 层，对每层内的子对象：
       a. 视锥剔除：检查对象是否在屏幕可见范围内
       b. CharacterSprite.update(dt, interp)：内部调用 SkeletalAnimationController.update(dt) 推进骨骼动画，更新插槽 Sprite 位置，应用位置插值
       c. Y-sort：更新对象的 zIndex（只在对象移动或新增时执行）

  3. RendererAdapter.render()
     - 调用 PixiJS 的 app.renderer.render(stage)
     - 实际触发 WebGL draw call
```

**interp（插值因子）的用法**：由于 fixedUpdate 以固定步长推进物理，而渲染帧率可能更高或更低，`interp` 用于在两个物理帧之间对渲染位置做线性插值。具体来说，角色 sprite 的位置不是直接取物理体的当前位置，而是 `prevPos + (currentPos - prevPos) * interp`。这消除了"物理步长跳跃"导致的视觉卡顿。但对于像素风格，有时候我们反而会关闭插值——因为像素的"一格一格跳"本身就是像素游戏的视觉特征，过度平滑反而丢失手感。所以我们会在 `CharacterSprite` 上提供一个 `useInterpolation` 开关，默认开启，战斗时自动关闭。

### 帧结束（tick-end）阶段

渲染完成后，`engine:tick-end` 事件被发射。此时 Debug 面板的 StatsDisplay 捕获事件，更新 FPS 数字和实体计数。这个统计面板是引擎自带的，通过 `engine.use(statsPlugin)` 注册。

---

## 三、渲染上下文的选择与初始化方案

### 为什么选 WebGL 而非 Canvas2D

"云汲仙田录"的地图场景预估包含 **数百到上千个 2.5D 方块**，加上角色、敌人、粒子特效，每个 sprite 如果使用 Canvas2D 的 `drawImage`，会迅速导致 CPU 成为瓶颈（每帧需要遍历所有对象、计算变换、绘制到 canvas）。WebGL 的批处理（batch）可以将多个 sprite 合并为一次 draw call，PixiJS 在这方面做了大量优化。

另一个关键点是：**像素风格的放大渲染**。美术规格定义内部分辨率 320×180，放大 2~3 倍到 640×360 或 960×540。WebGL 的纹理渲染天然支持 `NEAREST` 采样模式（最近邻插值），这正是像素风格所需的"不模糊、保持锯齿边缘"的效果。Canvas2D 虽然也支持 `image-rendering: pixelated`，但性能远不及 WebGL 的纹理采样。

### 初始化流程

渲染上下文的初始化发生在引擎启动阶段，顺序如下：

```
Engine.start()
  → RendererAdapter.init(canvasElement, { width: 320, height: 180, scale: 3 })
      → 创建 PIXI.Application
          → PIXI.Application 内部创建 WebGLRenderer
          → WebGLRenderer 绑定到传入的 <canvas> 元素
          → 设置背景色为场景默认色（如 #1a1a2e 夜色调）
          → 设置 resolution = 3（内部 320×180，渲染到 960×540 画布）
          → 设置 antialias = false（像素风格不需要抗锯齿）
          → 设置 roundPixels = true（像素对齐，防止子像素偏移导致的模糊）
      → 创建 LayerStack（8 个 PIXI.Container）
      → 创建 Camera2D（绑定到 Layer 0~6 的根 Container）
      → 设置默认 viewport 大小
      → 发射 'render:initialized' 事件
```

**`roundPixels = true` 这个选项极其重要**。没有它，像素精灵可能会出现 0.5px 的偏移，导致整张贴图看起来像被涂抹了一下。这是像素游戏渲染的经典陷阱。

应用层还需要处理 **窗口大小变化**：监听 `window.resize`，重新计算 PixiJS renderer 的尺寸，同时更新 Camera2D 的 `viewWidth/viewHeight`。在 Electron 环境下，这个监听通过 Electron 的 `BrowserWindow` 的 `resize` 事件转发到渲染进程。

---

## 四、场景图与渲染对象的组织

### 场景图结构

整个场景图是一棵树，根节点是 PixiJS 的 `app.stage`。但这颗树不是扁平的——我们通过 LayerStack 引入了 **垂直的层级划分**：

```
app.stage
  ├── CameraContainer (Layer 0~6 的父容器，受 Camera2D 变换影响)
  │   ├── Layer 0: PIXI.Container (Sky) → [CloudSprite, MountainSprite, ...]
  │   ├── Layer 1: PIXI.Container (Ground) → [BlockSprite*N]
  │   ├── Layer 2: PIXI.Container (Structures) → [BlockSprite*M]
  │   ├── Layer 3: PIXI.Container (Decorations) → [CropSprite, FlowerSprite, ...]
  │   ├── Layer 4: PIXI.Container (Characters) → [CharacterSprite(player), CharacterSprite(enemy), ...]
  │   ├── Layer 5: PIXI.Container (Effects) → [ParticleContainer, TalismanEffect, ...]
  │   └── Layer 6: PIXI.Container (Shadows) → [ShadowSprite*N]
  └── UIContainer (Layer 7，不随相机移动)
      └── PIXI.Container (HUD) → [HPBar, MPBar, TalismanSlot, ...]
```

**为什么用水平层级而非 Godot 式的 Y-sort 自动排序？** 因为我们有明确的需求：**角色（Layer 4）永远在方块（Layer 1）之上，特效（Layer 5）永远在角色之上**。如果使用全局 Y-sort，一个站在高处的角色可能会被"绘制"在比他矮的方块之上——这在 2.5D 视角下是错误的，因为角色无论站在哪个高度层，视觉上都不应该被方块遮挡。因此，我们通过 **固定的层索引** 和 **层内的 Y-sort** 的组合来解决问题。

### 渲染对象的数据结构

每个可渲染对象在引擎内部对应一个 `RenderNode`：

```
RenderNode {
  id: number            // 唯一标识
  layerIndex: number    // 所属层 (0~7)
  container: PIXI.Container  // 实际的显示对象
  visible: boolean       // 可见性
  sortKey: number       // Y-sort 排序键
  onRemove: () => void  // 从场景图中移除时的清理回调
}
```

当场景加载时，`BlockRenderer.buildVisualsFromGrid()` 遍历网格数据，为每个方块生成 `BlockSprite`，根据 gz 值决定放入 Layer 1（gz=0）还是 Layer 2（gz≥1）。角色由 `CharacterController` 在 spawn 时创建 `CharacterSprite`，放入 Layer 4。

### 对象的增删流程

- **新增**：`layerStack.addToLayer(index, container)` → 触发 `render:layer-changed` 事件 → 如果有需要，Camera2D 重新计算可见范围
- **移除**：调用 `container.destroy()` → PIXI 自动从父容器中移除 → 释放 GPU 纹理引用 → 引擎内部的 `RenderNode` map 删除条目
- **移动**：只是更新 `container.x/y`，不涉及场景图结构的修改，是最轻量的操作

---

## 五、Y-Sort 排序实现原理

### 为什么需要 Y-sort

在 2.5D 斜角视角中，同一个图层内的对象存在"前后遮挡"关系。例如，站在 (5, 5, 0) 的角色应该被绘制在 (6, 6, 0) 的方块 **之后**（因为 6+6 > 5+5，更"远"的对象先绘制），但应该在 (2, 2, 0) 的方块 **之前**。Y-sort 解决了同一层内对象的正确绘制顺序。

### 排序键的计算

排序的核心公式来自坐标变换的数学推导。在 45° 斜角坐标系中，屏幕 Y 坐标由 `(gx + gy) * TILE_HALF_H - gz * (TILE_HALF_H * 2)` 给出。**对象在屏幕上的 Y 值越大（越靠下），就应该越晚绘制（覆盖上面的对象）**。因此，排序键就是屏幕 Y 值——或者更精确地说：

```
sortKey = (gx + gy) * Z_BASE + gz
```

其中 `Z_BASE` 是一个足够大的常量（如 100），确保 **gx+gy 的差异优先于 gz 的差异**。为什么？因为两个方块如果 gx+gy 相同（即它们在屏幕的同一"深度带"上），高度更高的（gz 更大）应该覆盖高度更低的——所以 gz 作为次级排序。

### 在 PixiJS 中的实现

PixiJS 的 Container 有一个属性 `sortableChildren`。当设为 true 时，Container 会自动根据子节点的 `zIndex` 属性进行排序。我们不需要手动调用排序函数，只需要在每次对象位置变化时更新其 `zIndex` 即可：

```
// 当 BlockSprite 移动时：
this.zIndex = getSortKey(gx, gy, gz)

// Container 在渲染时会自动调用 sortChildren()
```

但有一个性能陷阱：**不要每帧全量排序**。PixiJS 的排序使用 JavaScript 的 Array.sort()，在子节点数量>500 时会有可感知的性能开销。优化策略：

1. **只在需要时触发排序**：维护一个 `_dirtySort` 标志，在对象新增/移动/移除时设为 true，在下一次 render 时检查并排序。如果没有变化，跳过排序。
2. **利用图层隔离**：Layer 1（地面）的方块在场景加载后几乎不动，只需要排序一次。频繁移动的只有 Layer 4（角色）和 Layer 5（特效），这两层的对象数量少（几十个），排序开销可以忽略。
3. **基于时间戳的降频**：对于地面方块这种静态对象，只在场景加载时排序一次，之后跳过。

### 特殊情况的处理

- **水面方块**：水面是半透明的，Y-sort 无法正确处理半透明叠加。我们将水面方块放在 Layer 1 的 **最上层**（zIndex 比普通地面方块高），但它们的半透明性质意味着后面的对象会被"透视"。PixiJS 的混合模式（`blendMode`）在此处发挥作用：水面使用 `PIXI.BLEND_MODES.NORMAL` 配合 alpha，确保正确的半透明效果。
- **角色 vs 方块**：角色在 Layer 4，方块在 Layer 1/2，层间不排序，所以角色永远在方块之上——这是正确的，因为 2.5D 游戏中角色不应该被方块遮挡。
- **阴影**：阴影在 Layer 6，但阴影的排序键应该和产生阴影的对象一致。实现上，ShadowSprite 监听其父对象的移动事件，同步更新自己的位置和 zIndex。

---

## 六、与事件系统和时间系统的协作

### 通过 EventBus 的通信

渲染系统不直接引用任何游戏逻辑模块。它通过 EventBus 订阅和发射事件来实现协作：

#### 渲染系统监听的事件：

| 事件 | 发射者 | 渲染系统的响应 |
|------|--------|---------------|
| `scene:activated` | SceneManager | 清空 LayerStack，加载新场景的视觉数据 |
| `block:placed` | BlockController | 在对应层新增 BlockSprite，更新 Y-sort |
| `block:removed` | BlockController | 从对应层移除 BlockSprite |
| `player:moved` | PlayerController | 更新 CharacterSprite 位置，触发阴影同步 |
| `character:animation-event` | SkeletalAnimationController | 骨骼动画关键帧事件（攻击判定、脚步声）到达时通知 CombatSystem/AudioSystem |
| `character:outfit-changed` | CharacterSprite | 换装完成，通知状态系统更新外观 |
| `combat:damage-dealt` | CombatSystem | 在 Effects 层生成伤害数字 Sprite（自动淡出移除） |
| `render:dirty-rect` | 任意模块 | 标记需要局部重绘的区域 |
| `engine:pause` | GameLoop | 暂停所有动画（AnimationController 停止推进） |
| `engine:resume` | GameLoop | 恢复所有动画 |
| `input:action` | InputManager | 相机缩放/平移（通过 InputMap 映射） |

#### 渲染系统发射的事件：

| 事件 | 触发时机 | 监听者 |
|------|---------|--------|
| `render:layer-changed` | LayerStack 内容变化 | Camera2D（重新计算可见范围） |
| `render:camera-moved` | 相机位置/缩放变化 | AudioSystem（更新 3D 音效位置） |
| `render:initialized` | PixiJS Application 创建完成 | Engine（场景管理器开始加载） |

关键在于：**渲染系统不调用任何游戏逻辑模块的方法**。它只通过事件发射来"通知"变化，由其他模块自行决定是否响应。这是"引擎即框架"中"模块间不直接引用"原则的体现。

### 与时间系统的协作

`Time` 类中的两个值对渲染系统至关重要：

1. **`time.deltaTime`（已缩放的时间增量）**：传递给 `SkeletalAnimationController.update(dt)`。这意味着当游戏暂停（`timeScale = 0`）或减速（`timeScale = 0.5`）时，角色骨骼动画的帧进度也会相应放慢或停止。这提供了"子弹时间"效果：玩家释放某种时间系符箓时，所有角色的动作（包括敌人的动画）同步减速。

2. **插值因子 interp**：作为 variableUpdate 的第二个参数传入渲染系统。它的作用是平滑两个 fixedUpdate 之间的视觉表现。如上所述，渲染系统将 interp 传递给每个 CharacterSprite，用于在物理位置之间做线性插值。

一个重要的设计细节：**粒子系统（ParticleContainer）不通过 time 系统驱动，而是自己维护一个独立的计时器**。为什么？因为粒子效果（符箓光芒、飞剑轨迹）需要"即使游戏暂停也要继续播放完"——暂停时玩家的视觉焦点应该能看到符箓的残影逐渐消散，而不是冻结在半空中。这是动作游戏体验的细节。粒子系统的计时器在 `engine:pause` 时不停止，但在 `engine:destroy` 时强制清除。

---

## 七、完整渲染系统设计总结

将以上所有内容整合，渲染系统的完整设计可以概括为：

**渲染系统是一个分层驱动、事件驱动、时间感知的视觉流水线**。它由四个层次组成：

- **底层**：PixiJS 封装的 WebGL 渲染上下文（RendererAdapter），提供硬件加速的批处理和纹理管理；
- **中层**：BlockSprite、CharacterSprite、SkeletalAnimationController、Bone、Slot 等渲染对象工厂，将游戏逻辑实体映射为可渲染的显示对象；
- **上层**：LayerStack（8 层固定层 + 层内 Y-sort 动态排序）和 Camera2D（带指数平滑跟随的视口变换器），构成渲染管线的主干；
- **最顶层**：与 Engine 的 GameLoop 集成点（以 variable 类型 System 注册），接收 dt 和 interp 两个时间参数。

渲染系统通过 `EventBus` 与外界通信，不直接引用任何游戏逻辑模块。它从时间系统获取 `deltaTime`（驱动动画）和 `interp`（驱动视觉插值），从场景管理器获取场景加载/卸载信号，从方块系统获取方块增删事件，从战斗系统获取特效触发事件。相机跟随、视锥剔除、Y-sort 排序、粒子生命周期等机制各自独立运作，但最终汇聚到一行调用：`pixiApp.renderer.render(stage)`。

这套设计没有追求"全自动排序的终极场景图"，而是 **针对"云汲仙田录"的 2.5D 方块世界 + 像素仙侠动作玩法做了精确的取舍**：

- **固定层**解决了 2.5D 的深度层次问题（角色永远在方块之上，UI 永远在最前）
- **Y-sort** 解决了同层内的前后遮挡问题（同一层的对象按屏幕 Y 值排序）
- **事件驱动**解耦了渲染与逻辑（渲染系统不拉取状态，只响应通知）
- **插值系统**弥合了物理帧率与渲染帧率的差异（interp 消除物理步长跳跃）
- **roundPixels 和 NEAREST 采样**守护了像素视觉风格的纯净性（不模糊、不抖动）

这套设计还预留了三个扩展点：

1. **RendererAdapter 接口**允许未来替换 PixiJS 为其他渲染后端
2. **LayerStack 的层数**可以扩展（但 8 层对当前项目已足够）
3. **SpritePool 对象池**为后期大量弹幕/特效场景做好了性能准备
4. **骨骼动画系统**（Skeleton + Bone + Slot + SkeletalAnimationController）支持运行时换装、动作混合、多骨骼类型扩展

---

## 八、骨骼动画系统架构（新增）

> 本节详细描述骨骼动画系统的架构设计。该设计替代了原精灵表驱动的 `AnimationController`。

### 8.1 设计理念

骨骼动画系统的设计遵循三条原则：

1. **骨骼与表现分离**：`Bone` 只管理变换（位置/旋转/缩放），`Slot` 管理纹理绑定。同一副骨架换一套纹理集即是一个新角色。
2. **像素安全优先**：所有骨骼旋转量化为 8 方向（45° 步进），从根源上消除"像素走样"（pixel creep）。牺牲自由旋转自由度，换取像素视觉的一致性。
3. **动画数据压缩**：关键帧插值（keyframe interpolation）替代逐帧序列，存储量从"帧数 × 全尺寸纹理"降为"关键帧数 × 几组浮点数"。

### 8.2 核心数据流

```
AnimationClip (关键帧序列)
       ↓
SkeletalAnimationController.update(dt)
       ↓ 关键帧插值
SkeletonPose (当前帧各骨骼变换快照)
       ↓ applyPose()
Skeleton (骨骼树)
       ↓ updateWorldTransform()
各 Bone 的世界变换矩阵
       ↓ 插槽映射
Slot Sprite 位置/旋转更新
```

### 8.3 核心类/接口

| 类 | 模块 | 职责 |
|---|------|------|
| `Bone` | `core/Bone.mjs` | 骨骼节点：本地变换 + 父子链 + 世界变换计算 |
| `Skeleton` | `core/Skeleton.mjs` | 骨架：骨骼树 + 姿态应用 + 世界变换传播 |
| `SkeletonPose` | `core/SkeletonPose.mjs` | 姿态快照：用于关键帧插值和动作混合 |
| `AnimationClip` | `core/AnimationClip.mjs` | 动画剪辑：关键帧序列 + 事件标记 |
| `SkeletalAnimationController` | `render/SkeletalAnimationController.mjs` | 动画控制器：驱动骨架播放/暂停/混合 |
| `Slot` | `render/Slot.mjs` | 纹理插槽：绑定纹理到骨骼 + 渲染偏移 |
| `BoneTextureAtlas` | `render/BoneTextureAtlas.mjs` | 骨骼纹理集：按骨骼类型索引纹理集合 |

### 8.4 骨骼类型预设

当前支持三种骨骼类型，定义在 `SKELETON_PRESETS` 中：

- **`humanoid`（人形）**：root → spine → head / arm_l / arm_r / leg_l / leg_r。适用于玩家、人形 NPC。
- **`quadruped`（四足兽形）**：root → body → head / leg_fl / leg_fr / leg_bl / leg_br / tail。适用于狼妖、虎妖等。
- **`alien`（异形）**：多肢 + 翅膀骨架。适用于 Boss、特殊敌人。

扩展新类型只需在 `SKELETON_PRESETS` 追加一条骨骼定义。

### 8.5 与渲染管线的集成

骨骼动画系统与渲染管线的集成点如下：

| 集成点 | 说明 |
|--------|------|
| `CharacterSprite.update(dt, interp)` | 在 LayerStack.render 阶段被调用，内部驱动骨骼动画和位置插值 |
| `CharacterSprite` 对外契约不变 | `setGridPosition(gx, gy, gz)`、`useInterpolation`、`destroy()` 接口与重构前一致 |
| `LayerStack` 不需要改动 | `CharacterSprite` 仍是 `PIXI.Container`，直接 `addToLayer(4, characterSprite)` |
| `Y-Sort` 不受影响 | 骨架插槽子节点从属于 `CharacterSprite` 容器，容器整体设置 `zIndex` |
| `EventBus` 新增事件 | `character:animation-event`（动画事件帧通知）、`character:outfit-changed`（换装通知） |

### 8.6 像素保护措施

```javascript
/**
 * 角度量化——将任意角度映射到最近的 8 方向角度。
 * 这是防止像素走样的核心措施。
 *
 * 传统的骨骼动画允许任意角度旋转，但在像素风格中，
 * 任意角度的纹理旋转会导致边缘锯齿漂移（pixel creep）。
 * 通过强制角度为 45° 倍数，配合 PIXI 的 roundPixels，
 * 可以保持像素画的视觉一致性。
 */
function quantizeAngle(degrees) {
    const snapped = Math.round(degrees / 45) * 45;
    return ((snapped % 360) + 360) % 360;
}
```

### 8.7 扩展性预留

| 扩展场景 | 预留设计 |
|---------|---------|
| **新增骨骼类型** | 在 `SKELETON_PRESETS` 追加一条定义即可 |
| **动作混合** | `SkeletonPose.lerp()` 提供基础插值骨架；按骨骼名称过滤可实现"下身 idle + 上身 attack"的局部混合 |
| **换装系统** | `BoneTextureAtlas.setTexture()` 支持运行时替换任意骨骼纹理 |
| **挂载点（武器/特效）** | 骨骼的 `worldEndX/Y` 提供挂载坐标，武器可作为额外 Slot 绑定到指定骨骼 |
| **多角色变体** | 相同骨骼类型 + 不同纹理集 = 视觉不同的角色 |

### 8.8 资源约定

骨骼动画的纹理资源约定：

```
res://assets/sprites/{entity}/skeleton.json         # 骨架定义
res://assets/sprites/{entity}/{bone_name}.png        # 各骨骼纹理（独立文件）

# 示例：玩家角色
res://assets/sprites/player/skeleton.json
res://assets/sprites/player/head.png
res://assets/sprites/player/body.png
res://assets/sprites/player/arm_l.png
res://assets/sprites/player/arm_r.png
res://assets/sprites/player/leg_l.png
res://assets/sprites/player/leg_r.png
```

---

> **文档版本：** v2.0
> **最后更新：** 2026-05-13
> **编写者：** Finch（游戏引擎架构师）
> **变更记录：**
> - v2.0：T9 从精灵表动画控制器重构为骨骼动画控制器；T8 CharacterSprite 内部结构相应调整；新增第 8 节"骨骼动画系统架构"（详见 [Task T8/T9 设计方案讨论](./rendering_system_tasks.md#T8--CharacterSprite-角色容器)）
