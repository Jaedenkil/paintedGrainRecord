// @ts-check

/**
 * @fileoverview
 * 输入系统单元测试——覆盖 InputAdapter / KeyboardAdapter / MouseAdapter / InputMapper / InputModule。
 *
 * 测试策略：
 * - 使用 MockEventTarget 替代 window，避免 DOM 依赖
 * - 模拟事件对象直接调用适配器内部 handler，验证状态机转换
 * - 覆盖正常流程 + 边界（重复按、失焦重置、stopListeners 清理）
 *
 * @module input/__tests__/InputSystem
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { InputAdapter } from '../InputAdapter.mjs';
import { KeyboardAdapter } from '../KeyboardAdapter.mjs';
import { MouseAdapter } from '../MouseAdapter.mjs';
import { InputMapper } from '../InputMapper.mjs';
import { InputModule } from '../InputModule.mjs';

// ----------------------------------------------------------------
// 测试工具
// ----------------------------------------------------------------

/** 模拟 DOM 事件目标，捕获 addEventListener 注册的 handler。*/
class MockEventTarget {
    constructor() {
        /** @private @type {Object<string, Function>} */ this._handlers = {};
    }
    addEventListener(type, handler) {
        this._handlers[type] = handler;
    }
    removeEventListener(type) {
        delete this._handlers[type];
    }
    /** 触发指定类型的事件。如果 handler 接受 Event 对象，直接传入 mock。*/
    dispatch(type, mockEvent) {
        this._handlers[type]?.(mockEvent);
    }
    get hasListeners() {
        return Object.keys(this._handlers).length > 0;
    }
}

/** @returns {{ type: string, code: string, preventDefault: () => void }} */
function keyEvent(type, code) {
    return { type, code, preventDefault: () => {} };
}

/** @returns {{ type: string, button: number, clientX: number, clientY: number, movementX: number, movementY: number, preventDefault: () => void }} */
function mouseEvent(type, button = 0, clientX = 0, clientY = 0, movementX = 0, movementY = 0) {
    return { type, button, clientX, clientY, movementX, movementY, preventDefault: () => {} };
}

/** @returns {{ type: string, deltaX: number, deltaY: number, preventDefault: () => void }} */
function wheelEvent(deltaX = 0, deltaY = 0) {
    return { type: 'wheel', deltaX, deltaY, preventDefault: () => {} };
}

// ----------------------------------------------------------------
// InputAdapter — 抽象基类
// ----------------------------------------------------------------

describe('InputAdapter (base class)', () => {
    it('startListeners 设置 _target 并防止重复绑定', () => {
        const adapter = new InputAdapter();
        const targetA = new MockEventTarget();
        const targetB = new MockEventTarget();
        adapter.startListeners(targetA);
        adapter.startListeners(targetB); // 第二次调用应被忽略
        // 通过子类行为验证：子类 startListeners 中会 super.startListeners
        assert.equal(adapter._target, targetA);
    });

    it('stopListeners 清空 _target', () => {
        const adapter = new InputAdapter();
        adapter.startListeners(new MockEventTarget());
        adapter.stopListeners();
        assert.equal(adapter._target, null);
    });

    it('update / reset 无操作', () => {
        const adapter = new InputAdapter();
        adapter.startListeners(new MockEventTarget());
        assert.doesNotThrow(() => adapter.update());
        assert.doesNotThrow(() => adapter.reset());
    });

    it('destroy 调用 stopListeners', () => {
        const adapter = new InputAdapter();
        adapter.startListeners(new MockEventTarget());
        adapter.destroy();
        assert.equal(adapter._target, null);
    });
});

// ----------------------------------------------------------------
// KeyboardAdapter
// ----------------------------------------------------------------

