/**
 * 三面方块纹理归档与重命名脚本 (v2)
 * 
 * 功能：
 *   - 扫描 assets/blocks/game_materials/ 下所有 .png 文件
 *   - 按素材类型分发到 assets/blocks/{素材名}/ 对应子文件夹
 *   - 按格式 {素材名}_{编号}_{三面标识}.png 重命名
 *   - 生成归档清单日志 assets/blocks/_manifest.json
 * 
 * 使用方式：node tools/organize_blocks_textures.mjs
 */

import { readdirSync, mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_DIR = join(ROOT, 'assets', 'blocks', 'game_materials');
const BLOCKS_DIR = join(ROOT, 'assets', 'blocks');

// 已知的 12 个素材子文件夹
const MATERIAL_FOLDERS = [
  'brick', 'cloud', 'dirt', 'farm', 'grass', 'jade',
  'plank', 'roof', 'sand', 'snow', 'stone', 'water',
];

// ============================================================
// 1. 素材类型映射：从文件名提取素材信息
// ============================================================

/**
 * 从文件名解析素材信息
 * 文件名格式示例：dirt_v1_left.png
 * @param {string} filename
 * @returns {{ material: string, version: number, face: string } | null}
 */
function parseFilename(filename) {
  const name = basename(filename, extname(filename));
  const match = name.match(/^([a-z]+)_v(\d+)_(left|right|top)$/);
  if (!match) return null;
  return {
    material: match[1],
    version: parseInt(match[2], 10),
    face: match[3],
  };
}

// ============================================================
// 2. 收集所有文件
// ============================================================

/** @type {Array<{ srcPath: string, material: string, version: number, face: string, scene: string }>} */
const allFiles = [];

function collectFiles(dir, sceneName) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, entry.name);
    } else if (entry.isFile() && entry.name.endsWith('.png')) {
      const parsed = parseFilename(entry.name);
      if (parsed) {
        allFiles.push({
          srcPath: fullPath,
          ...parsed,
          scene: sceneName,
        });
      } else {
        console.warn(`⚠️  跳过无法解析的文件: ${relative(SRC_DIR, fullPath)}`);
      }
    }
  }
}

console.log('📂 扫描素材源目录...');
collectFiles(SRC_DIR, '');
console.log(`   找到 ${allFiles.length} 个有效纹理文件\n`);

// ============================================================
// 3. 按素材分组 + 分配编号
// ============================================================

/** @type {Map<string, Array<typeof allFiles[0]>>} */
const materialGroups = new Map();
for (const file of allFiles) {
  const group = materialGroups.get(file.material) || [];
  group.push(file);
  materialGroups.set(file.material, group);
}

// 按素材名的字母顺序排序
const sortedMaterials = [...materialGroups.entries()].sort(([a], [b]) => a.localeCompare(b));

// ============================================================
// 4. 执行分发
// ============================================================

/** @type {Array<{ original: string, dest: string, material: string, face: string, scene: string }>} */
const manifestEntries = [];
let copiedCount = 0;
let skippedCount = 0;

for (const [material, files] of sortedMaterials) {
  // 确定目标文件夹
  const targetFolder = join(BLOCKS_DIR, material);

  // 确保目标文件夹存在
  if (!existsSync(targetFolder)) {
    mkdirSync(targetFolder, { recursive: true });
    console.log(`📁 创建目录: ${relative(ROOT, targetFolder)}/`);
  }

  // 按 (场景, 版本) 排序，保证编号稳定
  files.sort((a, b) => {
    if (a.scene !== b.scene) return a.scene.localeCompare(b.scene);
    return a.version - b.version;
  });

  let index = 0;

  for (const file of files) {
    index++;
    const paddedIndex = String(index).padStart(3, '0');
    const newFilename = `${material}_${paddedIndex}_${file.face}.png`;
    const destPath = join(targetFolder, newFilename);

    // 检查目标文件是否已存在
    if (existsSync(destPath)) {
      console.warn(`⚠️  跳过（目标已存在）: ${relative(ROOT, destPath)}`);
      manifestEntries.push({
        original: relative(ROOT, file.srcPath),
        dest: relative(ROOT, destPath),
        material,
        face: file.face,
        scene: file.scene,
        status: 'skipped',
      });
      skippedCount++;
      continue;
    }

    // 复制文件（保留源文件作为备份）
    copyFileSync(file.srcPath, destPath);
    copiedCount++;

    manifestEntries.push({
      original: relative(ROOT, file.srcPath),
      dest: relative(ROOT, destPath),
      material,
      face: file.face,
      scene: file.scene,
      status: 'copied',
    });
  }
}

// ============================================================
// 5. 生成归档清单
// ============================================================

const manifest = {
  generatedAt: new Date().toISOString(),
  tool: relative(ROOT, join(__dirname, 'organize_blocks_textures.mjs')),
  summary: {
    totalFound: allFiles.length,
    copied: copiedCount,
    skipped: skippedCount,
    materialTypes: materialGroups.size,
    baseDirectory: relative(ROOT, BLOCKS_DIR),
  },
  materialCounts: {},
  entries: manifestEntries,
};

// 统计每种素材的文件数
for (const [material, files] of sortedMaterials) {
  manifest.materialCounts[material] = files.length;
}

const manifestPath = join(BLOCKS_DIR, '_manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

// ============================================================
// 6. 输出摘要
// ============================================================

console.log('='.repeat(56));
console.log('  ✅ 归档完成');
console.log('='.repeat(56));
console.log(`  源目录:     ${relative(ROOT, SRC_DIR)}/`);
console.log(`  基目录:     ${relative(ROOT, BLOCKS_DIR)}/{素材名}/`);
console.log(`  素材类型数: ${materialGroups.size}`);
console.log(`  文件总数:   ${allFiles.length}`);
console.log(`  已复制:     ${copiedCount}`);
console.log(`  已跳过:     ${skippedCount}`);
console.log(`  清单文件:   ${relative(ROOT, manifestPath)}`);
console.log('');

// 打印各素材分发详情
console.log('📂 文件分发详情:');
for (const [material, files] of sortedMaterials) {
  const scenes = [...new Set(files.map(f => f.scene))].sort().join(', ');
  const faceCounts = {};
  for (const f of files) faceCounts[f.face] = (faceCounts[f.face] || 0) + 1;
  const faces = Object.entries(faceCounts)
    .map(([face, count]) => `${face}×${count}`)
    .join(', ');
  console.log(`  [${material.padEnd(10)}] → assets/blocks/${material}/  (${String(files.length).padStart(2)} 文件, ${faces})  来源: ${scenes}`);
}

console.log(`\n📋 归档清单路径:`);
console.log(`  ${relative(ROOT, manifestPath)}`);
