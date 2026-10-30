/**
 * Seed the built-in showcase into the database.
 *
 * The front page rotates a fixed set of frames and clips that ship in public/showcase/.
 * It does not read that folder directly: recent-assets reads the asset table, filters by
 * filename against SHOWCASE_WIDE_ORDER / SHOWCASE_CLIP_ORDER, and requires the row to
 * belong to the 「首页展示」 project. Without these rows a fresh install shows the empty
 * state even though the files are sitting right there on disk.
 *
 * Idempotent: rows are matched on filename inside the curated project and refreshed in
 * place, so running it on every start costs one small query and never duplicates.
 *
 * Invoked from scripts/postinstall.mjs so a fresh install has content before first launch.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Mirrors SHOWCASE_WIDE_ORDER / SHOWCASE_CLIP_ORDER in src/core/showcase/curation.ts.
// Duplicated deliberately: this script runs before the TS toolchain is available, and
// the two lists are covered by curation.test.ts so drift shows up as a test failure.
const WIDE = [
  'abstract-liquid.png',
  'architecture.png',
  'cinematic-portrait.png',
  'film-nostalgia.png',
  'ink-landscape.png',
  'macro-nature.png',
  'neon-street.png',
  'product-still.png',
];
const CLIPS = [
  'concrete-shadow.mp4',
  'forest-mist.mp4',
  'ink-water.mp4',
  'desert-dusk.mp4',
  'neon-rain.mp4',
  'studio-still.mp4',
];

const PROJECT_NAME = '首页展示';
const SHOWCASE_DIR = join(ROOT, 'public', 'showcase');

const dataRoot = process.env.BEATDESIGN_DATA_DIR?.trim() || join(ROOT, 'data');
const dbPath = join(dataRoot, 'local.db');

if (!existsSync(SHOWCASE_DIR)) {
  console.log('  showcase-seed: public/showcase 不存在，跳过');
  process.exit(0);
}
if (!existsSync(dbPath)) {
  console.log('  showcase-seed: 数据库不存在，先跑 db push');
  process.exit(0);
}

const db = new DatabaseSync(dbPath);

// 表结构没建好就别硬写 —— 让 postinstall 先 push
const hasTables = db
  .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='asset'")
  .get();
if (!hasTables || hasTables.c === 0) {
  console.log('  showcase-seed: asset 表不存在，跳过');
  db.close();
  process.exit(0);
}

const now = Date.now();

// ── 项目：没有就建
let projectRow = db.prepare('SELECT id FROM project WHERE name = ?').get(PROJECT_NAME);
let projectId;
if (projectRow) {
  projectId = projectRow.id;
} else {
  projectId = `proj_showcase_builtin`;
  db.prepare(
    `INSERT INTO project (id, name, status, created_at, updated_at)
     VALUES (?, ?, 'active', ?, ?)`
  ).run(projectId, PROJECT_NAME, now, now);
  console.log('  showcase-seed: 创建项目「首页展示」');
}

const files = [...WIDE.map((n) => ({ name: n, type: 'image' })), ...CLIPS.map((n) => ({ name: n, type: 'video' }))];

let added = 0;
let skipped = 0;

for (const file of files) {
  const full = join(SHOWCASE_DIR, file.name);
  if (!existsSync(full)) {
    console.log(`  showcase-seed: 缺文件 ${file.name}`);
    skipped += 1;
    continue;
  }

  const existing = db
    .prepare(
      `SELECT a.id FROM asset a
       JOIN project_asset_membership m ON m.asset_id = a.id
       WHERE m.project_id = ? AND a.filename = ?`
    )
    .get(projectId, file.name);

  if (existing) {
    skipped += 1;
    continue;
  }

  const bytes = statSync(full).size;
  const sha = createHash('sha256').update(readFileSync(full)).digest('hex');
  const id = `asset_showcase_${file.name.replace(/[^a-z0-9]/gi, '_')}`;
  const mime = file.type === 'image' ? 'image/png' : 'video/mp4';

  db.prepare(
    `INSERT INTO asset
       (id, type, source, asset_class, storage_provider, object_key, public_url,
        filename, mime_type, size_bytes, sha256, origin_project_id, created_at, updated_at)
     VALUES (?, ?, 'builtin', 'showcase', 'static', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    file.type,
    file.name,
    `/showcase/${file.name}`,
    file.name,
    mime,
    bytes,
    sha,
    projectId,
    now,
    now
  );

  db.prepare(
    `INSERT INTO project_asset_membership
       (id, project_id, asset_id, category, created_at)
     VALUES (?, ?, ?, 'showcase', ?)`
  ).run(`mem_showcase_${file.name.replace(/[^a-z0-9]/gi, '_')}`, projectId, id, now);

  added += 1;
}

db.close();
console.log(`  showcase-seed: 新增 ${added} 个，已有 ${skipped} 个`);