describe('KeyboardAdapter', () => {
    /** @type {MockEventTarget} */ let target;
    /** @type {KeyboardAdapter} */ let kb;

    beforeEach(() => {
        target = new MockEventTarget();
        kb = new KeyboardAdapter();
        kb.startListeners(target);
    });

    afterEach(() => {
        kb.destroy();
    });

    it('keydown 设置 down/pressed', () => {
        target.dispatch('keydown', keyEvent('keydown', 'KeyA'));
        assert.equal(kb.isDown('KeyA'), true);
        assert.equal(kb.isPressed('KeyA'), true);
        assert.equal(kb.isReleased('KeyA'), false);
    });

    it('重复 keydown 不重复触发 pressed', () => {
        target.dispatch('keydown', keyEvent('keydown', 'KeyA'));
        target.dispatch('keydown', keyEvent('keydown', 'KeyA')); // 模拟硬件重复
        assert.equal(kb.isDown('KeyA'), true);
        assert.equal(kb.isPressed('KeyA'), true); // 第一次是 true
        kb.reset();
        assert.equal(kb.isPressed('KeyA'), false); // reset 后 cleared
        // 再次 dispatch 重复 keydown，此时 down 已为 true，pressed 不应再置 true
        target.dispatch('keydown', keyEvent('keydown', 'KeyA'));
        assert.equal(kb.isPressed('KeyA'), false);
    });

    it('keydown → keyup → reset 状态转换', () => {
        target.dispatch('keydown', keyEvent('keydown', 'KeyB'));
        assert.equal(kb.isDown('KeyB'), true);
        assert.equal(kb.isPressed('KeyB'), true);

        kb.reset(); // 清除瞬态
        assert.equal(kb.isPressed('KeyB'), false);
        assert.equal(kb.isDown('KeyB'), true); // 仍然按住

        target.dispatch('keyup', keyEvent('keyup', 'KeyB'));
        assert.equal(kb.isDown('KeyB'), false);
        assert.equal(kb.isReleased('KeyB'), true);

        kb.reset();
        assert.equal(kb.isReleased('KeyB'), false);
    });

    it('getActiveKeys 返回所有按住键', () => {
        target.dispatch('keydown', keyEvent('keydown', 'KeyW'));
        target.dispatch('keydown', keyEvent('keydown', 'KeyA'));
        const active = kb.getActiveKeys();
        assert.ok(active.includes('KeyW'));
        assert.ok(active.includes('KeyA'));
        assert.equal(active.length, 2);
    });

    it('blur 重置所有按下键为 released', () => {
        target.dispatch('keydown', keyEvent('keydown', 'KeyA'));
        target.dispatch('keydown', keyEvent('keydown', 'KeyD'));
        assert.equal(kb.isDown('KeyA'), true);
        assert.equal(kb.isDown('KeyD'), true);

        target.dispatch('blur', { type: 'blur' });
        assert.equal(kb.isDown('KeyA'), false);
        assert.equal(kb.isDown('KeyD'), false);
        assert.equal(kb.isReleased('KeyA'), true);
        assert.equal(kb.isReleased('KeyD'), true);
    });

    it('未绑定的键返回 false', () => {
        assert.equal(kb.isDown('KeyZ'), false);
        assert.equal(kb.isPressed('KeyZ'), false);
        assert.equal(kb.isReleased('KeyZ'), false);
    });

    it('keydown 对游戏键阻止默认行为', () => {
        let prevented = false;
        const ev = { type: 'keydown', code: 'Space', preventDefault: () => { prevented = true; } };
        target.dispatch('keydown', ev);
        assert.equal(prevented, true);
    });

    it('stopListeners 移除所有监听', () => {
        kb.stopListeners();
        assert.equal(target.hasListeners, false);
    });
});

// ----------------------------------------------------------------
// MouseAdapter
// ----------------------------------------------------------------

