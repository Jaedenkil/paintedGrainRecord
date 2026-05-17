// @ts-check

/**
 * @fileoverview
 * BlockGridManager 的事件订阅绑定器 —— 将 block:placed / block:removed
 * 事件桥接到 BlockGridManager 的 addBlock / removeBlock 方法。
 *
 * 设计说明：
 * - 纯函数式设计：subscribeEvents() 接收 manager 和 eventBus，返回解绑函数数组
 * - 不持有任何状态，状态全部由 BlockGridManager 管理
 * - 配合 BlockGridOperator 和 BlockGridManager 形成"操作器 + 绑定器 + 数据"三分架构
 *
 * @module render/block/BlockGridEventBinder
 */

import { Logger } from '../../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('BlockGridEventBinder');

/**
 * 订阅 block:placed 和 block:removed 事件。
 *
 * @param {import('./BlockGridManager.mjs').BlockGridManager} manager - 网格管理器实例
 * @param {import('../../core/EventBus.mjs').EventBus} eventBus - 事件总线实例
 * @returns {Array<() => void>} 解绑函数数组，destroy 时调用
 *
 * @example
 * ```javascript
 * const unsubs = subscribeEvents(gridManager, eventBus);
 * // ... later ...
 * unsubs.forEach(fn => fn());
 * ```
 */
export function subscribeEvents(manager, eventBus) {
    /** @type {Array<() => void>} */
    const unsubscribers = [];

    const onPlaced = (/** @type {{ gx: number, gy: number, gz: number, blockType: string }} */ data) => {
        if (data && typeof data.gx === 'number' && typeof data.gy === 'number' && data.blockType) {
            const gz = data.gz || 0;
            manager.addBlock(data.gx, data.gy, gz, data.blockType).catch(err => {
                log.error(`事件 block:placed 响应失败:`, err);
            });
        }
    };

    const onRemoved = (/** @type {{ gx: number, gy: number, gz: number }} */ data) => {
        if (data && typeof data.gx === 'number' && typeof data.gy === 'number') {
            const gz = data.gz || 0;
            manager.removeBlock(data.gx, data.gy, gz);
        }
    };

    unsubscribers.push(eventBus.on('block:placed', onPlaced, manager));
    unsubscribers.push(eventBus.on('block:removed', onRemoved, manager));

    return unsubscribers;
}
