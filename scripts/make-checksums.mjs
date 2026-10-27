// 为部署包生成校验清单
//
//   node scripts/make-checksums.mjs --dir "D:\manke-big"
//
// 输出 校验清单.md，列出每个分卷的大小、SHA256（前 16 位）和总数，
// 外加解压步骤。用户下载后可以对着它核对，避免传到一半少一卷。
//
// 为什么只算前 16 位：完整 SHA256 对 34 GB 文件要跑几分钟，而前 16 位
// 已经足够发现传输截断（这是实际会发生的故障）。真要精确校验，
// 7z t 本身就会验证 CRC。
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const dir = resolve(valueOf('--dir') ?? 'D:\\manke-big');

/** 只读前 8 MB 算摘要：足够发现截断，又能秒级完成。 */
const quickHash = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file, { start: 0, end: 8 * 1024 * 1024 - 1 });
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex').slice(0, 16)));
    stream.on('error', reject);
  });

const human = (b) => {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  return `${(b / 1024 ** 2).toFixed(0)} MB`;
};

const main = async () => {
  const vols = readdirSync(dir)
    .filter((f) => /^manke-bundle\.7z\.\d+$/.test(f))
    .sort();

  if (vols.length === 0) {
    console.error(`  没有找到分卷：${dir}`);
    process.exit(1);
  }

  const rows = [];
  let total = 0;
  for (const name of vols) {
    const full = join(dir, name);
    const size = statSync(full).size;
    total += size;
    const hash = await quickHash(full);
    rows.push({ name, size, hash });
    console.log(`  ${name}  ${human(size)}  ${hash}`);
  }

  const md = [
    '# 漫客工作台 · 一键部署包校验清单',
    '',
    `- 分卷数量：**${vols.length}**`,
    `- 合计大小：**${human(total)}**`,
    `- 生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
    '',
    '## 分卷清单',
    '',
    '| 文件 | 大小 | 摘要（前 8 MB） |',
    '| --- | ---: | --- |',
    ...rows.map((r) => `| \`${r.name}\` | ${human(r.size)} | \`${r.hash}\` |`),
    '',
    '## 下载后核对',
    '',
    '所有分卷必须放在**同一个目录**，文件名保持原样（`.001`、`.002` …）。',
    '缺任何一卷都无法解压。',
    '',
    '```',
    '7z t manke-bundle.7z.001',
    '```',
    '',
    '看到 `Everything is Ok` 说明文件完整。',
    '',
    '## 解压',
    '',
    '只需要对第一个文件操作，7-Zip 会自动接续后面所有分卷：',
    '',
    '```',
    '7z x manke-bundle.7z.001 -o<目标目录>',
    '```',
    '',
    '解压后目录结构：',
    '',
    '```',
    '<目标目录>/manke/',
    '├── ComfyUI/          ComfyUI 0.42.0 + 便携 Python + 26 个模型 + 13 个节点包',
    '└── workbench/        漫客工作台源码',
    '```',
    '',
    '## 启动',
    '',
    '**用控制台的「ComfyUI 位置」指向解压出来的 `manke/ComfyUI`**，然后点全部启动。',
    '',
    '手动启动 ComfyUI（注意三点，缺一不可）：',
    '',
    '1. 工作目录必须是 `manke/ComfyUI`',
    '2. 设置 `PYTHONUTF8=1`（节点会打印 emoji，GBK 编码会崩）',
    '3. 用 `python_embeded\\python.exe`，不是系统 Python',
    '',
    '```',
    'cd <目标目录>\\manke\\ComfyUI',
    'set PYTHONUTF8=1',
    'python_embeded\\python.exe -X utf8 -s main.py --windows-standalone-build --disable-auto-launch',
    '```',
    '',
    '## 系统要求',
    '',
    '- 磁盘：解压后约 212 GB，建议预留 230 GB',
    '- 显存：NVIDIA 20 GB 以上（模型 203.9 GB，按需加载）',
    '- 内存：32 GB 以上',
    '',
  ].join('\n');

  const out = join(dir, '校验清单.md');
  writeFileSync(out, md, 'utf8');
  console.log('');
  console.log(`  已写入 ${out}`);
  console.log(`  ${vols.length} 卷 · ${human(total)}`);
};

await main();