describe('MouseAdapter', () => {
    /** @type {MockEventTarget} */ let target;
    /** @type {MouseAdapter} */ let mouse;

    beforeEach(() => {
        target = new MockEventTarget();
        mouse = new MouseAdapter();
        mouse.startListeners(target);
    });

    afterEach(() => {
        mouse.destroy();
    });

    it('mousemove 更新位置和 delta', () => {
        target.dispatch('mousemove', mouseEvent('mousemove', 0, 100, 200, 5, 10));
        assert.equal(mouse.x, 100);
        assert.equal(mouse.y, 200);
        assert.equal(mouse.delta.dx, 5);
        assert.equal(mouse.delta.dy, 10);
    });

    it('多次 mousemove 累积 delta', () => {
        target.dispatch('mousemove', mouseEvent('mousemove', 0, 100, 100, 3, 4));
        target.dispatch('mousemove', mouseEvent('mousemove', 0, 120, 130, 7, 8));
        assert.equal(mouse.delta.dx, 10);
        assert.equal(mouse.delta.dy, 12);
    });

    it('reset 清空 delta', () => {
        target.dispatch('mousemove', mouseEvent('mousemove', 0, 100, 100, 5, 10));
        mouse.reset();
        assert.equal(mouse.delta.dx, 0);
        assert.equal(mouse.delta.dy, 0);
    });

    it('mousedown/mouseup 按钮状态转换', () => {
        target.dispatch('mousedown', mouseEvent('mousedown', 0));
        assert.equal(mouse.isDown(0), true);
        assert.equal(mouse.isPressed(0), true);

        mouse.reset();
        assert.equal(mouse.isPressed(0), false);

        target.dispatch('mouseup', mouseEvent('mouseup', 0));
        assert.equal(mouse.isDown(0), false);
        assert.equal(mouse.isReleased(0), true);

        mouse.reset();
        assert.equal(mouse.isReleased(0), false);
    });

    it('wheel 累积滚轮 delta', () => {
        target.dispatch('wheel', wheelEvent(0, 120));
        target.dispatch('wheel', wheelEvent(0, -60));
        assert.equal(mouse.scroll.dx, 0);
        assert.equal(mouse.scroll.dy, 60);
    });

    it('reset 清空滚轮 delta', () => {
        target.dispatch('wheel', wheelEvent(0, 120));
        mouse.reset();
        assert.equal(mouse.scroll.dy, 0);
    });

    it('contextmenu 阻止默认行为', () => {
        let prevented = false;
        target.dispatch('contextmenu', { type: 'contextmenu', preventDefault: () => { prevented = true; } });
        assert.equal(prevented, true);
    });

    it('未绑定的按钮返回 false', () => {
        assert.equal(mouse.isDown(5), false);
        assert.equal(mouse.isPressed(5), false);
        assert.equal(mouse.isReleased(5), false);
    });

    it('stopListeners 移除所有监听', () => {
        mouse.stopListeners();
        assert.equal(target.hasListeners, false);
    });
});

// ----------------------------------------------------------------
// InputMapper
// ----------------------------------------------------------------

