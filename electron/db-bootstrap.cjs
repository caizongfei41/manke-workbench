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

  // drizzle 把迁移放在 migrations/sqlite/*.sql，但打包布局可能变，所以递归找。
  // 只认 .sql，meta/ 下的 snapshot JSON 忽略。
  let files = [];
  try {
    const walk = (dir) => {
      const out = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.name.endsWith('.sql')) out.push(full);
      }
      return out;
    };
    files = walk(migrationsDir).sort();
  } catch {
    return { ok: false, applied: 0, skipped: 0, message: `迁移目录不存在：${migrationsDir}` };
  }
  if (files.length === 0) {
    return { ok: false, applied: 0, skipped: 0, message: `没有迁移 SQL：${migrationsDir}` };
  }

  const db = new DatabaseSync(dbPath);
  let applied = 0;
  let skipped = 0;

  // 迁移文件里用 `--> statement-breakpoint` 分隔语句
  for (const full of files) {
    let sql = '';
    try {
      sql = fs.readFileSync(full, 'utf8');
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

/**
 * 给还没有封面的项目补一张。
 *
 * 项目卡片的封面读 project.cover_asset_id，但直到最近才有人写这个字段 ——
 * 之前所有项目的封面都是空白占位图。新建项目从今往后会自动设，可历史项目
 * 得补一次，否则用户升级后看到的还是一排空卡片。
 *
 * 取每个项目最新的一张图片，只补空着的，不覆盖已有封面。
 */
const backfillProjectCovers = (dataDir) => {
  const dbPath = path.join(dataDir, 'local.db');
  if (!fs.existsSync(dbPath)) return { ok: false, patched: 0, message: '数据库不存在' };

  let db;
  try {
    db = new DatabaseSync(dbPath);
  } catch (e) {
    return { ok: false, patched: 0, message: String(e && e.message) };
  }

  let patched = 0;
  try {
    const projects = db
      .prepare(
        `SELECT id FROM project
         WHERE status = 'active' AND (cover_asset_id IS NULL OR cover_asset_id = '')`
      )
      .all();

    const pick = db.prepare(
      `SELECT a.id AS assetId
       FROM asset a
       WHERE a.type = 'image'
         AND a.deleted_at IS NULL
         AND a.public_url IS NOT NULL
         AND (
           a.origin_project_id = ?
           OR a.object_key LIKE ?
           OR EXISTS (
             SELECT 1 FROM project_asset_membership m
             WHERE m.asset_id = a.id AND m.project_id = ?
           )
         )
       ORDER BY a.created_at DESC
       LIMIT 1`
    );

    const update = db.prepare(
      `UPDATE project SET cover_asset_id = ?, updated_at = ? WHERE id = ?`
    );

    for (const row of projects) {
      const hit = pick.get(row.id, `${row.id}/%`, row.id);
      if (hit && hit.assetId) {
        update.run(hit.assetId, Date.now(), row.id);
        patched += 1;
      }
    }
  } catch (e) {
    db.close();
    return { ok: false, patched, message: String(e && e.message) };
  }

  db.close();
  return {
    ok: true,
    patched,
    message: patched > 0 ? `补了 ${patched} 个项目封面` : '项目封面已就绪',
  };
};

module.exports = { ensureSchema, seedShowcase, backfillProjectCovers };
