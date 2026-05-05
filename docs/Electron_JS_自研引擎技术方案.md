# Electron + JavaScript 自研 2D 游戏引擎 — 完整技术方案

> **本文档适用于：《云汲仙田录》自研引擎方案**
> **技术栈：** Electron + JavaScript (ES2022+) + WebGL (PixiJS) + 自研核心框架
> **参考分析：** [`docs/自研引擎方案可行性分析.md`](docs/自研引擎方案可行性分析.md)
> **状态：** 技术方案设计

---

## 目录

1. [总体架构设计](#1-总体架构设计)
2. [核心模块详解](#2-核心模块详解)
   - 2.1 [帧循环与时间控制](#21-帧循环与时间控制)
   - 2.2 [渲染系统](#22-渲染系统)
   - 2.3 [场景管理](#23-场景管理)
   - 2.4 [事件系统](#24-事件系统)
   - 2.5 [输入系统](#25-输入系统)
   - 2.6 [音频系统](#26-音频系统)
   - 2.7 [物理引擎](#27-物理引擎)
   - 2.8 [资源管理](#28-资源管理)
3. [性能优化策略](#3-性能优化策略)
4. [Electron 主进程与渲染进程分工](#4-electron-主进程与渲染进程分工)
5. [开发与构建流程](#5-开发与构建流程)
6. [扩展性设计](#6-扩展性设计)
7. [项目目录结构](#7-项目目录结构)
8. [编码规范与开发约束](#8-编码规范与开发约束)
9. [风险与应对策略](#9-风险与应对策略)

---

## 1. 总体架构设计

### 1.1 架构分层

```
┌─────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER                             │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Game Manager (global state)                   │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │ │
│  │  │ Save/Load │  │ Settings │  │  Time    │  │  Profiler     │  │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│                         ENGINE LAYER                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │  Scene   │ │  Event   │ │  Input   │ │  Audio   │ │ Physics  │ │
│  │ Manager  │ │  System  │ │  System  │ │  System  │ │  Engine  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────────────┐ │
│  │Resource  │ │  Plugin  │ │  Script  │ │  Game Loop / Time     │ │
│  │Manager   │ │  Manager │ │  Engine  │ │  (Core Tick Pipeline) │ │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│                       RENDERING LAYER                                │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    PixiJS (WebGL Renderer)                      │ │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌───────────┐  │ │
│  │  │Sprite │ │Anim  │ │Layer │ │Camera│ │Particle│ │ DirtyRect │  │ │
│  │  │System│ │System│ │System│ │System│ │System │ │ Optimizer │  │ │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └───────────┘  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│                       ELECTRON LAYER                                 │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐ │
│  │   Main Process (Node.js)    │  │  Renderer Process (Chromium) │ │
│  │  - Window Management        │  │  - Game Engine Instance      │ │
│  │  - IPC Bridge               │  │  - PixiJS Canvas             │ │
│  │  - Native File I/O          │  │  - Input Capture             │ │
│  │  - Steam Integration        │  │  - DevTools / Profiler       │ │
│  └──────────────────────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 模块间通信架构

借鉴 Godot 方案中的 [`SignalBus`](docs/04_技术设计/02_架构与模块.md) 模式，JavaScript 版实现如下：

```
┌─────────────────────────────────────────────┐
│              EventBus (核心事件总线)           │
│  ┌─────────────────────────────────────────┐ │
│  │  on(event, callback, context)           │ │
│  │  off(event, callback)                   │ │
│  │  emit(event, data)                      │ │
│  │  once(event, callback)                  │ │
│  │  hasListener(event)                     │ │
│  └─────────────────────────────────────────┘ │
└────────────────┬────────────────────────────┘
                 │
    ┌────────────┼────────────┬────────────┐
    ▼            ▼            ▼            ▼
┌───────┐  ┌────────┐  ┌────────┐  ┌──────────┐
│ Render│  │ Scene  │  │ Input  │  │  Game    │
│System │  │Manager │  │System  │  │ Modules  │
└───────┘  └────────┘  └────────┘  └──────────┘
```

**核心原则：**
- 模块间不得直接引用对方实例
- 所有跨模块通信通过 `EventBus` 中转
- 数据流方向：父模块 → 子模块（方法调用），子模块 → 父模块（事件冒泡）
- 全局共享状态集中在 `GameManager` 中读写

---

## 2. 核心模块详解

### 2.1 帧循环与时间控制

#### 2.1.1 架构设计

帧循环是整个引擎的"心跳"，驱动所有系统的更新。采用 **固定时间步长 + 可变渲染帧率** 的双循环模式。

```
┌─────────────────────────────────────────────────────────┐
│                    Game Loop Pipeline                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  requestAnimationFrame(tick)                            │
│       │                                                 │
│       ▼                                                 │
│  ┌─────────────────────────────────────┐               │
│  │  calcDeltaTime()                    │               │
│  │  → 计算真实时间差 dt                │               │
│  │  → 上限锁定 (maxDt = 100ms)          │               │
│  │  → 累积 accumulator += dt           │               │
│  └─────────────────────────────────────┘               │
│       │                                                 │
│       ▼  (while accumulator >= fixedDt)                 │
│  ┌─────────────────────────────────────┐               │
│  │  FIXED UPDATE (固定频率 = 60Hz)      │               │
│  │  → PhysicsWorld.step(fixedDt)       │               │
│  │  → FixedUpdate 回调                  │               │
│  │  → accumulator -= fixedDt           │               │
│  └─────────────────────────────────────┘               │
│       │                                                 │
│       ▼                                                 │
│  ┌─────────────────────────────────────┐               │
│  │  VARIABLE UPDATE (每帧)              │               │
│  │  → InputManager.poll()              │               │
│  │  → SceneManager.update(interp)      │               │
│  │  → AnimationSystem.update(dt)       │               │
│  │  → AudioSystem.update()             │               │
│  └─────────────────────────────────────┘               │
│       │                                                 │
│       ▼                                                 │
│  ┌─────────────────────────────────────┐               │
│  │  RENDER                             │               │
│  │  → CameraSystem.update()            │               │
│  │  → DirtyRectManager.flush()         │               │
│  │  → PixiJS renderer.render()         │               │
│  └─────────────────────────────────────┘               │
│       │                                                 │
│       ▼                                                 │
│  ┌─────────────────────────────────────┐               │
│  │  POST-RENDER                        │               │
│  │  → Profiler.recordFrame()           │               │
│  │  → StatsDisplay.update()            │               │
│  └─────────────────────────────────────┘               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### 2.1.2 核心实现

```javascript
// src/engine/core/GameLoop.js

export class GameLoop {
    /** @type {number} 固定物理步长（秒） */
    static FIXED_DT = 1 / 60;

    /** @type {number} 最大帧间隔，防止 spiral of death */
    static MAX_DT = 0.1;

    constructor() {
        /** @private */
        this._systems = [];
        /** @private */
        this._isRunning = false;
        /** @private */
        this._lastTime = 0;
        /** @private */
        this._accumulator = 0;
        /** @private */
        this._rafId = null;
        /** @private */
        this._frameCount = 0;
        /** @private */
        this._fps = 0;
        /** @private */
        this._fpsTimer = 0;
    }

    /**
     * 注册一个需要每帧更新的系统
     * @param {Object} system
     * @param {'fixed'|'variable'} system.type - 更新类型
     * @param {(dt: number) => void} system.update - 更新回调
     */
    addSystem(system) { this._systems.push(system); }

    /** 启动游戏循环 */
    start() {
        if (this._isRunning) return;
        this._isRunning = true;
        this._lastTime = performance.now();
        this._accumulator = 0;
        this._tick(this._lastTime);
    }

    /** 停止游戏循环 */
    stop() {
        this._isRunning = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    /**
     * @private
     * @param {number} now
     */
    _tick(now) {
        if (!this._isRunning) return;

        // 1. 计算 deltaTime
        let dt = (now - this._lastTime) / 1000;
        this._lastTime = now;
        if (dt > GameLoop.MAX_DT) dt = GameLoop.MAX_DT;

        // 2. FPS 统计
        this._frameCount++;
        this._fpsTimer += dt;
        if (this._fpsTimer >= 1.0) {
            this._fps = this._frameCount;
            this._frameCount = 0;
            this._fpsTimer -= 1.0;
        }

        // 3. 固定时间步长物理更新
        this._accumulator += dt;
        while (this._accumulator >= GameLoop.FIXED_DT) {
            this._runFixedUpdate(GameLoop.FIXED_DT);
            this._accumulator -= GameLoop.FIXED_DT;
        }

        // 4. 插值因子（用于渲染插值）
        const interp = this._accumulator / GameLoop.FIXED_DT;

        // 5. 可变帧率更新
        this._runVariableUpdate(dt, interp);

        // 6. 请求下一帧
        this._rafId = requestAnimationFrame((t) => this._tick(t));
    }

    /**
     * @private
     * @param {number} dt
     */
    _runFixedUpdate(dt) {
        for (const sys of this._systems) {
            if (sys.type === 'fixed') sys.update(dt);
        }
    }

    /**
     * @private
     * @param {number} dt
     * @param {number} interp
     */
    _runVariableUpdate(dt, interp) {
        for (const sys of this._systems) {
            if (sys.type === 'variable') sys.update(dt, interp);
        }
    }

    /** @returns {number} */
    getFps() { return this._fps; }
}
```

#### 2.1.3 时间管理 API

```javascript
// src/engine/core/Time.js

export class Time {
    constructor() {
        /** 游戏运行总时间（秒） */
        this.realtimeSinceStartup = 0;
        /** 本帧增量时间（秒） */
        this.deltaTime = 0;
        /** 固定步长增量时间 */
        this.fixedDeltaTime = 1 / 60;
        /** 时间缩放系数（1.0=正常，0.5=慢动作，2.0=加速） */
        this.timeScale = 1.0;
        /** 自游戏开始以来的帧数 */
        this.frameCount = 0;
        /** 未缩放的实际帧间隔 */
        this.unscaledDeltaTime = 0;
    }

    /**
     * 创建计时器
     * @param {number} duration - 持续时间（秒）
     * @param {() => void} onComplete - 完成回调
     * @param {boolean} [loop=false] - 是否循环
     * @returns {GameTimer}
     */
    createTimer(duration, onComplete, loop = false) { /* ... */ }

    /**
     * 延迟执行
     * @param {number} delay - 延迟秒数
     * @param {() => void} callback
     * @returns {GameTimer}
     */
    delay(delay, callback) {
        return this.createTimer(delay, callback, false);
    }

    /** 暂停所有计时器 */
    pause() { this.timeScale = 0; }

    /** 恢复 */
    resume() { this.timeScale = 1.0; }
}
```

---

### 2.2 渲染系统

#### 2.2.1 技术选型

| 组件 | 技术方案 | 理由 |
|------|---------|------|
| 底层渲染 | **PixiJS v8+** | WebGL 2D 渲染性能最佳、MIT 许可、社区活跃 |
| 精灵系统 | PixiJS `Sprite` + 自研组件封装 | 需扩展 2.5D 坐标变换 |
| 动画系统 | 自研 `AnimationController` + 精灵表驱动 | 像素风格需求，需精确帧控制 |
| 图层系统 | 自研 `LayerStack`（基于 PixiJS Container） | 8 层渲染体系 |
| 相机系统 | 自研 `Camera2D`（基于 PixiJS Container 变换） | 2.5D 视口、跟随、缩放 |
| 粒子系统 | PixiJS ParticleContainer + 自研发射器 | 符箓特效、天气系统 |

#### 2.2.2 渲染管线架构

```
┌──────────────────────────────────────────────────────────────┐
│                       RenderPipeline                          │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  每一帧的渲染流程：                                            │
│                                                               │
│  1. CameraSystem.beginFrame()                                 │
│     → 计算相机变换矩阵 (position, zoom, rotation)              │
│                                                               │
│  2. LayerStack.render()                                       │
│     ├── Layer 0: Sky/Background (静态背景层)                   │
│     ├── Layer 1: Ground (地面方块层)                           │
│     ├── Layer 2: Structures (建筑/结构层)                      │
│     ├── Layer 3: Decorations (花草装饰层)                      │
│     ├── Layer 4: Characters (角色/敌人/NPC)                    │
│     ├── Layer 5: Effects (粒子/特效层)                         │
│     ├── Layer 6: Shadows (阴影层)                              │
│     └── Layer 7: UI (HUD/菜单 - 相机无关)                     │
│                                                               │
│  3. DirtyRectManager.flush()                                  │
│     → 标记髒区域 → 仅重绘髒区域内的 Sprite                    │
│                                                               │
│  4. PixiJS.renderer.render(stage)                             │
│     → WebGL 绘制调用                                          │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

#### 2.2.3 精灵系统与 2.5D 坐标变换

```javascript
// src/engine/render/BlockSprite.js

export class BlockSprite extends PIXI.Container {
    /** 2.5D 方块三面纹理渲染 */
    constructor(blockType, variant = 0) {
        super();

        /** @private */
        this._gridX = 0;
        this._gridY = 0;
        this._gridZ = 0;

        // 三面纹理子精灵
        this._topFace = new PIXI.Sprite();
        this._leftFace = new PIXI.Sprite();
        this._rightFace = new PIXI.Sprite();

        // 根据方块类型和变体加载纹理
        this._loadFaces(blockType, variant);

        // 排列三面纹理的相对位置
        this._topFace.anchor.set(0.5, 0.5);
        this._leftFace.anchor.set(0.5, 0.5);
        this._rightFace.anchor.set(0.5, 0.5);

        this.addChild(this._topFace, this._leftFace, this._rightFace);
    }

    /**
     * 设置网格坐标 → 自动计算屏幕位置
     * @param {number} gx
     * @param {number} gy
     * @param {number} gz
     */
    setGridPosition(gx, gy, gz) {
        this._gridX = gx;
        this._gridY = gy;
        this._gridZ = gz;
        this._updateScreenPosition();
    }

    /** @private 网格→屏幕坐标转换 */
    _updateScreenPosition() {
        const TILE_HALF_W = 16;
        const TILE_HALF_H = 8;
        this.x = (this._gridX - this._gridY) * TILE_HALF_W;
        this.y = (this._gridX + this._gridY) * TILE_HALF_H
               - this._gridZ * (TILE_HALF_H * 2);
    }

    /**
     * 获取深度排序键
     * @returns {number}
     */
    getSortKey() {
        return (this._gridX + this._gridY) * 100 + this._gridZ;
    }
}
```

#### 2.2.4 图层系统

```javascript
// src/engine/render/LayerStack.js

/**
 * 渲染层管理
 *
 * 层级映射：
 *   0 = Sky/Background      (天空/远景)
 *   1 = Ground              (地面方块)
 *   2 = Structures          (建筑物)
 *   3 = Decorations         (装饰物)
 *   4 = Characters          (角色/敌人)
 *   5 = Effects             (特效/粒子)
 *   6 = Shadows             (阴影)
 *   7 = UI                  (HUD/菜单) — 不受相机影响
 */
export class LayerStack {
    /** @type {number} 总层数 */
    static LAYER_COUNT = 8;

    constructor(pixiApp) {
        /** @private */
        this._app = pixiApp;
        /** @private */
        this._layers = [];

        // 创建渲染层
        for (let i = 0; i < LayerStack.LAYER_COUNT; i++) {
            const container = new PIXI.Container();
            container.sortableChildren = true; // 启用 zIndex 排序
            container.name = `Layer_${i}`;

            if (i < 7) {
                // Layer 0~6: 跟随相机
                this._app.stage.addChild(container);
            } else {
                // Layer 7: UI 层，不跟随相机
                // 放在另一个独立容器中
                // ...
            }

            this._layers.push(container);
        }
    }

    /**
     * 获取指定层
     * @param {number} index
     * @returns {PIXI.Container}
     */
    getLayer(index) { return this._layers[index]; }

    /**
     * 向指定层添加显示对象
     * @param {number} layerIndex
     * @param {PIXI.Container} displayObject
     */
    addToLayer(layerIndex, displayObject) {
        this._layers[layerIndex].addChild(displayObject);
    }

    /**
     * 从层中移除显示对象
     * @param {number} layerIndex
     * @param {PIXI.Container} displayObject
     */
    removeFromLayer(layerIndex, displayObject) {
        this._layers[layerIndex].removeChild(displayObject);
    }

    /** 更新所有层的深度排序 */
    updateSortOrders() {
        for (const layer of this._layers) {
            // 对 layer 内的子对象按 zIndex 重新排序
            // PixiJS 的 sortableChildren = true 会自动处理
        }
    }
}
```

#### 2.2.5 相机系统

```javascript
// src/engine/render/Camera2D.js

export class Camera2D {
    /**
     * @param {PIXI.Container} targetContainer - 受相机影响的容器
     * @param {number} viewWidth - 视口宽度（像素）
     * @param {number} viewHeight - 视口高度（像素）
     */
    constructor(targetContainer, viewWidth, viewHeight) {
        /** @private */
        this._container = targetContainer;
        this._x = 0;
        this._y = 0;
        this._zoom = 1.0;
        this._rotation = 0;
        this._viewWidth = viewWidth;
        this._viewHeight = viewHeight;

        // 跟随目标
        /** @private */
        this._followTarget = null;
        this._followOffset = { x: 0, y: 0 };
        this._followSmoothing = 0.1; // 跟随平滑系数

        // 边界限制
        this._bounds = null; // { minX, minY, maxX, maxY }
    }

    /**
     * 每帧更新相机变换
     * @param {number} dt
     */
    update(dt) {
        // 1. 跟随逻辑
        if (this._followTarget) {
            const targetX = this._followTarget.x + this._followOffset.x;
            const targetY = this._followTarget.y + this._followOffset.y;

            // 平滑插值
            this._x += (targetX - this._x) * this._followSmoothing;
            this._y += (targetY - this._y) * this._followSmoothing;
        }

        // 2. 边界限制
        if (this._bounds) {
            this._x = Math.max(this._bounds.minX, Math.min(this._bounds.maxX, this._x));
            this._y = Math.max(this._bounds.minY, Math.min(this._bounds.maxY, this._y));
        }

        // 3. 应用变换到 PixiJS 容器
        this._applyTransform();
    }

    /** @private 应用变换矩阵 */
    _applyTransform() {
        // 屏幕中心作为变换原点
        const cx = this._viewWidth / 2;
        const cy = this._viewHeight / 2;

        this._container.setTransform(
            cx - this._x * this._zoom,
            cy - this._y * this._zoom,
            this._zoom, this._zoom,
            this._rotation
        );
    }

    /**
     * 设置跟随目标
     * @param {{ x: number, y: number }} target
     * @param {{ x?: number, y?: number }} [offset]
     */
    follow(target, offset = { x: 0, y: 0 }) {
        this._followTarget = target;
        this._followOffset = offset;
    }

    /** 取消跟随 */
    unfollow() { this._followTarget = null; }

    /**
     * @param {number} zoom - 缩放值 (0.25~4.0)
     */
    setZoom(zoom) {
        this._zoom = Math.max(0.25, Math.min(4.0, zoom));
    }

    /**
     * 设置相机边界
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds
     */
    setBounds(bounds) { this._bounds = bounds; }

    /**
     * 屏幕坐标 → 世界坐标
     * @param {number} screenX
     * @param {number} screenY
     * @returns {{ x: number, y: number }}
     */
    screenToWorld(screenX, screenY) {
        return {
            x: (screenX - this._viewWidth / 2) / this._zoom + this._x,
            y: (screenY - this._viewHeight / 2) / this._zoom + this._y
        };
    }

    /**
     * 世界坐标 → 屏幕坐标
     * @param {number} worldX
     * @param {number} worldY
     * @returns {{ x: number, y: number }}
     */
    worldToScreen(worldX, worldY) {
        return {
            x: (worldX - this._x) * this._zoom + this._viewWidth / 2,
            y: (worldY - this._y) * this._zoom + this._viewHeight / 2
        };
    }
}
```

#### 2.2.6 动画系统

```javascript
// src/engine/render/AnimationController.js

/**
 * 精灵表动画控制器
 *
 * 资源约定:
 *   res://assets/sprites/{entity}_{action}_{frame}.png
 *   或单个精灵表: res://assets/sprites/{entity}_{action}_sheet.png
 */
export class AnimationController {
    /**
     * @param {PIXI.Sprite} sprite - 要控制的目标精灵
     */
    constructor(sprite) {
        /** @private */
        this._sprite = sprite;
        /** @private */
        this._animations = new Map(); // name -> AnimationClip
        /** @private */
        this._currentAnim = null;
        /** @private */
        this._currentFrame = 0;
        /** @private */
        this._frameTimer = 0;
        /** @private */
        this._speed = 1.0;
        /** @private */
        this._loop = true;
        /** @private */
        this._onComplete = null;
    }

    /**
     * 注册动画剪辑
     * @param {string} name - 动画名 (e.g. 'idle', 'run', 'attack')
     * @param {AnimationClip} clip
     */
    register(name, clip) {
        this._animations.set(name, clip);
    }

    /**
     * 播放动画
     * @param {string} name
     * @param {Object} [options]
     * @param {number} [options.speed=1.0]
     * @param {boolean} [options.loop=true]
     * @param {() => void} [options.onComplete]
     */
    play(name, { speed = 1.0, loop = true, onComplete = null } = {}) {
        if (!this._animations.has(name)) {
            console.warn(`Animation "${name}" not registered`);
            return;
        }
        this._currentAnim = this._animations.get(name);
        this._currentFrame = 0;
        this._frameTimer = 0;
        this._speed = speed;
        this._loop = loop;
        this._onComplete = onComplete;

        this._applyFrame();
    }

    /**
     * 每帧更新
     * @param {number} dt
     */
    update(dt) {
        if (!this._currentAnim) return;

        this._frameTimer += dt * this._speed;

        const frameDuration = this._currentAnim.frameDuration;
        while (this._frameTimer >= frameDuration) {
            this._frameTimer -= frameDuration;
            this._currentFrame++;

            if (this._currentFrame >= this._currentAnim.frames.length) {
                if (this._loop) {
                    this._currentFrame = 0;
                } else {
                    this._currentFrame = this._currentAnim.frames.length - 1;
                    this._frameTimer = 0;
                    this._onComplete?.();
                    // 自动停止
                    return;
                }
            }

            this._applyFrame();
        }
    }

    /** @private */
    _applyFrame() {
        if (!this._currentAnim) return;
        const frame = this._currentAnim.frames[this._currentFrame];
        this._sprite.texture = frame.texture;
        if (frame.offset) {
            this._sprite.anchor.set(frame.offset.x, frame.offset.y);
        }
    }

    /** 停止当前动画 */
    stop() {
        this._currentAnim = null;
        this._currentFrame = 0;
        this._frameTimer = 0;
    }

    /** @returns {boolean} */
    isPlaying() { return this._currentAnim !== null; }
}

/**
 * 动画剪辑定义
 */
export class AnimationClip {
    /**
     * @param {Object} config
     * @param {Array<{ texture: PIXI.Texture, offset?: {x:number,y:number} }>} config.frames
     * @param {number} config.frameDuration - 每帧持续时间（秒）
     */
    constructor(config) {
        this.frames = config.frames;
        this.frameDuration = config.frameDuration;
    }

    /** @returns {number} 动画总时长（秒） */
    get duration() {
        return this.frames.length * this.frameDuration;
    }
}
```

---

### 2.3 场景管理

#### 2.3.1 场景栈架构

场景管理维护一个 **场景栈（Scene Stack）**，支持多层场景叠加（如：主游戏场景 + 上层菜单弹窗 + 下层暂停遮罩）。

```
场景栈状态示例：

  栈顶                       栈顶                       栈顶
   ↓                          ↓                          ↓
┌─────────┐               ┌─────────┐               ┌─────────┐
│ Pause   │               │  Dialog │               │         │
│ Overlay │               │  Window │               │         │
├─────────┤  openDialog() ├─────────┤  closeDialog()├─────────┤
│  Game   │  ──────────►  │  Game   │  ──────────►  │  Game   │
│  Scene  │               │  Scene  │               │  Scene  │
├─────────┤               ├─────────┤               ├─────────┤
│  Menu   │               │  Menu   │               │  Menu   │
└─────────┘               └─────────┘               └─────────┘
  栈底                       栈底                       栈底
```

#### 2.3.2 场景生命周期

每个场景都经历以下生命周期阶段：

```
                    ┌─────────────┐
                    │  CREATED    │
                    │  (new Scene)│
                    └──────┬──────┘
                           │ pushScene()
                           ▼
                    ┌─────────────┐
                    │  LOADING    │ ← 异步加载资源
                    │  (loading)  │
                    └──────┬──────┘
                           │ 资源加载完成
                           ▼
                    ┌─────────────┐
                    │  ENTERING   │ ← 入场过渡动画
                    │  (enter)    │
                    └──────┬──────┘
                           │ 过渡完成
                           ▼
                    ┌─────────────┐
              ┌────►│  ACTIVE     │◄──── 当前活跃场景
              │     │  (update)   │
              │     └──────┬──────┘
              │            │
              │  场景被覆盖   │  场景退出
              │  (push新场景) │  (popScene)
              │            ▼
              │     ┌─────────────┐
              │     │  PAUSED     │    ┌─────────────┐
              │     │  (frozen)   │    │  LEAVING    │ ← 退场过渡
              │     └──────┬──────┘    │  (leave)    │
              │            │           └──────┬──────┘
              └────────────┘                  │
                                       ┌──────▼──────┐
                                       │  DESTROYED  │ ← 释放资源
                                       │  (destroy)  │
                                       └─────────────┘
```

#### 2.3.3 场景基类

```javascript
// src/engine/scene/Scene.js

/**
 * 场景基类 - 所有场景必须继承此类
 */
export class Scene {
    constructor() {
        /** 场景唯一标识 */
        this.name = '';

        /** 场景显示容器（PixiJS Container） */
        this.container = new PIXI.Container();

        /** 场景是否已激活 */
        this._isActive = false;

        /** 场景资源列表（自动管理加载/释放） */
        this._resources = [];

        /** 场景子实体列表 */
        this._entities = [];

        /** 场景过渡状态 */
        this._transitionState = 'created';
    }

    // ==================== 生命周期钩子 ====================

    /**
     * 场景创建时调用 - 初始化场景数据
     * @abstract
     * @returns {Promise<void>}
     */
    async onCreate() { /* 子类重写 */ }

    /**
     * 场景进入时调用 - 加载资源
     * @abstract
     * @returns {Promise<void>}
     */
    async onLoad() { /* 子类重写 */ }

    /**
     * 入场过渡动画
     * @abstract
     * @param {number} duration - 过渡时长
     * @returns {Promise<void>}
     */
    async onEnter(duration = 0.5) { /* 子类重写 */ }

    /**
     * 场景激活时调用 - 开始更新
     */
    onActivate() { this._isActive = true; }

    /**
     * 每帧更新
     * @abstract
     * @param {number} dt
     */
    onUpdate(dt) {
        for (const entity of this._entities) {
            entity.update?.(dt);
        }
    }

    /**
     * 场景暂停时调用（被其他场景覆盖）
     */
    onPause() { this._isActive = false; }

    /**
     * 场景恢复时调用（上层场景弹出后）
     */
    onResume() { this._isActive = true; }

    /**
     * 退场过渡动画
     * @abstract
     * @param {number} duration
     * @returns {Promise<void>}
     */
    async onLeave(duration = 0.5) { /* 子类重写 */ }

    /**
     * 场景销毁时调用 - 释放所有资源
     */
    async onDestroy() {
        // 释放已加载的资源
        for (const res of this._resources) {
            ResourceManager.instance.release(res);
        }
        this._resources.length = 0;
        this._entities.length = 0;
        this.container.removeChildren();
        this.container.destroy({ children: true });
    }
}
```

#### 2.3.4 场景管理器

```javascript
// src/engine/scene/SceneManager.js

export class SceneManager {
    constructor() {
        /** @private 场景栈 */
        this._sceneStack = [];
        /** @private 场景注册表（name -> Scene 构造函数） */
        this._registry = new Map();
        /** @private */
        this._transitionLayer = null; // 遮罩层
    }

    /**
     * 注册场景类型
     * @param {string} name - 场景名
     * @param {typeof Scene} sceneClass - 场景类
     */
    register(name, sceneClass) {
        this._registry.set(name, sceneClass);
    }

    /**
     * 获取当前活跃场景
     * @returns {Scene|null}
     */
    getActiveScene() {
        if (this._sceneStack.length === 0) return null;
        return this._sceneStack[this._sceneStack.length - 1];
    }

    /**
     * 切换场景（清空栈并推入新场景）
     * @param {string} name
     * @param {Object} [params] - 传递给场景的参数
     * @param {number} [transitionDuration=0.5]
     */
    async switchTo(name, params = {}, transitionDuration = 0.5) {
        // 1. 退场过渡 - 当前所有场景
        await this._leaveAll(transitionDuration);

        // 2. 清空栈
        await this._destroyAll();

        // 3. 推入新场景
        await this.pushScene(name, params, transitionDuration);
    }

    /**
     * 推入新场景到栈顶（覆盖）
     * @param {string} name
     * @param {Object} [params]
     * @param {number} [transitionDuration=0.5]
     */
    async pushScene(name, params = {}, transitionDuration = 0.5) {
        // 暂停当前场景
        const current = this.getActiveScene();
        if (current) current.onPause();

        // 创建新场景实例
        const SceneClass = this._registry.get(name);
        if (!SceneClass) throw new Error(`Scene "${name}" not registered`);
        const scene = new SceneClass();

        // 生命周期: load -> enter -> activate
        scene.name = name;
        await scene.onCreate(params);
        EventBus.instance.emit('scene.loading', { name });

        await scene.onLoad();
        this._sceneStack.push(scene);
        LayerStack.addToLayer(/* 场景层 */, scene.container);

        await scene.onEnter(transitionDuration);
        scene.onActivate();

        EventBus.instance.emit('scene.activated', { name });
    }

    /**
     * 弹出栈顶场景
     */
    async popScene(transitionDuration = 0.5) {
        if (this._sceneStack.length <= 1) return;

        const leaving = this._sceneStack.pop();
        leaving.onPause();
        await leaving.onLeave(transitionDuration);
        LayerStack.removeFromLayer(/* 场景层 */, leaving.container);
        await leaving.onDestroy();

        // 恢复上一个场景
        const resumed = this.getActiveScene();
        if (resumed) resumed.onResume();

        EventBus.instance.emit('scene.resumed', { name: resumed?.name });
    }

    /** @private */
    async _leaveAll(duration) { /* ... */ }

    /** @private */
    async _destroyAll() { /* ... */ }
}
```

#### 2.3.5 场景过渡效果

```javascript
// src/engine/scene/transitions.js

/**
 * 内置场景过渡效果
 */
export const SceneTransitions = {
    /**
     * 淡入淡出
     * @param {PIXI.Container} overlay - 全屏遮罩层
     * @param {number} duration
     * @param {'in'|'out'} direction
     * @returns {Promise<void>}
     */
    async fade(overlay, duration, direction) {
        const from = direction === 'out' ? 0 : 1;
        const to = direction === 'out' ? 1 : 0;
        overlay.alpha = from;
        overlay.visible = true;

        const start = performance.now();
        return new Promise((resolve) => {
            const tick = () => {
                const elapsed = (performance.now() - start) / 1000;
                const t = Math.min(elapsed / duration, 1);
                overlay.alpha = from + (to - from) * t;

                if (t < 1) requestAnimationFrame(tick);
                else {
                    overlay.alpha = to;
                    if (direction === 'in') overlay.visible = false;
                    resolve();
                }
            };
            tick();
        });
    },

    /**
     * 像素化溶解
     * @param {PIXI.Container} overlay
     * @param {number} duration
     * @param {'in'|'out'} direction
     */
    async pixelDissolve(overlay, duration, direction) {
        // 使用 PixiJS 滤镜实现像素溶解
        // ...
    }
};
```

---

### 2.4 事件系统

#### 2.4.1 事件总线

```javascript
// src/engine/events/EventBus.js

/**
 * 全局事件总线 - 所有模块间通信的唯一通道
 *
 * 设计原则：
 * 1. 单例模式，全局唯一实例
 * 2. 事件名采用命名空间：'module:action' (e.g. 'block:placed', 'player:damaged')
 * 3. 支持通配符监听：'block:*' 监听所有方块事件
 * 4. 生命周期管理：场景销毁时自动解绑相关监听器
 */
export class EventBus {
    /** @type {EventBus} */
    static instance = null;

    /** @returns {EventBus} */
    static getInstance() {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus();
        }
        return EventBus.instance;
    }

    constructor() {
        /** @private Map<string, Set<ListenerEntry>> */
        this._listeners = new Map();
        /** @private Map<Object, Set<string>> 对象→事件名反向索引，用于自动清理 */
        this._contextBindings = new Map();
    }

    /**
     * 监听事件
     * @param {string} event - 事件名 (支持通配符 '*')
     * @param {Function} callback - (data: any) => void
     * @param {Object} [context] - 绑定的上下文对象（用于自动清理）
     * @returns {() => void} 取消监听的函数
     */
    on(event, callback, context = null) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        const entry = { callback, context };
        this._listeners.get(event).add(entry);

        // 记录上下文绑定
        if (context) {
            if (!this._contextBindings.has(context)) {
                this._contextBindings.set(context, new Set());
            }
            this._contextBindings.get(context).add(event);
        }

        // 返回解绑函数
        return () => this.off(event, callback);
    }

    /**
     * 一次性监听
     * @param {string} event
     * @param {Function} callback
     * @param {Object} [context]
     * @returns {() => void}
     */
    once(event, callback, context = null) {
        const wrapper = (data) => {
            this.off(event, wrapper);
            callback(data);
        };
        return this.on(event, wrapper, context);
    }

    /**
     * 取消监听
     * @param {string} event
     * @param {Function} callback
     */
    off(event, callback) {
        const listeners = this._listeners.get(event);
        if (!listeners) return;
        for (const entry of listeners) {
            if (entry.callback === callback) {
                listeners.delete(entry);
                break;
            }
        }
        if (listeners.size === 0) this._listeners.delete(event);
    }

    /**
     * 发射事件
     * @param {string} event
     * @param {*} data
     */
    emit(event, data = null) {
        // 精确匹配
        const listeners = this._listeners.get(event);
        if (listeners) {
            for (const entry of listeners) {
                entry.callback.call(entry.context, data);
            }
        }

        // 通配符匹配 ('module:*')
        const wildcard = event.split(':')[0] + ':*';
        if (wildcard !== event) {
            const wildListeners = this._listeners.get(wildcard);
            if (wildListeners) {
                for (const entry of wildListeners) {
                    entry.callback.call(entry.context, { event, data });
                }
            }
        }

        // 全局通配符 '*'
        const globalListeners = this._listeners.get('*');
        if (globalListeners) {
            for (const entry of globalListeners) {
                entry.callback.call(entry.context, { event, data });
            }
        }
    }

    /**
     * 检查是否有指定事件的监听器
     * @param {string} event
     * @returns {boolean}
     */
    hasListener(event) {
        return this._listeners.has(event) && this._listeners.get(event).size > 0;
    }

    /**
     * 清理指定上下文的所有监听器
     * @param {Object} context
     */
    removeContext(context) {
        const events = this._contextBindings.get(context);
        if (!events) return;
        for (const event of events) {
            const listeners = this._listeners.get(event);
            if (!listeners) continue;
            for (const entry of listeners) {
                if (entry.context === context) {
                    listeners.delete(entry);
                }
            }
            if (listeners.size === 0) this._listeners.delete(event);
        }
        this._contextBindings.delete(context);
    }

    /** 清空所有监听器 */
    clear() {
        this._listeners.clear();
        this._contextBindings.clear();
    }
}
```

#### 2.4.2 事件命名规范

```
事件命名格式: {模块}:{动作}

系统级事件:
  engine:ready          - 引擎初始化完成
  engine:before-update  - 每帧更新前
  engine:after-update   - 每帧更新后
  engine:quit           - 游戏退出

场景事件:
  scene:loading         - 场景开始加载
  scene:activated       - 场景激活
  scene:paused          - 场景暂停
  scene:resumed         - 场景恢复
  scene:destroyed       - 场景销毁

输入事件:
  input:key-down        - 按键按下
  input:key-up          - 按键释放
  input:mouse-move      - 鼠标移动
  input:mouse-click     - 鼠标点击
  input:touch-start     - 触摸开始
  input:touch-end       - 触摸结束
  input:action          - InputMap 动作触发

渲染事件:
  render:layer-changed  - 图层变更
  render:camera-moved   - 相机移动
  render:dirty-rect     - 标记髒区域

物理事件:
  physics:collision-start - 碰撞开始
  physics:collision-end   - 碰撞结束
  physics:trigger-enter   - 触发器进入
  physics:trigger-exit    - 触发器退出

资源事件:
  resource:loading      - 资源开始加载
  resource:loaded       - 资源加载完成
  resource:error        - 资源加载失败
  resource:unloaded     - 资源释放

游戏逻辑事件:
  player:moved          - 玩家移动
  player:damaged        - 玩家受伤
  player:died           - 玩家死亡
  block:placed          - 方块放置
  block:removed         - 方块移除
  block:interacted      - 方块交互
  combat:damage-dealt   - 造成伤害
  combat:enemy-killed   - 击杀敌人
  item:used             - 使用物品
  item:collected        - 拾取物品
```

---

### 2.5 输入系统

#### 2.5.1 架构设计

输入系统采用 **三层架构**：

```
┌──────────────────────────────────────────┐
│       Layer 3: InputMap (动作层)          │
│   "jump", "attack", "move_left"          │
│   将物理输入映射为语义化游戏动作           │
├──────────────────────────────────────────┤
│       Layer 2: InputManager (管理层)      │
│   统一键盘/鼠标/触摸 API                 │
│   按键状态管理、输入设备检测              │
├──────────────────────────────────────────┤
│       Layer 1: Raw Input (原始输入层)     │
│   KeyboardEvent / MouseEvent / TouchEvent │
│   Gamepad API                            │
└──────────────────────────────────────────┘
```

#### 2.5.2 InputMap 管理器

```javascript
// src/engine/input/InputMap.js

/**
 * 输入动作映射表
 *
 * 将物理按键映射为语义化游戏动作。
 * 所有游戏代码只引用动作名，不直接引用键位。
 */
export class InputMap {
    constructor() {
        /** @private Map<string, InputBinding[]> */
        this._bindings = new Map();
    }

    /**
     * 绑定按键到动作
     * @param {string} action - 动作名
     * @param {InputBinding} binding
     */
    bind(action, binding) {
        if (!this._bindings.has(action)) {
            this._bindings.set(action, []);
        }
        this._bindings.get(action).push(binding);
    }

    /**
     * 批量绑定（从配置文件加载）
     * @param {Object} config - { action: { keys: [...], mouse: ..., gamepad: ... } }
     */
    loadConfig(config) {
        for (const [action, cfg] of Object.entries(config)) {
            for (const key of (cfg.keys || [])) {
                this.bind(action, { type: 'key', code: key });
            }
            if (cfg.mouse) {
                this.bind(action, { type: 'mouse', button: cfg.mouse });
            }
            if (cfg.gamepad) {
                this.bind(action, { type: 'gamepad', button: cfg.gamepad });
            }
        }
    }

    /**
     * 获取动作的所有绑定
     * @param {string} action
     * @returns {InputBinding[]}
     */
    getBindings(action) {
        return this._bindings.get(action) || [];
    }

    /**
     * 修改绑定（由设置界面调用）
     * @param {string} action
     * @param {InputBinding} oldBinding
     * @param {InputBinding} newBinding
     */
    rebind(action, oldBinding, newBinding) {
        const bindings = this._bindings.get(action);
        if (!bindings) return;
        const idx = bindings.findIndex(b =>
            b.type === oldBinding.type && b.code === oldBinding.code
        );
        if (idx !== -1) bindings[idx] = newBinding;
    }
}

/**
 * @typedef {Object} InputBinding
 * @property {'key'|'mouse'|'gamepad'} type
 * @property {string} [code] - KeyboardEvent.code (e.g. 'KeyW', 'Space')
 * @property {number} [button] - 鼠标/手柄按钮索引
 * @property {number} [axis] - 手柄轴索引
 * @property {number} [axisThreshold=0.5] - 轴阈值
 */
```

#### 2.5.3 输入管理器

```javascript
// src/engine/input/InputManager.js

export class InputManager {
    /**
     * @param {InputMap} inputMap
     */
    constructor(inputMap) {
        /** @private */
        this._inputMap = inputMap;

        /** @private 按键状态 */
        this._keyState = new Map();   // code -> { down, justPressed, justReleased }
        this._mouseState = {
            x: 0, y: 0,
            buttons: new Map(),       // button -> { down, justPressed, justReleased }
            wheel: 0
        };
        this._touchState = {
            touches: [],              // Touch[]
            justStarted: [],
            justEnded: []
        };
        this._gamepadState = new Map(); // index -> GamepadState

        /** @private 动作状态缓存 */
        this._actionState = new Map();   // action -> { down, justPressed, justReleased }
    }

    /**
     * 初始化 - 绑定 DOM 事件监听
     * @param {HTMLCanvasElement} canvas
     */
    init(canvas) {
        // 键盘
        window.addEventListener('keydown', (e) => this._onKeyDown(e));
        window.addEventListener('keyup', (e) => this._onKeyUp(e));

        // 鼠标
        canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
        canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        canvas.addEventListener('wheel', (e) => this._onWheel(e));

        // 触摸
        canvas.addEventListener('touchstart', (e) => this._onTouchStart(e));
        canvas.addEventListener('touchend', (e) => this._onTouchEnd(e));
        canvas.addEventListener('touchmove', (e) => this._onTouchMove(e));

        // 阻止上下文菜单
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // ==================== 每帧更新 ====================

    /**
     * 每帧开始时调用 - 重置 justPressed/justReleased 状态
     */
    beginFrame() {
        // 重置瞬态状态
        for (const state of this._keyState.values()) {
            state.justPressed = false;
            state.justReleased = false;
        }
        for (const state of this._mouseState.buttons.values()) {
            state.justPressed = false;
            state.justReleased = false;
        }
        this._touchState.justStarted = [];
        this._touchState.justEnded = [];
        this._mouseState.wheel = 0;

        // 更新动作状态
        this._updateActionStates();

        // 轮询手柄
        this._pollGamepads();
    }

    /** @private 更新所有动作的当前状态 */
    _updateActionStates() {
        this._actionState.clear();
        for (const [action, bindings] of this._inputMap._bindings) {
            let down = false;
            let justPressed = false;
            let justReleased = false;

            for (const binding of bindings) {
                if (binding.type === 'key') {
                    const state = this._keyState.get(binding.code);
                    if (state) {
                        down = down || state.down;
                        justPressed = justPressed || state.justPressed;
                        justReleased = justReleased || state.justReleased;
                    }
                } else if (binding.type === 'mouse') {
                    const state = this._mouseState.buttons.get(binding.button);
                    if (state) {
                        down = down || state.down;
                        justPressed = justPressed || state.justPressed;
                        justReleased = justReleased || state.justReleased;
                    }
                }
                // 手柄类似...
            }

            this._actionState.set(action, { down, justPressed, justReleased });
        }
    }

    // ==================== 查询 API ====================

    /**
     * 动作是否正在按下
     * @param {string} action
     * @returns {boolean}
     */
    isDown(action) {
        return this._actionState.get(action)?.down ?? false;
    }

    /**
     * 动作是否刚按下（本帧第一次）
     * @param {string} action
     * @returns {boolean}
     */
    isJustPressed(action) {
        return this._actionState.get(action)?.justPressed ?? false;
    }

    /**
     * 动作是否刚释放
     * @param {string} action
     * @returns {boolean}
     */
    isJustReleased(action) {
        return this._actionState.get(action)?.justReleased ?? false;
    }

    /**
     * 获取鼠标位置（在 Canvas 坐标系中）
     * @returns {{ x: number, y: number }}
     */
    getMousePosition() {
        return { x: this._mouseState.x, y: this._mouseState.y };
    }

    /**
     * 获取鼠标滚轮值
     * @returns {number}
     */
    getMouseWheel() {
        return this._mouseState.wheel;
    }

    // ==================== 事件处理 ====================

    /** @private */
    _onKeyDown(e) {
        if (e.repeat) return;
        this._keyState.set(e.code, {
            down: true,
            justPressed: true,
            justReleased: false
        });
        EventBus.instance.emit('input:key-down', { code: e.code, key: e.key });
    }

    /** @private */
    _onKeyUp(e) {
        const state = this._keyState.get(e.code);
        if (state) {
            state.down = false;
            state.justReleased = true;
        }
        EventBus.instance.emit('input:key-up', { code: e.code, key: e.key });
    }

    /** @private */
    _onMouseDown(e) {
        this._mouseState.buttons.set(e.button, {
            down: true,
            justPressed: true,
            justReleased: false
        });
        EventBus.instance.emit('input:mouse-click', {
            button: e.button,
            x: e.offsetX, y: e.offsetY
        });
    }

    /** @private */
    _onMouseMove(e) {
        this._mouseState.x = e.offsetX;
        this._mouseState.y = e.offsetY;
    }

    /** @private */
    _onTouchStart(e) {
        for (const touch of e.changedTouches) {
            this._touchState.justStarted.push(touch);
        }
        this._touchState.touches = [...e.touches];
    }

    /** @private */
    _onTouchEnd(e) {
        for (const touch of e.changedTouches) {
            this._touchState.justEnded.push(touch);
        }
        this._touchState.touches = [...e.touches];
    }

    /** @private */
    _pollGamepads() {
        const gamepads = navigator.getGamepads?.() || [];
        for (const gp of gamepads) {
            if (!gp) continue;
            // 更新手柄状态
            // ...
        }
    }
}
```

#### 2.5.4 默认键位配置

```javascript
// src/config/defaultKeybindings.js

/**
 * 默认键位配置 - 从配置文件加载
 * 对应 docs/04_技术设计/04_输入控制.md 中的 InputMap 设计
 */
export const DEFAULT_KEYBINDINGS = {
    // 移动
    'move_left':      { keys: ['KeyA'] },
    'move_right':     { keys: ['KeyD'] },
    'move_up':        { keys: ['KeyW'] },
    'move_down':      { keys: ['KeyS'] },
    'dodge':          { keys: ['Space'] },

    // 战斗
    'attack_melee':   { mouse: 0 }, // 左键
    'draw_talisman':  { keys: ['KeyQ'], mouse: 2 }, // Q 或右键
    'activate_seal_1':{ keys: ['Digit1'] },
    'activate_seal_2':{ keys: ['Digit2'] },
    'activate_seal_3':{ keys: ['Digit3'] },
    'use_item':       { keys: ['KeyE'] },
    'interact':       { keys: ['KeyF'] },

    // UI
    'ui_inventory':   { keys: ['KeyI'] },
    'ui_quest_log':   { keys: ['KeyJ'] },
    'ui_map':         { keys: ['KeyM'] },
    'ui_craft':       { keys: ['KeyC'] },
    'ui_talisman_book': { keys: ['KeyK'] },
    'ui_seal_script_book': { keys: ['KeyL'] },
    'ui_menu':        { keys: ['Escape'] },
    'quick_save':     { keys: ['F5'] },
    'quick_load':     { keys: ['F9'] },
    'screenshot':     { keys: ['F12'] },

    // 符箓绘制方向
    'stroke_up':      { keys: ['ArrowUp'] },
    'stroke_down':    { keys: ['ArrowDown'] },
    'stroke_left':    { keys: ['ArrowLeft'] },
    'stroke_right':   { keys: ['ArrowRight'] },
    'stroke_confirm': { keys: ['Enter'] }
};
```

---

### 2.6 音频系统

#### 2.6.1 架构设计

```javascript
// src/engine/audio/AudioManager.js

/**
 * 音频管理器 - 基于 Web Audio API
 *
 * 设计要点：
 * - 使用 AudioContext 进行音频混合
 * - 支持音效（短音频，预加载）和背景音乐（流式加载）
 * - 音量控制独立（主音量 / BGM / SFX）
 * - 自动暂停/恢复（页面可见性变化）
 * - 音频资源池复用
 */
export class AudioManager {
    constructor() {
        /** @private */
        this._context = null; // AudioContext（用户交互后创建）
        this._masterVolume = 1.0;
        this._bgmVolume = 1.0;
        this._sfxVolume = 1.0;

        /** @private Map<string, AudioBuffer> */
        this._sfxCache = new Map();

        /** @private */
        this._bgmSource = null; // 当前 BGM 播放源
        this._bgmGain = null;   // BGM 增益节点
        this._currentBGM = null;

        /** @private Array<{ source: AudioBufferSourceNode, gain: GainNode }> */
        this._activeSFX = [];

        /** @private */
        this._muted = false;
    }

    /**
     * 初始化音频上下文（需用户交互后调用）
     */
    async init() {
        if (this._context) return;
        this._context = new (window.AudioContext || window.webkitAudioContext)();

        // 主增益节点
        this._masterGain = this._context.createGain();
        this._masterGain.connect(this._context.destination);
        this._masterGain.gain.value = this._masterVolume;

        // 页面可见性变化时自动暂停/恢复
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this._context?.suspend();
            } else {
                this._context?.resume();
            }
        });
    }

    /**
     * 预加载音效
     * @param {string} name - 音效标识
     * @param {string} url - 音频文件 URL
     */
    async preloadSFX(name, url) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this._context.decodeAudioData(arrayBuffer);
        this._sfxCache.set(name, audioBuffer);
        EventBus.instance.emit('resource:loaded', { type: 'sfx', name });
    }

    /**
     * 播放音效
     * @param {string} name
     * @param {Object} [options]
     * @param {number} [options.volume=1.0]
     * @param {number} [options.pitch=1.0]
     * @param {number} [options.pan=0] - -1~1 立体声平衡
     */
    playSFX(name, { volume = 1.0, pitch = 1.0, pan = 0 } = {}) {
        if (this._muted) return;
        const buffer = this._sfxCache.get(name);
        if (!buffer) {
            console.warn(`SFX "${name}" not preloaded`);
            return;
        }

        const source = this._context.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = pitch;

        // 声像控制
        const panner = this._context.createStereoPanner();
        panner.pan.value = pan;

        // 音效增益（受主音量和 SFX 音量影响）
        const gain = this._context.createGain();
        gain.gain.value = volume * this._sfxVolume;

        source.connect(panner);
        panner.connect(gain);
        gain.connect(this._masterGain);
        source.start();

        // 自动清理
        source.onended = () => {
            const idx = this._activeSFX.findIndex(s => s.source === source);
            if (idx !== -1) this._activeSFX.splice(idx, 1);
            source.disconnect();
            gain.disconnect();
            panner.disconnect();
        };

        this._activeSFX.push({ source, gain });
    }

    /**
     * 播放背景音乐
     * @param {string} url
     * @param {Object} [options]
     * @param {number} [options.volume=1.0]
     * @param {boolean} [options.loop=true]
     * @param {number} [options.fadeIn=1.0] - 淡入时长（秒）
     */
    async playBGM(url, { volume = 1.0, loop = true, fadeIn = 1.0 } = {}) {
        // 淡出当前 BGM
        await this.fadeOutBGM(0.5);

        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this._context.decodeAudioData(arrayBuffer);

        const source = this._context.createBufferSource();
        source.buffer = audioBuffer;
        source.loop = loop;

        const gain = this._context.createGain();
        gain.gain.value = 0; // 从 0 开始淡入

        source.connect(gain);
        gain.connect(this._masterGain);
        source.start();

        this._bgmSource = source;
        this._bgmGain = gain;
        this._currentBGM = url;

        // 淡入
        await this._fadeGain(gain, 0, volume * this._bgmVolume, fadeIn);
    }

    /**
     * 淡出 BGM
     * @param {number} duration
     * @returns {Promise<void>}
     */
    async fadeOutBGM(duration = 0.5) {
        if (!this._bgmGain) return;
        const currentVol = this._bgmGain.gain.value;
        await this._fadeGain(this._bgmGain, currentVol, 0, duration);
        this.stopBGM();
    }

    /** 停止 BGM */
    stopBGM() {
        this._bgmSource?.stop();
        this._bgmSource?.disconnect();
        this._bgmGain?.disconnect();
        this._bgmSource = null;
        this._bgmGain = null;
        this._currentBGM = null;
    }

    // ==================== 音量控制 ====================

    /** @param {number} v - 0.0 ~ 1.0 */
    setMasterVolume(v) {
        this._masterVolume = v;
        if (this._masterGain) this._masterGain.gain.value = v;
    }

    /** @param {number} v */
    setBGMVolume(v) {
        this._bgmVolume = v;
        if (this._bgmGain) this._bgmGain.gain.value = v * this._bgmVolume;
    }

    /** @param {number} v */
    setSFXVolume(v) { this._sfxVolume = v; }

    /** 静音切换 */
    toggleMute() {
        this._muted = !this._muted;
        if (this._muted) {
            this._context?.suspend();
        } else {
            this._context?.resume();
        }
    }

    // ==================== 内部工具 ====================

    /**
     * @private 渐变增益
     * @param {GainNode} gainNode
     * @param {number} from
     * @param {number} to
     * @param {number} duration
     * @returns {Promise<void>}
     */
    _fadeGain(gainNode, from, to, duration) {
        const now = this._context.currentTime;
        gainNode.gain.setValueAtTime(from, now);
        gainNode.gain.linearRampToValueAtTime(to, now + duration);
        return new Promise((resolve) => setTimeout(resolve, duration * 1000));
    }

    /** 释放所有音频资源 */
    dispose() {
        this.stopBGM();
        for (const { source, gain } of this._activeSFX) {
            source.stop();
            source.disconnect();
            gain.disconnect();
        }
        this._sfxCache.clear();
        this._context?.close();
        this._context = null;
    }
}
```

#### 2.6.2 音频资源管理

```
音频文件存放路径:
  res://assets/audio/
    ├── bgm/                 # 背景音乐（流式加载，Ogg/MP3）
    │   ├── title_theme.ogg
    │   ├── valley_day.ogg
    │   ├── valley_night.ogg
    │   ├── combat_01.ogg
    │   └── ...
    └── sfx/                 # 音效（预加载，WAV 或 Ogg）
        ├── player/
        │   ├── sword_swing.wav
        │   ├── footstep_grass.wav
        │   ├── footstep_stone.wav
        │   └── ...
        ├── ui/
        │   ├── button_click.wav
        │   ├── menu_open.wav
        │   ├── menu_close.wav
        │   └── ...
        ├── combat/
        │   ├── hit_light.wav
        │   ├── hit_heavy.wav
        │   ├── talisman_cast.wav
        │   └── ...
        ├── environment/
        │   ├── rain_light.wav
        │   ├── thunder.wav
        │   ├── stream.wav
        │   └── ...
        └── field/
            ├── plant.wav
            ├── harvest.wav
            ├── water.wav
            └── ...
```

---

### 2.7 物理引擎

#### 2.7.1 技术选型

| 组件 | 方案 | 说明 |
|------|------|------|
| 物理引擎核心 | **Matter.js** | 2D 物理引擎，MIT 许可，17k+ Stars |
| 碰撞检测 | Matter.js 内置 + 自研 AABB 空间分桶 | 2.5D 方块碰撞检测需自研 |
| 刚体 | Matter.js `Bodies` | 矩形/圆形/多边形 |
| 触发器 | Matter.js `isSensor` | 用于区域检测 |
| 碰撞过滤 | Matter.js `collisionFilter` | 分类碰撞：玩家/敌人/方块/触发器 |

#### 2.7.2 物理世界管理器

```javascript
// src/engine/physics/PhysicsWorld.js

import Matter from 'matter-js';

/**
 * 物理世界管理器
 *
 * 职责：
 * 1. 管理 Matter.js Engine 实例
 * 2. 物理体与游戏对象之间的映射
 * 3. 碰撞事件的转发（通过 EventBus）
 * 4. 物理-渲染坐标同步
 */
export class PhysicsWorld {
    constructor() {
        /** @private Matter.Engine */
        this._engine = Matter.Engine.create({
            gravity: { x: 0, y: 0 } // 2.5D 游戏中重力方向可能需要自定义
        });

        /** @private Map<number, Object> bodyId -> gameObject */
        this._bodyMap = new Map();

        /** @private */
        this._pixelScale = 1; // 物理单位 ↔ 像素单位的换算

        // 碰撞分类
        this._categories = {
            DEFAULT: 0x0001,
            PLAYER:  0x0002,
            ENEMY:   0x0004,
            BLOCK:   0x0008,
            SENSOR:  0x0010,
            PROJECTILE: 0x0020,
        };

        // 监听碰撞事件
        Matter.Events.on(this._engine, 'collisionStart', (event) => {
            for (const pair of event.pairs) {
                const bodyA = pair.bodyA;
                const bodyB = pair.bodyB;
                const goA = this._bodyMap.get(bodyA.id);
                const goB = this._bodyMap.get(bodyB.id);

                EventBus.instance.emit('physics:collision-start', {
                    bodyA, bodyB, gameObjectA: goA, gameObjectB: goB,
                    contact: pair.contact
                });
            }
        });

        Matter.Events.on(this._engine, 'collisionEnd', (event) => {
            for (const pair of event.pairs) {
                EventBus.instance.emit('physics:collision-end', {
                    bodyA: pair.bodyA, bodyB: pair.bodyB
                });
            }
        });
    }

    /**
     * 固定步长更新物理世界
     * @param {number} dt
     */
    step(dt) {
        Matter.Engine.update(this._engine, dt * 1000);
    }

    /**
     * 创建物理体并绑定到游戏对象
     * @param {Object} gameObject
     * @param {Matter.Body} body
     */
    addBody(gameObject, body) {
        Matter.Composite.add(this._engine.world, body);
        this._bodyMap.set(body.id, gameObject);
        body.gameObject = gameObject; // 反向引用
    }

    /**
     * 移除物理体
     * @param {Matter.Body} body
     */
    removeBody(body) {
        Matter.Composite.remove(this._engine.world, body);
        this._bodyMap.delete(body.id);
        delete body.gameObject;
    }

    /**
     * 创建玩家刚体
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @returns {Matter.Body}
     */
    createPlayerBody(x, y, width, height) {
        return Matter.Bodies.rectangle(x, y, width, height, {
            label: 'player',
            collisionFilter: {
                category: this._categories.PLAYER,
                mask: this._categories.BLOCK | this._categories.ENEMY
                         | this._categories.SENSOR
            },
            friction: 0,
            frictionAir: 0.1,
            restitution: 0
        });
    }

    /**
     * 创建方块碰撞体
     * @param {number} gx - 网格 X
     * @param {number} gy - 网格 Y
     * @param {number} gz - 网格 Z
     * @param {number} height - 方块高度
     * @returns {Matter.Body}
     */
    createBlockBody(gx, gy, gz, height) {
        const pos = this._gridToPhysics(gx, gy, gz, height);
        return Matter.Bodies.rectangle(
            pos.x, pos.y,
            32, 8 + height * 16, // 宽 × 高
            {
                label: 'block',
                isStatic: true,
                collisionFilter: {
                    category: this._categories.BLOCK,
                    mask: this._categories.PLAYER | this._categories.ENEMY
                             | this._categories.PROJECTILE
                }
            }
        );
    }

    /**
     * 网格坐标 → 物理坐标
     * @private
     */
    _gridToPhysics(gx, gy, gz, height) {
        const TILE_HALF_W = 16;
        const TILE_HALF_H = 8;
        return {
            x: (gx - gy) * TILE_HALF_W,
            y: (gx + gy) * TILE_HALF_H - gz * (TILE_HALF_H * 2) + height * 8
        };
    }

    /**
     * 射线检测
     * @param {{ x: number, y: number }} start
     * @param {{ x: number, y: number }} end
     * @returns {Array<{ body: Matter.Body, point: {x:number, y:number} }>}
     */
    raycast(start, end) {
        return Matter.Query.ray(this._engine.world, start, end);
    }

    /**
     * 区域查询
     * @param {{ x: number, y: number, width: number, height: number }} rect
     * @returns {Matter.Body[]}
     */
    queryRect(rect) {
        return Matter.Query.region(
            this._engine.world.bodies,
            rect
        );
    }

    /** 设置自定义重力 */
    setGravity(x, y) {
        this._engine.gravity.x = x;
        this._engine.gravity.y = y;
    }

    /** @returns {Matter.Engine} */
    getEngine() { return this._engine; }

    /** @returns {Object} */
    getCategories() { return this._categories; }
}
```

#### 2.7.3 2.5D 方块碰撞检测

对于 2.5D 方块场景，除了 Matter.js 的物理碰撞，还需要一套独立的 **网格碰撞查询系统**：

```javascript
// src/engine/physics/GridCollision.js

/**
 * 网格碰撞检测 - 用于 2.5D 方块场景的通行判定和交互检测
 *
 * 与 Matter.js 的关系：
 * - Matter.js 负责：玩家/敌人/投射物之间的物理碰撞
 * - GridCollision 负责：方块通行判定、鼠标拾取方块检测
 */
export class GridCollision {
    constructor() {
        /** @private Map<string, BlockCollisionData> */
        this._collisionGrid = new Map();
    }

    /**
     * 设置方块碰撞数据
     * @param {number} gx
     * @param {number} gy
     * @param {number} gz
     * @param {BlockCollisionData} data
     */
    setBlock(gx, gy, gz, data) {
        this._collisionGrid.set(`${gx},${gy},${gz}`, data);
    }

    /**
     * 移除方块碰撞
     * @param {number} gx
     * @param {number} gy
     * @param {number} gz
     */
    removeBlock(gx, gy, gz) {
        this._collisionGrid.delete(`${gx},${gy},${gz}`);
    }

    /**
     * 检查网格坐标是否可通行
     * @param {number} gx
     * @param {number} gy
     * @param {number} gz
     * @returns {boolean}
     */
    isPassable(gx, gy, gz) {
        const block = this._collisionGrid.get(`${gx},${gy},${gz}`);
        if (!block) return true; // 空 = 可通行
        return PASSABLE_TYPES.includes(block.blockType);
    }

    /**
     * 获取方块屏幕碰撞矩形
     * @param {number} gx
     * @param {number} gy
     * @param {number} gz
     * @param {number} height
     * @returns {ScreenRect}
     */
    getScreenRect(gx, gy, gz, height) {
        const TILE_HALF_W = 16;
        const TILE_HALF_H = 8;
        const sx = (gx - gy) * TILE_HALF_W;
        const sy = (gx + gy) * TILE_HALF_H - gz * (TILE_HALF_H * 2);
        return {
            x: sx - TILE_HALF_W,
            y: sy - TILE_HALF_H,
            width: TILE_HALF_W * 2,
            height: TILE_HALF_H + height * 16
        };
    }

    /**
     * 屏幕坐标 → 网格坐标拾取检测
     * @param {number} screenX
     * @param {number} screenY
     * @param {number} [gz=0] - 只检测该高度层
     * @returns {{ gx: number, gy: number } | null}
     */
    pickBlock(screenX, screenY, gz = 0) {
        const TILE_HALF_W = 16;
        const TILE_HALF_H = 8;
        const gxFloat = (
            screenX / TILE_HALF_W + (screenY + gz * 16) / TILE_HALF_H
        ) / 2;
        const gyFloat = (
            (screenY + gz * 16) / TILE_HALF_H - screenX / TILE_HALF_W
        ) / 2;
        const gx = Math.round(gxFloat);
        const gy = Math.round(gyFloat);

        // 验证点击是否在方块范围内
        const rect = this.getScreenRect(gx, gy, gz, 1);
        if (
            screenX >= rect.x && screenX <= rect.x + rect.width &&
            screenY >= rect.y && screenY <= rect.y + rect.height
        ) {
            return { gx, gy };
        }
        return null;
    }

    /** 清空 */
    clear() { this._collisionGrid.clear(); }
}

const PASSABLE_TYPES = ['grass', 'dirt', 'sand', 'farm', 'plank', 'water'];
```

---

### 2.8 资源管理

#### 2.8.1 架构设计

```
┌──────────────────────────────────────────────────────┐
│                  ResourceManager                      │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────────────┐  ┌──────────────────────────┐   │
│  │   ResourceCache  │  │    LoadingQueue           │   │
│  │  (LRU Cache)     │  │  (优先级队列 + 并发控制)   │   │
│  │  - key: URL      │  │  - preload queue         │   │
│  │  - value: Resource│  │  - runtime queue         │   │
│  │  - maxSize: 256MB │  │  - onProgress callback   │   │
│  └─────────────────┘  └──────────────────────────┘   │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │          Resource Loaders                      │    │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐         │    │
│  │  │Texture│ │Audio │ │JSON  │ │Font  │ ...     │    │
│  │  │Loader │ │Loader│ │Loader│ │Loader│         │    │
│  │  └──────┘ └──────┘ └──────┘ └──────┘         │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │          Reference Counting                    │    │
│  │  - acquire(resource) -> refCount++            │    │
│  │  - release(resource) -> refCount--            │    │
│  │  - refCount === 0 -> dispose from cache       │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
└──────────────────────────────────────────────────────┘
```

#### 2.8.2 资源管理器实现

```javascript
// src/engine/resource/ResourceManager.js

/**
 * 资源管理器
 *
 * 职责：
 * 1. 资源加载（支持同步 preload 和异步 load）
 * 2. LRU 缓存管理
 * 3. 引用计数 - 自动释放未使用的资源
 * 4. 加载进度追踪
 * 5. 错误处理与重试
 */
export class ResourceManager {
    /** @type {ResourceManager} */
    static instance = null;

    static getInstance() {
        if (!ResourceManager.instance) {
            ResourceManager.instance = new ResourceManager();
        }
        return ResourceManager.instance;
    }

    constructor() {
        /** @private Map<string, ResourceEntry> */
        this._cache = new Map();

        /** @private Map<string, ResourceLoader> */
        this._loaders = new Map();

        /** @private */
        this._maxCacheSize = 256 * 1024 * 1024; // 256MB
        this._currentCacheSize = 0;

        /** @private 加载队列 */
        this._loadingQueue = [];
        this._isLoading = false;
        this._maxConcurrent = 4;

        // 注册内置加载器
        this._registerDefaultLoaders();
    }

    /** @private */
    _registerDefaultLoaders() {
        this.registerLoader('png', new TextureLoader());
        this.registerLoader('jpg', new TextureLoader());
        this.registerLoader('jpeg', new TextureLoader());
        this.registerLoader('webp', new TextureLoader());
        this.registerLoader('wav', new AudioLoader());
        this.registerLoader('ogg', new AudioLoader());
        this.registerLoader('mp3', new AudioLoader());
        this.registerLoader('json', new JSONLoader());
        this.registerLoader('ttf', new FontLoader());
        this.registerLoader('otf', new FontLoader());
    }

    /**
     * 注册自定义资源加载器
     * @param {string} extension - 文件扩展名
     * @param {ResourceLoader} loader
     */
    registerLoader(extension, loader) {
        this._loaders.set(extension.toLowerCase(), loader);
    }

    /**
     * 获取加载器
     * @param {string} url
     * @returns {ResourceLoader}
     */
    _getLoader(url) {
        const ext = url.split('.').pop().toLowerCase();
        const loader = this._loaders.get(ext);
        if (!loader) throw new Error(`No loader registered for .${ext}`);
        return loader;
    }

    /**
     * 预加载资源（同步方式，用于启动时批量加载）
     * @param {string[]} urls
     * @param {Object} [options]
     * @param {(progress: number) => void} [options.onProgress]
     * @returns {Promise<void>}
     */
    async preload(urls, { onProgress } = {}) {
        const total = urls.length;
        let loaded = 0;

        // 分批加载，控制并发数
        const batches = [];
        for (let i = 0; i < urls.length; i += this._maxConcurrent) {
            batches.push(urls.slice(i, i + this._maxConcurrent));
        }

        for (const batch of batches) {
            await Promise.all(batch.map(async (url) => {
                try {
                    await this.load(url);
                } catch (err) {
                    console.error(`Failed to preload ${url}:`, err);
                }
                loaded++;
                onProgress?.(loaded / total);
                EventBus.instance.emit('resource:loading', {
                    url, progress: loaded / total
                });
            }));
        }

        EventBus.instance.emit('resource:loaded', { type: 'batch', count: total });
    }

    /**
     * 异步加载单个资源
     * @param {string} url
     * @param {Object} [options]
     * @param {boolean} [options.cache=true]
     * @returns {Promise<*>}
     */
    async load(url, { cache = true } = {}) {
        // 缓存命中
        if (this._cache.has(url)) {
            const entry = this._cache.get(url);
            entry.refCount++;
            entry.lastAccess = Date.now();
            return entry.resource;
        }

        // 防止重复加载
        if (this._loadingQueue.includes(url)) {
            // 等待加载完成
            return new Promise((resolve) => {
                const check = () => {
                    if (this._cache.has(url)) {
                        resolve(this._cache.get(url).resource);
                    } else {
                        setTimeout(check, 16);
                    }
                };
                check();
            });
        }

        // 加载
        this._loadingQueue.push(url);
        EventBus.instance.emit('resource:loading', { url, progress: 0 });

        try {
            const loader = this._getLoader(url);
            const resource = await loader.load(url);

            // 估算资源大小（从 loader 获取）
            const size = loader.estimateSize?.(resource) || 1024 * 1024;

            if (cache) {
                // 缓存淘汰
                while (this._currentCacheSize + size > this._maxCacheSize) {
                    this._evictOldest();
                }

                this._cache.set(url, {
                    resource,
                    refCount: 1,
                    size,
                    lastAccess: Date.now(),
                    loader
                });
                this._currentCacheSize += size;
            }

            this._loadingQueue = this._loadingQueue.filter(u => u !== url);
            EventBus.instance.emit('resource:loaded', { url, type: 'single' });
            return resource;

        } catch (error) {
            this._loadingQueue = this._loadingQueue.filter(u => u !== url);
            EventBus.instance.emit('resource:error', { url, error });
            throw error;
        }
    }

    /**
     * 释放资源（引用计数减一）
     * @param {string} url
     */
    release(url) {
        const entry = this._cache.get(url);
        if (!entry) return;

        entry.refCount--;
        entry.lastAccess = Date.now();

        if (entry.refCount <= 0) {
            // 标记为可释放，但不立即释放
            // 在缓存压力大时被淘汰
            entry.refCount = 0;
        }
    }

    /**
     * 强制释放资源
     * @param {string} url
     */
    forceRelease(url) {
        const entry = this._cache.get(url);
        if (!entry) return;

        entry.loader.dispose?.(entry.resource);
        this._currentCacheSize -= entry.size;
        this._cache.delete(url);
        EventBus.instance.emit('resource:unloaded', { url });
    }

    /** @private 淘汰最久未使用的缓存项 */
    _evictOldest() {
        let oldest = null;
        let oldestKey = null;

        for (const [key, entry] of this._cache) {
            if (entry.refCount > 0) continue; // 正在使用的不能淘汰
            if (!oldest || entry.lastAccess < oldest.lastAccess) {
                oldest = entry;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.forceRelease(oldestKey);
        }
    }

    /**
     * 清空所有缓存（场景切换时调用）
     * @param {boolean} [force=false] - 是否强制清理使用中的资源
     */
    clearCache(force = false) {
        for (const [key, entry] of this._cache) {
            if (force || entry.refCount === 0) {
                entry.loader.dispose?.(entry.resource);
                this._currentCacheSize -= entry.size;
                this._cache.delete(key);
            }
        }
    }

    /** @returns {number} 当前缓存使用量（MB） */
    getCacheUsageMB() {
        return this._currentCacheSize / (1024 * 1024);
    }

    /** @returns {number} 缓存项数量 */
    getCacheCount() { return this._cache.size; }
}

// ==================== 资源加载器示例 ====================

/**
 * @interface ResourceLoader
 * @method load(url: string): Promise<*>
 * @method estimateSize?(resource: *): number
 * @method dispose?(resource: *): void
 */

class TextureLoader {
    async load(url) {
        const texture = await PIXI.Assets.load(url);
        return texture;
    }

    estimateSize(texture) {
        // 根据纹理尺寸估算内存占用
        const base = texture.baseTexture;
        return base.width * base.height * 4; // RGBA
    }

    dispose(texture) {
        texture.destroy(true);
    }
}

class AudioLoader {
    async load(url) {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        return buffer;
    }

    estimateSize(buffer) {
        return buffer.byteLength;
    }
}

class JSONLoader {
    async load(url) {
        const response = await fetch(url);
        return response.json();
    }

    estimateSize(data) {
        return new Blob([JSON.stringify(data)]).size;
    }
}
```

#### 2.8.3 资源清单定义

```javascript
// src/config/assetManifest.js

/**
 * 资源清单 - 定义所有需要加载的资源
 * 用于启动时的批量预加载
 *
 * 资源路径规范：
 *   res://assets/{type}/{purpose}_{id}.{format}
 *   例如: res://assets/sprites/player_idle_01.png
 */
export const ASSET_MANIFEST = {
    // 启动时必加载（Loading 界面用）
    critical: [
        'res://assets/sprites/loading_bg.png',
        'res://assets/sprites/loading_bar.png',
        'res://assets/fonts/main_font.fnt'
    ],

    // 预加载（启动后后台加载）
    preload: {
        sprites: [
            'res://assets/sprites/player_idle_01.png',
            'res://assets/sprites/player_idle_02.png',
            'res://assets/sprites/player_run_01.png',
            'res://assets/sprites/player_run_02.png',
            'res://assets/placeholder/placeholder_block_grass_top.png',
            'res://assets/placeholder/placeholder_block_dirt_top.png',
            'res://assets/placeholder/placeholder_block_stone_top.png',
            // ...
        ],
        audio: {
            bgm: [
                'res://assets/audio/bgm/title_theme.ogg'
            ],
            sfx: [
                'res://assets/audio/sfx/ui/button_click.wav',
                'res://assets/audio/sfx/player/footstep_grass.wav'
            ]
        },
        data: [
            'res://data/items.json',
            'res://data/talismans.json',
            'res://data/recipes.json'
        ]
    },

    // 场景资源映射（按需加载）
    scenes: {
        'title': {
            sprites: ['res://assets/sprites/title_bg.png'],
            audio: ['res://assets/audio/bgm/title_theme.ogg']
        },
        'valley': {
            sprites: [
                'res://assets/blocks/valley/valley_grass_01.png',
                'res://assets/blocks/valley/valley_grass_02.png',
                'res://assets/blocks/valley/valley_dirt_01.png',
                // ...
            ],
            audio: [
                'res://assets/audio/bgm/valley_day.ogg',
                'res://assets/audio/sfx/environment/stream.wav'
            ]
        }
    }
};
```

---

## 3. 性能优化策略

### 3.1 对象池 (Object Pool)

```javascript
// src/engine/utils/ObjectPool.js

/**
 * 通用对象池 - 减少 GC 压力
 *
 * 适用于频繁创建/销毁的对象：
 * - 粒子特效
 * - 投射物（子弹/飞剑）
 * - 伤害数字
 * - 临时 UI 元素
 */
export class ObjectPool {
    /**
     * @param {() => *} factory - 对象工厂函数
     * @param {(obj: *) => void} reset - 重置函数（归还时调用）
     * @param {number} [initialSize=10] - 初始池大小
     */
    constructor(factory, reset, initialSize = 10) {
        this._factory = factory;
        this._reset = reset;
        this._pool = [];

        // 预创建对象
        for (let i = 0; i < initialSize; i++) {
            this._pool.push(factory());
        }
    }

    /**
     * 从池中获取对象
     * @returns {*}
     */
    acquire() {
        if (this._pool.length > 0) {
            return this._pool.pop();
        }
        // 池空时创建新对象
        return this._factory();
    }

    /**
     * 归还对象到池中
     * @param {*} obj
     */
    release(obj) {
        this._reset(obj);
        this._pool.push(obj);
    }

    /**
     * 预扩展池大小
     * @param {number} size
     */
    expand(size) {
        while (this._pool.length < size) {
            this._pool.push(this._factory());
        }
    }

    /** @returns {number} 当前池大小 */
    get size() { return this._pool.length; }

    /** 清空池 */
    clear() {
        for (const obj of this._pool) {
            if (obj.destroy) obj.destroy();
        }
        this._pool.length = 0;
    }
}
```

### 3.2 脏矩形 (Dirty Rect) 优化

```javascript
// src/engine/render/DirtyRectManager.js

/**
 * 脏矩形管理器 - 仅重绘发生变化的区域
 *
 * 原理：
 * - 记录每帧发生变化的矩形区域
 * - 合并相邻/重叠的矩形
 * - 仅对脏区域内的 Sprite 执行重绘
 * - 大幅减少每帧的绘制调用次数
 */
export class DirtyRectManager {
    constructor() {
        /** @private Array<{ x: number, y: number, w: number, h: number }> */
        this._dirtyRects = [];

        /** @private 脏矩形数量上限 */
        this._maxRects = 32;

        /** @private 脏区域合并阈值 */
        this._mergeThreshold = 16; // 像素
    }

    /**
     * 标记区域为脏
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     */
    markDirty(x, y, width, height) {
        // 边界膨胀（避免边缘像素问题）
        const rect = {
            x: x - 2,
            y: y - 2,
            w: width + 4,
            h: height + 4
        };

        // 尝试合并到现有脏矩形
        for (const existing of this._dirtyRects) {
            if (this._canMerge(existing, rect)) {
                this._merge(existing, rect);
                return;
            }
        }

        // 添加新脏矩形
        this._dirtyRects.push(rect);

        // 如果脏矩形过多，合并所有
        if (this._dirtyRects.length > this._maxRects) {
            this._mergeAll();
        }
    }

    /**
     * 标记精灵为脏
     * @param {PIXI.Sprite} sprite
     */
    markSpriteDirty(sprite) {
        const bounds = sprite.getBounds();
        this.markDirty(bounds.x, bounds.y, bounds.width, bounds.height);
    }

    /**
     * 执行渲染前调用 - 将脏区域信息传递给渲染器
     * @param {PIXI.Renderer} renderer
     */
    flush(renderer) {
        if (this._dirtyRects.length === 0) return;

        // 设置渲染器的裁剪区域
        for (const rect of this._dirtyRects) {
            renderer.scissor?.(
                Math.floor(rect.x),
                Math.floor(rect.y),
                Math.ceil(rect.w),
                Math.ceil(rect.h)
            );
        }

        this._dirtyRects.length = 0;
    }

    /**
     * 判断两个矩形是否可以合并
     * @private
     */
    _canMerge(a, b) {
        const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
        const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
        if (overlapX && overlapY) return true;

        // 距离很近也可合并
        const distX = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
        const distY = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2));
        return distX < this._mergeThreshold && distY < this._mergeThreshold;
    }

    /**
     * 合并两个矩形
     * @private
     */
    _merge(target, source) {
        const x1 = Math.min(target.x, source.x);
        const y1 = Math.min(target.y, source.y);
        const x2 = Math.max(target.x + target.w, source.x + source.w);
        const y2 = Math.max(target.y + target.h, source.y + source.h);
        target.x = x1;
        target.y = y1;
        target.w = x2 - x1;
        target.h = y2 - y1;
    }

    /** @private 合并所有脏矩形为一个大矩形 */
    _mergeAll() {
        if (this._dirtyRects.length === 0) return;
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const rect of this._dirtyRects) {
            minX = Math.min(minX, rect.x);
            minY = Math.min(minY, rect.y);
            maxX = Math.max(maxX, rect.x + rect.w);
            maxY = Math.max(maxY, rect.y + rect.h);
        }

        this._dirtyRects.length = 0;
        this._dirtyRects.push({
            x: minX, y: minY,
            w: maxX - minX, h: maxY - minY
        });
    }

    /** 标记全屏为脏 */
    markFullScreenDirty() {
        this._dirtyRects.length = 0;
        this._dirtyRects.push({
            x: 0, y: 0,
            w: 99999, h: 99999
        });
    }

    /** 清空 */
    clear() { this._dirtyRects.length = 0; }
}
```

### 3.3 批处理渲染 (Batch Rendering)

```javascript
// src/engine/render/BatchRenderer.js

/**
 * 批量渲染管理器
 *
 * 策略：
 * 1. 相邻同纹理的精灵自动合并为一个绘制调用
 * 2. 方块场景中的大量同类型 Sprite 使用 ParticleContainer
 * 3. 静态场景（地面方块）预烘焙为一张大纹理
 * 4. 纹理图集 (Texture Atlas) 管理
 */
export class BatchRenderer {
    /**
     * @param {PIXI.Application} app
     * @param {LayerStack} layerStack
     */
    constructor(app, layerStack) {
        this._app = app;
        this._layers = layerStack;
    }

    /**
     * 对静态层（地面/结构）执行纹理烘焙
     * 将多个方块合并为一张大纹理，减少绘制调用
     *
     * @param {number} layerIndex
     * @param {PIXI.Container} container
     * @returns {PIXI.Sprite} 烘焙后的静态纹理
     */
    bakeStaticLayer(layerIndex, container) {
        // 1. 获取容器的边界
        const bounds = container.getLocalBounds();

        // 2. 创建离屏渲染纹理
        const renderTexture = PIXI.RenderTexture.create({
            width: bounds.width + bounds.x,
            height: bounds.height + bounds.y
        });

        // 3. 将容器渲染到纹理
        this._app.renderer.render(container, { renderTexture });

        // 4. 用单个 Sprite 替代所有子对象
        const sprite = new PIXI.Sprite(renderTexture);
        sprite.x = bounds.x;
        sprite.y = bounds.y;

        // 5. 替换容器
        this._layers.removeFromLayer(layerIndex, container);
        this._layers.addToLayer(layerIndex, sprite);

        // 6. 清理原容器
        container.destroy({ children: true });

        console.log(
            `[BatchRenderer] Baked layer ${layerIndex}: ` +
            `reduced to 1 draw call`
        );

        return sprite;
    }

    /**
     * 使用 ParticleContainer 管理大量相同纹理的 Sprite
     * 适用于：同类型方块、粒子、草丛等
     *
     * @param {number} layerIndex
     * @param {PIXI.Texture} texture
     * @param {number} count - 预估数量
     * @returns {PIXI.ParticleContainer}
     */
    createParticleLayer(layerIndex, texture, count) {
        const container = new PIXI.ParticleContainer(count, {
            scale: true,
            position: true,
            rotation: false,
            uvs: false,
            alpha: true
        });

        this._layers.addToLayer(layerIndex, container);
        return container;
    }

    /**
     * 根据视图区域裁剪不可见对象
     * @param {Camera2D} camera
     * @param {PIXI.Container} layer
     */
    frustumCull(camera, layer) {
        const viewBounds = {
            x: camera._x - camera._viewWidth / 2 / camera._zoom,
            y: camera._y - camera._viewHeight / 2 / camera._zoom,
            w: camera._viewWidth / camera._zoom,
            h: camera._viewHeight / camera._zoom
        };

        for (const child of layer.children) {
            if (child.getBounds) {
                const bounds = child.getBounds();
                const visible = (
                    bounds.x < viewBounds.x + viewBounds.w &&
                    bounds.x + bounds.width > viewBounds.x &&
                    bounds.y < viewBounds.y + viewBounds.h &&
                    bounds.y + bounds.height > viewBounds.y
                );
                child.visible = visible;
            }
        }
    }
}
```

### 3.4 性能优化总览

| 策略 | 适用范围 | 预期效果 | 实现成本 |
|------|---------|---------|---------|
| **对象池** | 粒子、投射物、伤害数字 | 减少 GC 暂停 90% | 低 |
| **脏矩形** | 静态场景 + 局部更新 | 减少绘制调用 50~80% | 中 |
| **纹理烘焙** | 地面方块、静态建筑 | 绘制调用从 N → 1 | 低 |
| **ParticleContainer** | 大量同纹理 Sprite | 绘制调用减少 90%+ | 低 |
| **视锥剔除** | 所有渲染对象 | 减少渲染对象 30~70% | 中 |
| **纹理图集 (Atlas)** | 角色动画、UI | 减少纹理切换 | 低（需工具链） |
| **LOD 系统** | 远景方块 | 减少细节对象 50% | 高 |
| **WebGL 状态排序** | 所有绘制 | 减少状态切换 | 中（PixiJS 内置） |
| **延迟加载** | 非关键资源 | 启动时间减少 60% | 低 |
| **引用计数自动释放** | 场景切换 | 内存占用稳定 | 中 |

---

## 4. Electron 主进程与渲染进程分工

### 4.1 进程架构

```
┌────────────────────────────────────────────────────────────┐
│                    Electron Main Process                    │
│                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │ WindowManager │  │   IPC Bridge  │  │  Native Modules │   │
│  │ - 创建窗口    │  │ - 进程间通信   │  │ - File I/O     │   │
│  │ - 全屏控制    │  │ - 消息路由     │  │ - Steam API    │   │
│  │ - 窗口事件    │  │ - 权限校验     │  │ - 截图保存     │   │
│  └──────────────┘  └──────────────┘  └────────────────┘   │
│                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │ AutoUpdater   │  │   Menu/Tray  │  │  Store (Config)│   │
│  │ - 自动更新    │  │ - 系统菜单   │  │ - 持久化配置   │   │
│  │ - 增量更新    │  │ - 托盘图标   │  │ - 存档管理     │   │
│  └──────────────┘  └──────────────┘  └────────────────┘   │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  IPC Channel (contextBridge)                               │
├────────────────────────────────────────────────────────────┤
│                    Electron Renderer Process                 │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │               Game Engine Instance                    │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────────┐   │  │
│  │  │PixiJS  │ │ Scene  │ │ Input  │ │ Game Logic │   │  │
│  │  │Renderer│ │Manager │ │System  │ │ Modules    │   │  │
│  │  └────────┘ └────────┘ └────────┘ └────────────┘   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           HTML/CSS Overlay (可选)                     │  │
│  │  - 复杂 UI 界面 (背包/设置/对话)                      │  │
│  │  - DevTools / 调试面板                               │  │
│  │  - Loading 界面                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 4.2 主进程核心实现

```javascript
// electron/main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

/** 主窗口引用 */
let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 960,
        height: 540,
        resizable: false,
        fullscreen: false,
        frame: true,
        title: '云汲仙田录',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,      // 安全：关闭 Node 集成
            contextIsolation: true,      // 安全：启用上下文隔离
            webgl: true,
            // 禁用 GPU 黑名单（提高部分旧显卡兼容性）
            disableGpuBlacklist: true,
        }
    });

    // 加载游戏入口
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));

    // 开发模式打开 DevTools
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    // 窗口关闭时清理
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 阻止页面导航（防止意外跳转）
    mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
}

// ==================== IPC 处理 ====================

// 文件读写（存档）
ipcMain.handle('file:save', async (event, { path: filePath, data }) => {
    const fs = require('fs');
    const fullPath = path.join(app.getPath('userData'), 'saves', filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(data));
    return true;
});

ipcMain.handle('file:load', async (event, { path: filePath }) => {
    const fs = require('fs');
    const fullPath = path.join(app.getPath('userData'), 'saves', filePath);
    if (!fs.existsSync(fullPath)) return null;
    return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
});

ipcMain.handle('file:list-saves', async () => {
    const fs = require('fs');
    const savesDir = path.join(app.getPath('userData'), 'saves');
    if (!fs.existsSync(savesDir)) return [];
    return fs.readdirSync(savesDir)
        .filter(f => f.endsWith('.save'))
        .map(f => ({
            name: f,
            time: fs.statSync(path.join(savesDir, f)).mtimeMs
        }));
});

// 截图
ipcMain.handle('screenshot:save', async (event, { dataUrl }) => {
    const fs = require('fs');
    const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

    const filename = `screenshot_${Date.now()}.png`;
    const filePath = path.join(screenshotsDir, filename);

    // 将 Base64 转换为 Buffer
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

    return filename;
});

// 系统信息
ipcMain.handle('system:info', async () => {
    const os = require('os');
    return {
        platform: process.platform,
        arch: process.arch,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        cpuCores: os.cpus().length,
        gpuInfo: await mainWindow.webContents.getGPUInfo('basic'),
    };
});

// 窗口操作
ipcMain.on('window:toggle-fullscreen', () => {
    if (mainWindow) {
        mainWindow.setFullscreen(!mainWindow.isFullScreen());
    }
});

// ==================== 应用生命周期 ====================

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});
```

### 4.3 预加载脚本 (Preload)

```javascript
// electron/preload.js

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 通过 contextBridge 安全地暴露 API 给渲染进程
 *
 * 渲染进程只能通过 window.electronAPI 访问以下方法，
 * 无法直接访问 Node.js API 或 Electron 内部。
 */
contextBridge.exposeInMainWorld('electronAPI', {
    // 文件系统（仅限 saves 目录）
    saveFile: (path, data) =>
        ipcRenderer.invoke('file:save', { path, data }),
    loadFile: (path) =>
        ipcRenderer.invoke('file:load', { path }),
    listSaves: () =>
        ipcRenderer.invoke('file:list-saves'),

    // 截图
    saveScreenshot: (dataUrl) =>
        ipcRenderer.invoke('screenshot:save', { dataUrl }),

    // 系统信息
    getSystemInfo: () =>
        ipcRenderer.invoke('system:info'),

    // 窗口控制
    toggleFullscreen: () =>
        ipcRenderer.send('window:toggle-fullscreen'),

    // 原生对话框
    showOpenDialog: (options) =>
        ipcRenderer.invoke('dialog:open', options),
    showSaveDialog: (options) =>
        ipcRenderer.invoke('dialog:save', options),

    // 游戏手柄（需要原生模块支持时用）
    getGamepads: () =>
        ipcRenderer.invoke('gamepad:list'),

    // Steam 集成
    steam: {
        isReady: () => ipcRenderer.invoke('steam:is-ready'),
        getAchievement: (name) =>
            ipcRenderer.invoke('steam:get-achievement', name),
        setAchievement: (name) =>
            ipcRenderer.invoke('steam:set-achievement', name),
        getStat: (name) =>
            ipcRenderer.invoke('steam:get-stat', name),
        setStat: (name, value) =>
            ipcRenderer.invoke('steam:set-stat', name, value),
    }
});
```

### 4.4 主进程 vs 渲染进程职责总表

| 职责 | 归属进程 | 说明 |
|------|---------|------|
| 窗口创建与管理 | 主进程 | BrowserWindow 生命周期 |
| 原生文件 I/O | 主进程 | 通过 IPC 委托，渲染进程无权限 |
| Steam API 集成 | 主进程 | steamworks.js 原生模块 |
| 自动更新 | 主进程 | electron-updater |
| 系统菜单/托盘 | 主进程 | 原生菜单 |
| GPU 信息获取 | 主进程 | 用于渲染配置 |
| **游戏渲染 (PixiJS)** | 渲染进程 | WebGL Canvas |
| **游戏逻辑** | 渲染进程 | 引擎核心、系统模块 |
| **输入捕获** | 渲染进程 | DOM 事件监听 |
| **音频播放** | 渲染进程 | Web Audio API |
| **UI 渲染** | 渲染进程 | HTML/CSS 或 Canvas 内 UI |
| **网络请求** | 渲染进程 | fetch API |
| **本地数据库** | 渲染进程 | IndexedDB / localStorage |

---

## 5. 开发与构建流程

### 5.1 开发工具链

```
┌─────────────────────────────────────────────────────────────────────┐
│                       开发工作流                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  编码                                                               │
│  ├── VSCode (推荐) / WebStorm                                       │
│  ├── ESLint + Prettier (代码规范)                                   │
│  └── JSDoc 类型注解 (开发时类型检查)                                 │
│                                                                     │
│  本地开发                                                           │
│  ├── Vite dev server (HMR 热更新)                                   │
│  │   - 游戏代码热更新                                               │
│  │   - 资源热替换                                                   │
│  │   - 场景编辑即时预览                                             │
│  └── Electron 开发模式                                              │
│       - 自动打开 DevTools                                           │
│       - React Developer Tools (如用 React UI)                       │
│       - PixiJS Inspector (PixiJS 调试面板)                          │
│                                                                     │
│  构建                                                               │
│  ├── Vite 构建生产包                                                 │
│  ├── electron-builder 打包桌面安装包                                 │
│  └── CI/CD (GitHub Actions)                                         │
│                                                                     │
│  调试                                                               │
│  ├── Chrome DevTools (性能/内存/网络)                                │
│  ├── 引擎内置 Profiler (FPS/绘制调用/内存使用)                       │
│  └── PixiJS 内置调试面板                                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Vite 配置

```javascript
// vite.config.js

import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    root: 'src',
    base: './',
    resolve: {
        alias: {
            '@engine': path.resolve(__dirname, 'src/engine'),
            '@scenes': path.resolve(__dirname, 'src/scenes'),
            '@systems': path.resolve(__dirname, 'src/systems'),
            '@config': path.resolve(__dirname, 'src/config'),
            '@assets': path.resolve(__dirname, 'assets'),
        }
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        target: 'es2020',
        minify: 'terser',
        rollupOptions: {
            input: path.resolve(__dirname, 'src/index.html'),
            output: {
                manualChunks: {
                    'pixi': ['pixi.js'],
                    'matter': ['matter-js'],
                    'engine': [
                        './src/engine/core/GameLoop.js',
                        './src/engine/core/Time.js',
                        './src/engine/events/EventBus.js',
                        './src/engine/scene/SceneManager.js',
                        './src/engine/resource/ResourceManager.js',
                    ]
                }
            }
        }
    },
    server: {
        port: 3000,
        open: false,
    },
    // 资源处理
    assetsInclude: ['**/*.png', '**/*.jpg', '**/*.ogg', '**/*.wav', '**/*.fnt'],
});
```

### 5.3 构建流程（electron-builder）

```json
// electron-builder.json
{
    "$schema": "https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/scheme.json",
    "appId": "com.cloudgrainrecord.game",
    "productName": "云汲仙田录",
    "directories": {
        "output": "release"
    },
    "files": [
        "dist/**/*",
        "electron/**/*",
        "package.json"
    ],
    "win": {
        "target": [
            {
                "target": "nsis",
                "arch": ["x64"]
            }
        ],
        "icon": "assets/icons/icon.ico"
    },
    "mac": {
        "target": ["dmg"],
        "icon": "assets/icons/icon.icns"
    },
    "linux": {
        "target": ["AppImage", "deb"],
        "icon": "assets/icons"
    },
    "nsis": {
        "oneClick": false,
        "allowToChangeInstallationDirectory": true,
        "createDesktopShortcut": true,
        "installerIcon": "assets/icons/icon.ico"
    },
    "extraResources": [
        {
            "from": "assets/",
            "to": "assets/",
            "filter": ["**/*"]
        }
    ]
}
```

### 5.4 NPM Scripts

```json
{
    "scripts": {
        "dev": "concurrently \"npm run dev:vite\" \"npm run dev:electron\"",
        "dev:vite": "vite --config vite.config.js",
        "dev:electron": "wait-on http://localhost:3000 && cross-env NODE_ENV=development electron .",
        "build": "npm run build:vite && npm run build:electron",
        "build:vite": "vite build --config vite.config.js",
        "build:electron": "electron-builder --config electron-builder.json",
        "build:win": "npm run build:vite && electron-builder --win --config electron-builder.json",
        "build:mac": "npm run build:vite && electron-builder --mac --config electron-builder.json",
        "build:linux": "npm run build:vite && electron-builder --linux --config electron-builder.json",
        "lint": "eslint src/ --ext .js",
        "test": "jest",
        "analyze": "vite build --config vite.config.js --mode analyze"
    }
}
```

### 5.5 依赖清单

```json
{
    "dependencies": {
        "pixi.js": "^8.0.0",
        "matter-js": "^0.19.0",
        "howler": "^2.2.4"
    },
    "devDependencies": {
        "electron": "^28.0.0",
        "electron-builder": "^24.0.0",
        "vite": "^5.0.0",
        "concurrently": "^8.0.0",
        "wait-on": "^7.0.0",
        "cross-env": "^7.0.0",
        "eslint": "^8.0.0",
        "prettier": "^3.0.0",
        "jest": "^29.0.0",
        "terser": "^5.0.0"
    },
    "optionalDependencies": {
        "steamworks.js": "^0.3.0",
        "electron-updater": "^6.0.0"
    }
}
```

---

## 6. 扩展性设计

### 6.1 插件机制

```javascript
// src/engine/plugin/PluginManager.js

/**
 * 插件管理器
 *
 * 设计原则：
 * 1. 插件是独立的 ES Module
 * 2. 每个插件有独立的命名空间
 * 3. 插件可以访问 EventBus 和 GameManager，不能直接修改引擎核心
 * 4. 支持插件的启用/禁用/热加载
 * 5. 插件间依赖管理
 */
export class PluginManager {
    constructor() {
        /** @private Map<string, Plugin> */
        this._plugins = new Map();
        /** @private Map<string, string[]> 插件依赖图 */
        this._dependencies = new Map();
    }

    /**
     * 安装插件
     * @param {string} pluginPath - 插件文件路径
     * @returns {Promise<Plugin>}
     */
    async install(pluginPath) {
        const module = await import(/* @vite-ignore */ pluginPath);
        const plugin = module.default;

        // 校验插件接口
        this._validatePlugin(plugin);

        // 检查依赖
        if (plugin.dependencies) {
            for (const dep of plugin.dependencies) {
                if (!this._plugins.has(dep)) {
                    throw new Error(
                        `Plugin "${plugin.name}" requires "${dep}"`
                    );
                }
            }
        }

        // 注册
        this._plugins.set(plugin.name, plugin);
        this._dependencies.set(plugin.name, plugin.dependencies || []);

        // 初始化
        if (plugin.onInstall) {
            await plugin.onInstall({
                eventBus: EventBus.instance,
                gameManager: GameManager.instance
            });
        }

        EventBus.instance.emit('plugin:installed', { name: plugin.name });
        return plugin;
    }

    /**
     * 卸载插件
     * @param {string} name
     */
    async uninstall(name) {
        // 检查是否有其他插件依赖此插件
        for (const [pluginName, deps] of this._dependencies) {
            if (deps.includes(name)) {
                throw new Error(
                    `Cannot uninstall "${name}": "${pluginName}" depends on it`
                );
            }
        }

        const plugin = this._plugins.get(name);
        if (!plugin) return;

        if (plugin.onUninstall) {
            await plugin.onUninstall();
        }

        this._plugins.delete(name);
        this._dependencies.delete(name);
        EventBus.instance.emit('plugin:uninstalled', { name });
    }

    /**
     * 获取插件
     * @param {string} name
     * @returns {Plugin|undefined}
     */
    get(name) { return this._plugins.get(name); }

    /** @returns {string[]} */
    getInstalledPlugins() { return [...this._plugins.keys()]; }

    /**
     * @private
     * @param {*} plugin
     */
    _validatePlugin(plugin) {
        if (!plugin.name) throw new Error('Plugin must have a name');
        if (!plugin.version) throw new Error('Plugin must have a version');
        if (this._plugins.has(plugin.name)) {
            throw new Error(`Plugin "${plugin.name}" is already installed`);
        }
    }
}

/**
 * @typedef {Object} Plugin
 * @property {string} name - 插件名
 * @property {string} version - 版本号
 * @property {string} [description] - 描述
 * @property {string[]} [dependencies] - 依赖的插件名列表
 * @property {(api: PluginAPI) => Promise<void>} [onInstall] - 安装时调用
 * @property {() => Promise<void>} [onUninstall] - 卸载时调用
 * @property {() => void} [onUpdate] - 每帧更新
 */

// ==================== 插件示例 ====================

/**
 * 开发者控制台插件示例
 */
export default {
    name: 'dev-console',
    version: '1.0.0',
    description: 'In-game developer console',

    onInstall({ eventBus, gameManager }) {
        // 注册控制台 UI
        // 监听命令输入
        eventBus.on('console:command', (cmd) => {
            this._executeCommand(cmd, gameManager);
        });
    },

    onUninstall() {
        // 清理控制台 UI
    },

    _executeCommand(cmd, gameManager) {
        const parts = cmd.trim().split(' ');
        const command = parts[0];
        const args = parts.slice(1);

        switch (command) {
            case 'god':
                gameManager.player.setInvincible(true);
                break;
            case 'give':
                gameManager.player.addItem(args[0], parseInt(args[1]) || 1);
                break;
            case 'tp':
                gameManager.player.teleport(
                    parseInt(args[0]), parseInt(args[1])
                );
                break;
            case 'help':
                console.log('Available commands: god, give, tp, help');
                break;
        }
    }
};
```

### 6.2 脚本系统

```javascript
// src/engine/script/ScriptEngine.js

/**
 * 脚本引擎 - 支持运行时脚本热加载
 *
 * 用途：
 * 1. 游戏内事件的动态行为（对话、任务、过场动画）
 * 2. 数据驱动的技能/符箓效果
 * 3. MOD 支持（玩家可编写自定义脚本）
 *
 * 安全策略：
 * - 运行在沙箱环境中
 * - 禁止访问 Node.js API
 * - 禁止危险的全局操作
 * - 执行时间限制（防止死循环）
 */
export class ScriptEngine {
    constructor() {
        /** @private Map<string, ScriptContext> */
        this._scripts = new Map();
        /** @private */
        this._maxExecutionTime = 100; // 单次执行最大毫秒数
    }

    /**
     * 注册脚本
     * @param {string} name - 脚本标识
     * @param {string} code - JavaScript 代码
     * @param {Object} [sandbox] - 沙箱环境变量
     */
    register(name, code, sandbox = {}) {
        try {
            // 创建沙箱
            const ctx = this._createSandbox(sandbox);
            const fn = new Function('ctx', `
                with (ctx) {
                    ${code}
                }
            `);

            this._scripts.set(name, {
                fn,
                sandbox: ctx,
                code
            });
        } catch (err) {
            console.error(`[ScriptEngine] Failed to register "${name}":`, err);
        }
    }

    /**
     * 执行脚本
     * @param {string} name
     * @param {Object} [params] - 传递给脚本的参数
     * @returns {*}
     */
    execute(name, params = {}) {
        const script = this._scripts.get(name);
        if (!script) {
            console.warn(`[ScriptEngine] Script "${name}" not found`);
            return null;
        }

        // 注入参数到沙箱
        Object.assign(script.sandbox, params);

        // 超时保护
        const timer = setTimeout(() => {
            console.error(`[ScriptEngine] Script "${name}" timed out`);
        }, this._maxExecutionTime);

        try {
            const result = script.fn(script.sandbox);
            clearTimeout(timer);
            return result;
        } catch (err) {
            clearTimeout(timer);
            console.error(`[ScriptEngine] Error executing "${name}":`, err);
            return null;
        }
    }

    /**
     * 热重载脚本
     * @param {string} name
     * @param {string} newCode
     */
    reload(name, newCode) {
        const existing = this._scripts.get(name);
        if (existing) {
            this.register(name, newCode, existing.sandbox);
            EventBus.instance.emit('script:reloaded', { name });
        }
    }

    /**
     * @private 创建沙箱
     */
    _createSandbox(extraVars) {
        return {
            // 安全的 API
            console: {
                log: (...args) => console.log('[Script]', ...args),
                warn: (...args) => console.warn('[Script]', ...args),
                error: (...args) => console.error('[Script]', ...args),
            },
            Math,
            JSON,
            Array,
            Object,
            String,
            Number,
            Boolean,
            Date: {
                now: Date.now,
            },
            setTimeout: (fn, ms) => setTimeout(fn, ms),
            clearTimeout,
            setInterval: (fn, ms) => setInterval(fn, ms),
            clearInterval,

            // 游戏 API
            EventBus: EventBus.instance,
            GameManager: GameManager.instance,

            // 工具函数
            wait: (ms) => new Promise(r => setTimeout(r, ms)),
            random: (min, max) => Math.random() * (max - min) + min,
            randomInt: (min, max) =>
                Math.floor(Math.random() * (max - min + 1)) + min,

            // 从沙箱外部注入的变量
            ...extraVars
        };
    }

    /** 清空所有脚本 */
    clear() { this._scripts.clear(); }
}
```

#### 脚本示例（对话系统）

```javascript
// 对话脚本示例 - 以数据驱动方式定义剧情
// 存放在 res://data/dialogs/valley_intro.js

// 注册到 ScriptEngine
ScriptEngine.instance.register('dialog:valley_intro', `
    // 沙箱中可用的变量: speaker, player, questSystem

    await showDialog(speaker, "欢迎来到青竹谷，旅者。");
    await showDialog(speaker, "这里是仙脉汇聚之地，灵气充沛。");

    const choice = await showChoice("你想了解什么？", [
        "关于青竹谷的历史",
        "关于修炼",
        "告辞"
    ]);

    if (choice === 0) {
        await showDialog(speaker, "青竹谷原本是上古灵脉的出口...");
        // 给玩家一本书
        player.addItem("ancient_tome", 1);
    } else if (choice === 1) {
        await showDialog(speaker, "修炼之道，始于炼气...");
        // 触发任务
        questSystem.startQuest("first_cultivation");
    } else {
        await showDialog(speaker, "后会有期。");
    }
`);
```

---

## 7. 项目目录结构

```
CloudGrainRecord/
│
├── package.json                 # Node.js 项目配置
├── vite.config.js               # Vite 构建配置
├── electron-builder.json        # Electron 打包配置
├── .eslintrc.js                 # ESLint 配置
├── .prettierrc                  # Prettier 配置
│
├── electron/                    # Electron 主进程
│   ├── main.js                  # 主进程入口
│   ├── preload.js               # 预加载脚本
│   └── steam.js                 # Steam 集成模块
│
├── src/                         # 游戏源码（渲染进程）
│   ├── index.html               # HTML 入口
│   ├── main.js                  # 游戏入口（初始化引擎）
│   │
│   ├── engine/                  # 引擎核心
│   │   ├── core/
│   │   │   ├── GameLoop.js      # 帧循环
│   │   │   ├── Time.js          # 时间控制
│   │   │   └── GameManager.js   # 全局状态管理
│   │   │
│   │   ├── events/
│   │   │   └── EventBus.js      # 事件总线
│   │   │
│   │   ├── render/
│   │   │   ├── RenderPipeline.js    # 渲染管线
│   │   │   ├── LayerStack.js        # 图层系统
│   │   │   ├── Camera2D.js          # 相机系统
│   │   │   ├── BlockSprite.js       # 2.5D 方块精灵
│   │   │   ├── AnimationController.js # 动画控制器
│   │   │   ├── ParticleSystem.js    # 粒子系统
│   │   │   ├── BatchRenderer.js     # 批处理渲染
│   │   │   └── DirtyRectManager.js  # 脏矩形优化
│   │   │
│   │   ├── scene/
│   │   │   ├── SceneManager.js      # 场景管理器
│   │   │   ├── Scene.js             # 场景基类
│   │   │   └── transitions.js       # 场景过渡效果
│   │   │
│   │   ├── input/
│   │   │   ├── InputManager.js      # 输入管理器
│   │   │   └── InputMap.js          # 输入映射
│   │   │
│   │   ├── audio/
│   │   │   └── AudioManager.js      # 音频管理器
│   │   │
│   │   ├── physics/
│   │   │   ├── PhysicsWorld.js      # 物理世界（Matter.js）
│   │   │   └── GridCollision.js     # 2.5D 网格碰撞
│   │   │
│   │   ├── resource/
│   │   │   ├── ResourceManager.js   # 资源管理器
│   │   │   └── loaders/             # 资源加载器
│   │   │       ├── TextureLoader.js
│   │   │       ├── AudioLoader.js
│   │   │       └── JSONLoader.js
│   │   │
│   │   ├── plugin/
│   │   │   └── PluginManager.js     # 插件管理器
│   │   │
│   │   ├── script/
│   │   │   └── ScriptEngine.js      # 脚本引擎
│   │   │
│   │   └── utils/
│   │       ├── ObjectPool.js        # 对象池
│   │       ├── MathUtils.js         # 数学工具
│   │       └── Debug.js             # 调试工具
│   │
│   ├── scenes/                  # 游戏场景
│   │   ├── BootScene.js         # 启动场景（加载资源）
│   │   ├── TitleScene.js        # 主菜单场景
│   │   ├── GameScene.js         # 主游戏场景
│   │   ├── ValleyScene.js       # 青竹谷场景
│   │   ├── CombatScene.js       # 战斗场景
│   │   └── ...
│   │
│   ├── systems/                 # 游戏系统模块
│   │   ├── PlayerController.js  # 玩家控制器
│   │   ├── CombatSystem.js      # 战斗系统
│   │   ├── TalismanSystem.js    # 符箓系统
│   │   ├── SealScriptSystem.js  # 古篆文系统
│   │   ├── FieldSystem.js       # 灵田系统
│   │   ├── CraftSystem.js       # 炼丹炼器
│   │   ├── QuestSystem.js       # 任务系统
│   │   ├── EconomySystem.js     # 经济系统
│   │   ├── BlockController.js   # 2.5D 方块系统
│   │   └── ...
│   │
│   ├── ui/                      # UI 界面
│   │   ├── HUD.js               # 游戏内 HUD
│   │   ├── InventoryPanel.js    # 背包界面
│   │   ├── MenuScreen.js        # 菜单界面
│   │   ├── DialogBox.js         # 对话界面
│   │   └── ...
│   │
│   └── config/                  # 配置文件
│       ├── defaultKeybindings.js # 默认键位
│       ├── assetManifest.js     # 资源清单
│       └── gameConstants.js     # 游戏常量
│
├── assets/                      # 资源文件
│   ├── sprites/                 # 像素精灵
│   ├── blocks/                  # 2.5D 方块纹理
│   ├── audio/                   # 音频
│   │   ├── bgm/
│   │   └── sfx/
│   ├── fonts/                   # 字体
│   ├── data/                    # 数据文件（JSON）
│   └── placeholder/             # 占位资源
│
├── tools/                       # 开发工具
│   ├── atlas-packager.js        # 纹理图集打包
│   └── asset-converter.js       # 资源格式转换
│
└── dist/                        # 构建输出
```

---

## 8. 编码规范与开发约束

### 8.1 JavaScript 编码规范

```
1. 文件命名: PascalCase.js (类/模块), camelCase.js (工具函数)
2. 类名: PascalCase
3. 方法/变量: camelCase
4. 私有成员: _prefix (下划线前缀)
5. 常量: UPPER_SNAKE_CASE
6. 类型注解: 全部使用 JSDoc
7. 文件结构顺序:
   import → 常量 → 类定义 → 静态方法 → 构造函数
   → 公有方法 → 私有方法 → export
8. 每个方法不超过 40 行
9. 函数参数必须有类型注解 (JSDoc @param)
10. 返回值必须有类型注解 (JSDoc @returns)
```

### 8.2 模块间通信规范

```
1. 模块间通信必须通过 EventBus
2. 禁止模块直接 import 其他模块的实例
3. 事件命名格式: {module}:{action} (小写)
4. 全局状态通过 GameManager 读写
5. 持久化配置通过 SettingsManager
```

### 8.3 资源路径规范

```
资源路径格式: res://{type}/{purpose}_{id}.{format}
示例:
  res://sprites/player_idle_01.png
  res://blocks/valley_grass_01.png
  res://audio/bgm/title_theme.ogg
  res://audio/sfx/ui/button_click.wav
  res://data/items.json
```

---

## 9. 风险与应对策略

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|---------|
| **渲染性能瓶颈**（大量方块） | 高 | 高 | 纹理烘焙 + 视锥剔除 + ParticleContainer |
| **物理-渲染坐标同步 bug** | 中 | 高 | 统一坐标转换层 + 单元测试 |
| **Electron 内存泄漏** | 中 | 中 | 引用计数 + 场景卸载时强制 GC |
| **音频上下文被浏览器限制** | 高 | 低 | 用户交互后初始化 AudioContext |
| **WebGL 兼容性问题** | 中 | 高 | Canvas 2D fallback + GPU 黑名单禁用 |
| **手柄输入不稳定** | 高 | 中 | 键盘为主 + Gamepad API 降级方案 |
| **构建体积过大** | 中 | 低 | Vite 代码分割 + 按需加载 |
| **插件系统安全风险** | 低 | 高 | 沙箱执行 + 时间限制 + API 白名单 |

---

> **本文档对应：[`docs/自研引擎方案可行性分析.md`](docs/自研引擎方案可行性分析.md)**
>
> **前置设计文档：**
> - [`docs/04_技术设计/01_项目结构.md`](docs/04_技术设计/01_项目结构.md)
> - [`docs/04_技术设计/02_架构与模块.md`](docs/04_技术设计/02_架构与模块.md)
> - [`docs/04_技术设计/03_数据管理.md`](docs/04_技术设计/03_数据管理.md)
> - [`docs/04_技术设计/04_输入控制.md`](docs/04_技术设计/04_输入控制.md)
> - [`docs/04_技术设计/05_性能优化.md`](docs/04_技术设计/05_性能优化.md)
