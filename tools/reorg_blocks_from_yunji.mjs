// @ts-check

/**
 * @fileoverview
 * 从 `assets/blocks/云汲仙田录` 自动归类素材到对应材质子文件夹。
 *
 * 步骤：
 * 1. 清空 assets/blocks 下所有材质子文件夹（brick/ cloud/ dirt/ ...）内的文件，保留空文件夹
 * 2. 扫描 云汲仙田录/ 中的 PNG 文件，解析材质名 → 复制到对应子文件夹并统一命名
 *
 * 命名格式：{material}_{3位序号}_{face}.png
 * 排序规则：场景（青竹谷→落霞山脉→幽暗密林→特殊方块）→ v1→v2 → left→right→top
 *
 * @module tools/reorg_blocks_from_yunji
 */

import { writeFileSync } from 'node:fs';
import { readdir, copyFile, mkdir, unlink, stat } from 'node:fs/promises';
import { join, basename, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ==================== 配置 ====================

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BLOCKS_DIR = join(ROOT, 'assets', 'blocks');
const YUNJI_DIR = join(BLOCKS_DIR, '云汲仙田录');

/** 材质类型 → 目标子文件夹名 */
const MATERIAL_FOLDERS = [
    'brick', 'cloud', 'dirt', 'farm', 'glow', 'grass', 'jade',
    'magma', 'plank', 'roof', 'sand', 'snow', 'stone', 'water'
];

/** 场景排序权重（用于决定多场景同一材质的文件顺序） */
const SCENE_ORDER = ['青竹谷', '落霞山脉', '幽暗密林', '特殊方块'];

/** 面排序权重 */
const FACE_ORDER = ['left', 'right', 'top'];

// ==================== 步骤 1：清空材质子文件夹 ====================

/**
 * 清空指定文件夹内的所有文件（保留子文件夹结构不变）。
 * @param {string} dirPath
 * @returns {Promise<number>} 删除的文件数
 */
async function clearFolder(dirPath) {
    let count = 0;
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isFile()) {
            await unlink(fullPath);
            count++;
        }
    }
    return count;
}

// ==================== 步骤 2：扫描与归类 ====================

/**
 * 解析文件名，提取材质名和面标识。
 * @param {string} filename - 例如 "block_dirt_left.png" 或 "block_dirt_left_v2.png"
 * @returns {{ material: string|null, face: string|null, version: number }}
 */
function parseFilename(filename) {
    const name = basename(filename, extname(filename)); // 去掉 .png
    // 格式: block_{material}_{face}(_v2)?
    const match = name.match(/^block_([a-z]+)_(left|right|top)(_v(\d+))?$/);
    if (!match) return { material: null, face: null, version: 0 };
    return {
        material: match[1],
        face: match[2],
        version: match[4] ? parseInt(match[4], 10) : 1
    };
}

/**
 * 递归扫描目录，收集所有符合命名规则的 PNG 文件信息。
 * @param {string} sceneDir - 场景目录路径
 * @param {string} sceneName - 场景名（用于排序）
 * @returns {Promise<Array<{ filePath: string, material: string, face: string, version: number, scene: string }>>}
 */
async function scanScene(sceneDir, sceneName) {
    const results = [];
    let entries;
    try {
        entries = await readdir(sceneDir, { withFileTypes: true });
    } catch {
        return results; // 目录不存在则跳过
    }

    for (const entry of entries) {
        if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.png') continue;
        const { material, face, version } = parseFilename(entry.name);
        if (!material || !face) {
            console.warn(`  ⚠️  跳过无法识别的文件: ${entry.name}`);
            continue;
        }
        results.push({
            filePath: join(sceneDir, entry.name),
            material,
            face,
            version,
            scene: sceneName
        });
    }
    return results;
}

/**
 * 生成排序键：场景权重 → v1 优先 → 面顺序 → v2 作为同面第二变体
 */
function sortKey(a) {
    const sceneIdx = SCENE_ORDER.indexOf(a.scene);
    const faceIdx = FACE_ORDER.indexOf(a.face);
    // 将 v1 和 v2 作为同一组内的顺序
    return `${String(sceneIdx).padStart(2, '0')}_${a.material}_${String(faceIdx).padStart(2, '0')}_v${a.version}`;
}

// ==================== 主流程 ====================

