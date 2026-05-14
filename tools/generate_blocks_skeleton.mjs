/**
 * 方块纹理骨架生成脚本
 * 
 * 功能：
 *   - 清理各素材文件夹中旧命名文件
 *   - 生成期望的文件结构清单 _manifest.skeleton.json
 *   - 生成一份 Markdown 对照表，方便用户按名生成素材
 * 
 * 使用方式：node tools/generate_blocks_skeleton.mjs
 */

import { readdirSync, unlinkSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BLOCKS_DIR = join(ROOT, 'assets', 'blocks');

// ============================================================
// 1. 定义期望的素材结构（根据之前分析的结果）
// ============================================================

/**
 * 每个素材项的期望文件
 * @typedef {{ material: string, sourceScene: string, sourceVersion: number, face: string, expectedName: string }} ExpectedFile
 */

/** @type {Array<{ material: string, scene: string, version: number, faces: string[] }>} */
const materialSourceMap = [
  // dark_forest
  { material: 'dirt',   scene: 'dark_forest',     version: 1, faces: ['left', 'right', 'top'] },
  { material: 'dirt',   scene: 'dark_forest',     version: 2, faces: ['left', 'right', 'top'] },
  { material: 'grass',  scene: 'dark_forest',     version: 1, faces: ['left', 'right', 'top'] },
  { material: 'grass',  scene: 'dark_forest',     version: 2, faces: ['left', 'right', 'top'] },
  // luoxia_mountain
  { material: 'brick',  scene: 'luoxia_mountain', version: 1, faces: ['left', 'right', 'top'] },
  { material: 'brick',  scene: 'luoxia_mountain', version: 2, faces: ['left', 'right', 'top'] },
  { material: 'roof',   scene: 'luoxia_mountain', version: 1, faces: ['left', 'right', 'top'] },
  { material: 'roof',   scene: 'luoxia_mountain', version: 2, faces: ['left', 'right', 'top'] },
  { material: 'sand',   scene: 'luoxia_mountain', version: 1, faces: ['left', 'right', 'top'] },
  { material: 'sand',   scene: 'luoxia_mountain', version: 2, faces: ['left', 'right', 'top'] },
  { material: 'stone',  scene: 'luoxia_mountain', version: 1, faces: ['left', 'right', 'top'] },
  { material: 'stone',  scene: 'luoxia_mountain', version: 2, faces: ['left', 'right', 'top'] },
  // qingzhu_valley
  { material: 'dirt',   scene: 'qingzhu_valley',  version: 1, faces: ['left', 'right', 'top'] },
  { material: 'dirt',   scene: 'qingzhu_valley',  version: 2, faces: ['left', 'right', 'top'] },
  { material: 'farm',   scene: 'qingzhu_valley',  version: 1, faces: ['left', 'right', 'top'] },
  { material: 'farm',   scene: 'qingzhu_valley',  version: 2, faces: ['left', 'right', 'top'] },
  { material: 'grass',  scene: 'qingzhu_valley',  version: 1, faces: ['left', 'right', 'top'] },
  { material: 'grass',  scene: 'qingzhu_valley',  version: 2, faces: ['left', 'right', 'top'] },
  { material: 'plank',  scene: 'qingzhu_valley',  version: 1, faces: ['left', 'right', 'top'] },
  { material: 'plank',  scene: 'qingzhu_valley',  version: 2, faces: ['left', 'right', 'top'] },
  // special
  { material: 'cloud',  scene: 'special',         version: 1, faces: ['left', 'right', 'top'] },
  { material: 'cloud',  scene: 'special',         version: 2, faces: ['left', 'right', 'top'] },
  { material: 'glow',   scene: 'special',         version: 1, faces: ['left', 'right', 'top'] },
  { material: 'glow',   scene: 'special',         version: 2, faces: ['left', 'right', 'top'] },
  { material: 'jade',   scene: 'special',         version: 1, faces: ['left', 'right', 'top'] },
  { material: 'jade',   scene: 'special',         version: 2, faces: ['left', 'right', 'top'] },
  { material: 'magma',  scene: 'special',         version: 1, faces: ['left', 'right', 'top'] },
  { material: 'magma',  scene: 'special',         version: 2, faces: ['left', 'right', 'top'] },
  { material: 'snow',   scene: 'special',         version: 1, faces: ['left', 'right', 'top'] },
  { material: 'snow',   scene: 'special',         version: 2, faces: ['left', 'right', 'top'] },
  { material: 'water',  scene: 'special',         version: 1, faces: ['left', 'right', 'top'] },
  { material: 'water',  scene: 'special',         version: 2, faces: ['left', 'right', 'top'] },
];

// ============================================================
// 2. 计算每个素材的最终文件名（按场景+版本排序，连续编号）
// ============================================================

/** @type {Map<string, number>} */
const materialCounter = new Map();

/** @type {Array<{ material: string, folder: string, filename: string, face: string, scene: string, version: number }>} */
const expectedFiles = [];

// 先按素材分组
const byMaterial = new Map();
for (const item of materialSourceMap) {
  const list = byMaterial.get(item.material) || [];
  list.push(item);
  byMaterial.set(item.material, list);
}

// 对每种素材，按 (场景, 版本) 排序后分配编号
const sortedMaterials = [...byMaterial.entries()].sort(([a], [b]) => a.localeCompare(b));
for (const [material, items] of sortedMaterials) {
  items.sort((a, b) => {
    if (a.scene !== b.scene) return a.scene.localeCompare(b.scene);
    return a.version - b.version;
  });

  let index = 0;
  for (const item of items) {
    for (const face of item.faces) {
      index++;
      const paddedIndex = String(index).padStart(3, '0');
      const filename = `${material}_${paddedIndex}_${face}.png`;
      expectedFiles.push({
        material,
        folder: join(BLOCKS_DIR, material),
        filename,
        face,
        scene: item.scene,
        version: item.version,
      });
    }
  }
  materialCounter.set(material, index);
}

// ============================================================
// 3. 清理旧命名文件（如 block_grass_*.png）
// ============================================================

let cleanedCount = 0;
for (const [material] of sortedMaterials) {
  const folder = join(BLOCKS_DIR, material);
  if (!existsSync(folder)) continue;

  const entries = readdirSync(folder, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.png')) continue;

    // 判断是否为旧命名文件（不匹配 {material}_*.png 格式的）
    const pattern = new RegExp(`^${material}_\\d{3}_(left|right|top)\\.png$`);
    if (!pattern.test(entry.name)) {
      const fullPath = join(folder, entry.name);
      unlinkSync(fullPath);
      cleanedCount++;
      console.log(`🧹 清理旧文件: ${relative(ROOT, fullPath)}`);
    }
  }
}

// ============================================================
// 4. 生成骨架清单 JSON
// ============================================================

const skeletonManifest = {
  generatedAt: new Date().toISOString(),
  tool: relative(ROOT, join(__dirname, 'generate_blocks_skeleton.mjs')),
  description: '素材骨架清单——按此清单生成文件放入对应素材文件夹即可',
  usage: '使用 AI 素材生成工具，按 expectedName 命名，放入 assets/blocks/{material}/ 目录',
  summary: {
    totalExpected: expectedFiles.length,
    materialTypes: sortedMaterials.length,
    cleanedOldFiles: cleanedCount,
  },
  materialCounts: Object.fromEntries(sortedMaterials.map(([m]) => [m, materialCounter.get(m)])),
  expectedFiles: expectedFiles.map(f => ({
    material: f.material,
    targetFolder: relative(ROOT, f.folder),
    expectedName: f.filename,
    face: f.face,
    sourceScene: f.scene,
    sourceVersion: f.version,
  })),
};

const manifestPath = join(BLOCKS_DIR, '_manifest.skeleton.json');
writeFileSync(manifestPath, JSON.stringify(skeletonManifest, null, 2), 'utf-8');

// ============================================================
// 5. 生成 Markdown 对照表
// ============================================================

const mdPath = join(BLOCKS_DIR, '_命名对照表.md');

let md = '# 方块纹理命名对照表\n\n';
md += `> 生成时间：${new Date().toLocaleString('zh-CN')}\n\n`;
md += '## 使用说明\n\n';
md += '1. 用 AI 生成三面方块纹理\n';
md += '2. 按本表期望的文件名命名\n';
md += '3. 放入对应素材文件夹即可\n';
md += '4. 后续加载器会按 `${material}_${编号}_${面标识}.png` 模式匹配\n\n';
md += '---\n\n';

for (const [material, items] of sortedMaterials) {
  const count = materialCounter.get(material);
  
  // 找出所有涉及的场景
  const scenes = [...new Set(items.map(i => i.scene))].sort().join('、');
  
  md += `## ${material}（共 ${count} 个文件）\n\n`;
  md += `- **目标文件夹**：\`assets/blocks/${material}/\`\n`;
  md += `- **来源场景**：${scenes}\n\n`;
  md += `| 期望文件名 | 三面 | 来源 | 版本 |\n`;
  md += `|------------|------|------|------|\n`;

  const materialFiles = expectedFiles.filter(f => f.material === material);
  for (const f of materialFiles) {
    md += `| \`${f.filename}\` | ${f.face} | ${f.scene} | v${f.version} |\n`;
  }
  md += '\n';
}

md += '---\n\n';
md += '## 生成脚本\n\n';
md += `本文件由 \`tools/generate_blocks_skeleton.mjs\` 自动生成。\n`;

writeFileSync(mdPath, md, 'utf-8');

// ============================================================
// 6. 输出摘要
// ============================================================

console.log('='.repeat(56));
console.log('  ✅ 骨架结构已就绪');
console.log('='.repeat(56));
console.log(`  素材类型数:    ${sortedMaterials.length}`);
console.log(`  期望文件总数:  ${expectedFiles.length}`);
console.log(`  已清理旧文件:  ${cleanedCount}`);
console.log('');
console.log('📂 目标文件夹结构:');
console.log(`  assets/blocks/{素材名}/`);
console.log('');

for (const [material] of sortedMaterials) {
  const count = materialCounter.get(material);
  const scenes = [...new Set(
    materialSourceMap.filter(i => i.material === material).map(i => i.scene)
  )].sort().join(', ');
  const faces = ['left', 'right', 'top'];
  console.log(`  ${material.padEnd(10)} → ${String(count).padStart(2)} 文件  [${scenes}]`);
}

console.log('');
console.log('📋 生成的文件:');
console.log(`  ${relative(ROOT, manifestPath)}`);
console.log(`  ${relative(ROOT, mdPath)}`);
console.log('');
console.log('💡 下一步: 使用 AI 按 _命名对照表.md 生成对应文件即可');
