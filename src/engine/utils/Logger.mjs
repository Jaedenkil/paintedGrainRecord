// @ts-check

/**
 * @fileoverview
 * 全局日志管理器 - 引擎内所有 console 输出的统一调度中心。
 *
 * 设计原则：
 * 1. 所有模块的 console.log/warn/error 都通过此模块调用
 * 2. 提供全局开关 `Logger.enabled`，一键控制所有日志输出
 * 3. 日志自动附加模块前缀，格式统一为 `[ModuleName] 消息`
 * 4. 不替换原生 console 方法，避免破坏第三方库的日志
 * 5. 支持静默模式（silent），用于测试环境
 *
 * 用法：
 * ```javascript
 * import { Logger } from '../utils/Logger.mjs';
 *
 * const log = Logger.for('RenderSystem');
 * log.info('初始化完成');    // [RenderSystem] 初始化完成
 * log.warn('配置缺失');      // [RenderSystem] 配置缺失
 * log.error('渲染失败', e);  // [RenderSystem] 渲染失败
 *
 * // 全局关闭所有日志
 * Logger.enabled = false;
 *
 * // 测试时静默
 * Logger.silent = true;
 * ```
 *
 * @module utils/Logger
 */

/**
 * @typedef {'info'|'warn'|'error'|'debug'} LogLevel
 */

/**
 * 日志管理器（静态类）
 */
export class Logger {
    /**
     * 全局日志开关。
     * `true` 时所有日志正常输出，`false` 时抑制所有日志。
     * 默认 `true`。
     *
     * @type {boolean}
     * @example
     * ```javascript
     * // 关闭所有日志
     * Logger.enabled = false;
     *
     * // 开启所有日志
     * Logger.enabled = true;
     * ```
     */
    static enabled = true;

    /**
     * 静默模式（用于测试）。
     * 开启后内部静默抑制所有日志输出，不影响 enabled 状态。
     *
     * @type {boolean}
     */
    static silent = false;

    /**
     * 创建一个带模块前缀的日志实例。
     *
     * @param {string} moduleName - 模块名称（如 'Engine', 'RenderSystem'）
     * @returns {{ info: (msg: string, ...args: any[]) => void, warn: (msg: string, ...args: any[]) => void, error: (msg: string, ...args: any[]) => void, debug: (msg: string, ...args: any[]) => void }}
     *
     * @example
     * ```javascript
     * const log = Logger.for('Engine');
     * log.info('引擎启动');
     * log.warn('配置不完整');
     * log.error('初始化失败', new Error('...'));
     * ```
     */
    static for(moduleName) {
        const prefix = `[${moduleName}]`;

        return {
            /**
             * 输出 info 级别日志
             * @param {string} msg - 日志消息
             * @param {...any} args - 附加参数
             */
            info: (msg, ...args) => {
                if (!Logger.enabled || Logger.silent) return;
                console.log(`${prefix} ${msg}`, ...args);
            },

            /**
             * 输出 warn 级别日志
             * @param {string} msg - 警告消息
             * @param {...any} args - 附加参数
             */
            warn: (msg, ...args) => {
                if (!Logger.enabled || Logger.silent) return;
                console.warn(`${prefix} ${msg}`, ...args);
            },

            /**
             * 输出 error 级别日志
             * @param {string} msg - 错误消息
             * @param {...any} args - 附加参数
             */
            error: (msg, ...args) => {
                if (!Logger.enabled || Logger.silent) return;
                console.error(`${prefix} ${msg}`, ...args);
            },

            /**
             * 输出 debug 级别日志（仅在开发调试时有用）
             * @param {string} msg - 调试消息
             * @param {...any} args - 附加参数
             */
            debug: (msg, ...args) => {
                if (!Logger.enabled || Logger.silent) return;
                console.debug(`${prefix} ${msg}`, ...args);
            }
        };
    }

    /**
     * 输出一条无模块前缀的原始信息日志。
     * 适用于引擎启动/关闭等全局阶段。
     *
     * @param {string} msg - 日志消息
     * @param {...any} args - 附加参数
     *
     * @example
     * ```javascript
     * Logger.info('===== 引擎启动 =====');
     * ```
     */
    static info(msg, ...args) {
        if (!Logger.enabled || Logger.silent) return;
        console.log(msg, ...args);
    }

    /**
     * 输出一条无模块前缀的原始警告日志。
     *
     * @param {string} msg - 警告消息
     * @param {...any} args - 附加参数
     */
    static warn(msg, ...args) {
        if (!Logger.enabled || Logger.silent) return;
        console.warn(msg, ...args);
    }

    /**
     * 输出一条无模块前缀的原始错误日志。
     *
     * @param {string} msg - 错误消息
     * @param {...any} args - 附加参数
     */
    static error(msg, ...args) {
        if (!Logger.enabled || Logger.silent) return;
        console.error(msg, ...args);
    }
}
