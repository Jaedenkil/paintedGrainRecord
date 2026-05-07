// @ts-check

/**
 * @fileoverview
 * 错误处理工具函数集。
 *
 * 提供跨模块统一的错误信息提取和格式化能力，
 * 解决 `@ts-check` 模式下 `catch (err)` 中 `err` 为 `unknown` 的类型问题。
 *
 * @module utils/error
 */

/**
 * 安全地从未知类型错误中提取可读的错误消息字符串。
 *
 * 处理以下情况：
 * - `Error` 实例：返回 `.message`
 * - 字符串：直接返回
 * - 带有 `message` 属性的对象：返回 `String(err.message)`
 * - 其他（如 `null`、`undefined`、数字）：返回 `String(err)`
 *
 * @param {unknown} err - catch 捕获的错误值
 * @returns {string} 可读的错误消息
 *
 * @example
 * ```javascript
 * import { getErrorMessage } from '../utils/error.mjs';
 *
 * try {
 *     throw new Error('磁盘空间不足');
 * } catch (err) {
 *     console.error(getErrorMessage(err)); // "磁盘空间不足"
 * }
 *
 * try {
 *     throw '连接超时';
 * } catch (err) {
 *     console.error(getErrorMessage(err)); // "连接超时"
 * }
 * ```
 */
export function getErrorMessage(err) {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && 'message' in err) {
        return String(err.message);
    }
    return String(err);
}
