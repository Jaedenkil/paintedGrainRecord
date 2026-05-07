/**
 * PIXI 全局变量类型声明
 *
 * PixiJS 通过 CDN <script> 标签加载，挂载为 window.PIXI 全局变量。
 * 此文件告知 TypeScript 编译器 `PIXI` 全局的存在及其类型。
 * 依赖 `pixi.js` 包（devDependencies）提供具体类型定义。
 *
 * 注意：必须使用 `declare global {}` 包裹，因为顶层的 `import` 语句
 * 使此文件变为"模块声明"，否则内部声明不会提升为全局。
 */
import 'pixi.js';

declare global {
    const PIXI: typeof import('pixi.js');
}
