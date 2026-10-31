// 建表：把打包时带上的迁移 SQL 在用户数据目录里执行一遍。
//
// 为什么不用 drizzle-kit：那是构建期工具，依赖整套 TypeScript，装进桌面程序
// 体积翻倍。迁移产物是一堆 CREATE TABLE，直接喂给数据库就行。
//
// 为什么用 node:sqlite：Electron 35 内置 Node 22.16，这个模块从 22.5 起可用。
// 同步 API，不需要 await，比走 @libsql/client 少一层依赖 —— 那个包的原生绑定
// 只随服务端产物走，主进程拿不到。
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/**
 * @param {string} dataDir        用户数据目录
 * @param {string} migrationsDir  打包进来的迁移 SQL 目录
 */
const ensureSchema = (dataDir, migrationsDir) => {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'local.db');

  let files = [];
  try {
    files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    return { ok: false, applied: 0, skipped: 0, message: `迁移目录不存在：${migrationsDir}` };
  }
  if (files.length === 0) {
    return { ok: false, applied: 0, skipped: 0, message: '没有迁移 SQL' };
  }

  const db = new DatabaseSync(dbPath);
  let applied = 0;
  let skipped = 0;

  // 迁移文件里用 `--> statement-breakpoint` 分隔语句
  for (const rel of files) {
    let sql = '';
    try {
      sql = fs.readFileSync(path.join(migrationsDir, rel), 'utf8');
    } catch {
      continue;
    }
    for (const raw of sql.split('--> statement-breakpoint')) {
      const stmt = raw.replace(/--.*$/gm, '').trim();
      if (!stmt) continue;
      try {
        db.exec(stmt);
        applied += 1;
      } catch {
        // 已存在 / 重复列 —— 幂等重跑的正常结果
        skipped += 1;
      }
    }
  }

  let hasAsset = false;
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='asset'")
      .get();
    hasAsset = Number(row?.c ?? 0) > 0;
  } catch {
    hasAsset = false;
  }
  db.close();

  return {
    ok: hasAsset,
    applied,
    skipped,
    message: hasAsset
      ? `建表完成（执行 ${applied} 条，跳过 ${skipped} 条）`
      : '建表失败：asset 表缺失',
  };
};

/**
 * 把展示素材写进数据库。
 *
 * 与 scripts/seed-showcase.mjs 同逻辑，但去掉 TypeScript 依赖 —— 运行时只有
 * 编译好的 .cjs。
 */
const seedShowcase = (dataDir, publicDir) => {
  const dbPath = path.join(dataDir, 'local.db');
  if (!fs.existsSync(dbPath)) return { ok: false, added: 0, message: '数据库不存在' };

  const SHOWCASE = path.join(publicDir, 'showcase');
  if (!fs.existsSync(SHOWCASE)) return { ok: true, added: 0, message: '没有展示素材目录' };

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

  const db = new DatabaseSync(dbPath);
  const now = Date.now();
  let added = 0;

  try {
    const existingProject = db.prepare('SELECT id FROM project WHERE name = ?').get(PROJECT_NAME);
    let projectId = existingProject?.id;
    if (!projectId) {
      projectId = 'proj_showcase_builtin';
      db.prepare(
        `INSERT INTO project (id, name, status, created_at, updated_at)
         VALUES (?, ?, 'active', ?, ?)`
      ).run(projectId, PROJECT_NAME, now, now);
    }

    const items = [
      ...WIDE.map((n) => ({ name: n, type: 'image' })),
      ...CLIPS.map((n) => ({ name: n, type: 'video' })),
    ];

    for (const item of items) {
      const full = path.join(SHOWCASE, item.name);
      if (!fs.existsSync(full)) continue;

      const existing = db
        .prepare(
          `SELECT a.id FROM asset a
           JOIN project_asset_membership m ON m.asset_id = a.id
           WHERE m.project_id = ? AND a.filename = ?`
        )
        .get(projectId, item.name);
      if (existing) continue;

      const size = fs.statSync(full).size;
      const id = `asset_showcase_${item.name.replace(/[^a-z0-9]/gi, '_')}`;
      const mime = item.type === 'image' ? 'image/png' : 'video/mp4';

      db.prepare(
        `INSERT INTO asset
           (id, type, source, asset_class, storage_provider, object_key, public_url,
            filename, mime_type, size_bytes, origin_project_id, created_at, updated_at)
         VALUES (?, ?, 'builtin', 'showcase', 'static', ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        item.type,
        item.name,
        `/showcase/${item.name}`,
        item.name,
        mime,
        size,
        projectId,
        now,
        now
      );

      db.prepare(
        `INSERT INTO project_asset_membership (id, project_id, asset_id, category, created_at)
         VALUES (?, ?, ?, 'showcase', ?)`
      ).run(`mem_showcase_${item.name.replace(/[^a-z0-9]/gi, '_')}`, projectId, id, now);

      added += 1;
    }
  } catch (e) {
    db.close();
    return { ok: false, added, message: String(e && e.message) };
  }

  db.close();
  return { ok: true, added, message: added > 0 ? `新增 ${added} 个展示素材` : '展示素材已就绪' };
};

module.exports = { ensureSchema, seedShowcase };