async function main() {
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║     云汲仙田录 → 材质文件夹 归类工具         ║');
    console.log('╚═══════════════════════════════════════════════╝');

    // ── 步骤 1：清空现有材质文件夹 ──
    console.log('\n📦 步骤 1/2：清空现有材质文件夹...');
    let totalCleared = 0;
    for (const folder of MATERIAL_FOLDERS) {
        const folderPath = join(BLOCKS_DIR, folder);
        try {
            await stat(folderPath); // 确保存在
            const cleared = await clearFolder(folderPath);
            if (cleared > 0) {
                console.log(`  ✅ ${folder}/ — 清除 ${cleared} 个文件`);
            } else {
                console.log(`  📁 ${folder}/ — 已是空文件夹`);
            }
            totalCleared += cleared;
        } catch {
            // 文件夹不存在则创建
            await mkdir(folderPath, { recursive: true });
            console.log(`  📁 ${folder}/ — 新建空文件夹`);
        }
    }
    console.log(`  🗑️  共清除 ${totalCleared} 个文件`);

    // ── 步骤 2：扫描云汲仙田录 ──
    console.log('\n📦 步骤 2/2：扫描 云汲仙田录 并归类...');

    /** @type {Array<{ filePath: string, material: string, face: string, version: number, scene: string }>} */
    const allFiles = [];

    // 扫描 4 个场景子文件夹
    for (const sceneName of SCENE_ORDER) {
        const scenePath = join(YUNJI_DIR, sceneName);
        const files = await scanScene(scenePath, sceneName);
        console.log(`  📂 ${sceneName}/ — 发现 ${files.length} 个文件`);
        allFiles.push(...files);
    }

    console.log(`\n  📊 总计 ${allFiles.length} 个有效文件`);

    // 按材质分组
    /** @type {Object<string, Array<typeof allFiles[0]>>} */
    const groups = {};
    for (const f of allFiles) {
        if (!groups[f.material]) groups[f.material] = [];
        groups[f.material].push(f);
    }

    // 对每组按排序键排序
    for (const material of Object.keys(groups)) {
        groups[material].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    }

    // ── 复制文件 ──
    let totalCopied = 0;
    const manifestEntries = [];

    for (const material of Object.keys(groups).sort()) {
        const files = groups[material];
        const targetDir = join(BLOCKS_DIR, material);

        // 确保目标文件夹存在
        await mkdir(targetDir, { recursive: true });

        let seq = 1;
        for (const f of files) {
            const seqStr = String(seq).padStart(3, '0');
            const newName = `${material}_${seqStr}_${f.face}.png`;
            const targetPath = join(targetDir, newName);

            await copyFile(f.filePath, targetPath);
            totalCopied++;

            manifestEntries.push({
                id: `${material}_${seqStr}_${f.face}`,
                source: f.filePath.replace(ROOT + '\\', '').replace(/\//g, '/'),
                target: `assets/blocks/${material}/${newName}`,
                scene: f.scene,
                version: f.version,
                face: f.face
            });

            console.log(`  📋 ${material}/ ${seqStr} ← ${f.scene}/${basename(f.filePath)}`);
            seq++;
        }
    }

    // ── 生成清单 ──
    const manifest = {
        generatedAt: new Date().toISOString(),
        summary: {
            totalScenes: SCENE_ORDER.length,
            totalFiles: allFiles.length,
            totalCopied: totalCopied,
            materialCount: Object.keys(groups).length
        },
        materialCounts: Object.fromEntries(
            Object.entries(groups).map(([m, files]) => [m, files.length])
        ),
        entries: manifestEntries
    };

    const manifestPath = join(BLOCKS_DIR, '_manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`\n  📄 清单已生成: assets/blocks/_manifest.json`);

    // ── 统计 ──
    console.log('\n╔═══════════════════════════════════════════════╗');
    console.log('║  归类完成                                    ║');
    console.log(`║  清除: ${totalCleared} 个旧文件                        ║`);
    console.log(`║  复制: ${totalCopied} 个新文件                        ║`);
    console.log(`║  材质: ${Object.keys(groups).length} 种                          ║`);
    console.log('╚═══════════════════════════════════════════════╝');
    console.log('\n各材质文件数:');
    for (const [mat, files] of Object.entries(groups).sort()) {
        const targetDir = join(BLOCKS_DIR, mat);
        const dirFiles = await readdir(targetDir);
        console.log(`  ${mat}/ → ${dirFiles.filter(f => f.endsWith('.png')).length} 个文件`);
    }
}

main().catch(err => {
    console.error('❌ 执行失败:', err);
    process.exit(1);
});