describe('InputMapper', () => {
    /** @type {KeyboardAdapter} */ let kb;
    /** @type {MouseAdapter} */ let mouse;
    /** @type {InputMapper} */ let mapper;

    beforeEach(() => {
        kb = new KeyboardAdapter();
        mouse = new MouseAdapter();
        mapper = new InputMapper(kb, mouse);
    });

    it('bind + isDown 委托给键盘适配器', () => {
        // 手动模拟键盘按下
        const kbTarget = new MockEventTarget();
        kb.startListeners(kbTarget);
        mapper.bind('move_left', { type: 'key', code: 'KeyA' });

        assert.equal(mapper.isDown('move_left'), false);
        kbTarget.dispatch('keydown', keyEvent('keydown', 'KeyA'));
        assert.equal(mapper.isDown('move_left'), true);
    });

    it('未绑定的动作返回 false', () => {
        assert.equal(mapper.isDown('nonexistent'), false);
        assert.equal(mapper.isPressed('nonexistent'), false);
        assert.equal(mapper.isReleased('nonexistent'), false);
    });

    it('多绑定 OR 逻辑——任一匹配即 true', () => {
        const kbTarget = new MockEventTarget();
        kb.startListeners(kbTarget);
        mapper.bind('jump', { type: 'key', code: 'Space' });
        mapper.bind('jump', { type: 'key', code: 'KeyW' });

        assert.equal(mapper.isDown('jump'), false);
        kbTarget.dispatch('keydown', keyEvent('keydown', 'Space'));
        assert.equal(mapper.isDown('jump'), true);
        kbTarget.dispatch('keyup', keyEvent('keyup', 'Space'));
        assert.equal(mapper.isDown('jump'), false);
        kbTarget.dispatch('keydown', keyEvent('keydown', 'KeyW'));
        assert.equal(mapper.isDown('jump'), true);
    });

    it('unbind 移除动作', () => {
        mapper.bind('action', { type: 'key', code: 'KeyA' });
        assert.equal(mapper.getActions().length, 1);
        mapper.unbind('action');
        assert.equal(mapper.getActions().length, 0);
        assert.equal(mapper.isDown('action'), false);
    });

    it('clear 移除所有绑定', () => {
        mapper.bind('a1', { type: 'key', code: 'KeyA' });
        mapper.bind('a2', { type: 'key', code: 'KeyB' });
        mapper.clear();
        assert.equal(mapper.getActions().length, 0);
    });

    it('getActions / getBindings 返回快照', () => {
        mapper.bind('shoot', { type: 'mouseButton', button: 0 });
        assert.deepEqual(mapper.getActions(), ['shoot']);
        const bindings = mapper.getBindings('shoot');
        assert.equal(bindings.length, 1);
        assert.equal(bindings[0].type, 'mouseButton');
        assert.equal(bindings[0].button, 0);
    });

    it('鼠标按钮绑定委托给鼠标适配器', () => {
        const mouseTarget = new MockEventTarget();
        mouse.startListeners(mouseTarget);
        mapper.bind('click', { type: 'mouseButton', button: 0 });

        assert.equal(mapper.isPressed('click'), false);
        mouseTarget.dispatch('mousedown', mouseEvent('mousedown', 0));
        assert.equal(mapper.isPressed('click'), true);
    });
});

// ----------------------------------------------------------------
// InputModule — 编排器集成
// ----------------------------------------------------------------

describe('InputModule', () => {
    /** @type {MockEventTarget} */ let target;
    /** @type {InputModule} */ let module;

    beforeEach(() => {
        target = new MockEventTarget();
        module = new InputModule(/** @type {any} */ (target));
        module.start();
    });

    afterEach(() => {
        module.destroy();
    });

    it('start 启动适配器监听', () => {
        assert.equal(target.hasListeners, true);
    });

    it('bind + 键盘事件 → isDown 可用', () => {
        module.bind('up', { type: 'key', code: 'KeyW' });
        assert.equal(module.isDown('up'), false);
        target.dispatch('keydown', keyEvent('keydown', 'KeyW'));
        assert.equal(module.isDown('up'), true);
    });

    it('endFrame 清空瞬态', () => {
        module.bind('fire', { type: 'key', code: 'Space' });
        target.dispatch('keydown', keyEvent('keydown', 'Space'));
        assert.equal(module.isPressed('fire'), true);
        module.endFrame();
        assert.equal(module.isPressed('fire'), false);
        assert.equal(module.isDown('fire'), true); // 持续按住
    });

    it('unbind 解绑动作', () => {
        module.bind('test', { type: 'key', code: 'KeyA' });
        module.unbind('test');
        assert.equal(module.isDown('test'), false);
    });

    it('clearBindings 清除所有', () => {
        module.bind('a', { type: 'key', code: 'KeyA' });
        module.bind('b', { type: 'key', code: 'KeyB' });
        module.clearBindings();
        assert.equal(module.isDown('a'), false);
        assert.equal(module.isDown('b'), false);
    });

    it('destroy 停止所有监听', () => {
        module.destroy();
        assert.equal(target.hasListeners, false);
        // 再次 destroy 应安全
        assert.doesNotThrow(() => module.destroy());
    });

    it('多次 start 安全', () => {
        const mod = new InputModule(/** @type {any} */ (target));
        mod.start();
        mod.start(); // 第二次应被忽略
        assert.doesNotThrow(() => mod.destroy());
    });

    it('update 和 endFrame 安全执行', () => {
        assert.doesNotThrow(() => module.update());
        assert.doesNotThrow(() => module.endFrame());
    });
});
