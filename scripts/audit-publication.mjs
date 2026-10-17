// Pre-publish audit: report anything that must not reach a public repository.
//
// Works on the files git would actually commit, resolved through
// `git ls-files --others --exclude-standard`, so .gitignore decisions are
// respected rather than re-implemented here.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] ?? process.cwd();

const listTracked = () => {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  return out.split('\0').filter(Boolean);
};

const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|jsx|json|md|txt|ya?ml|toml|ps1|bat|cmd|py|sql|css|html|xml|example)$/i;

const PATTERNS = [
  { name: 'API keys / tokens', re: /sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private keys', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Hard-coded credentials', re: /(password|passwd|secret|token)\s*[:=]\s*["'][^"'\s]{8,}["']/i },
  { name: 'Personal Windows path', re: /C:\\Users\\[A-Za-z0-9._-]+\\/i },
  { name: 'Personal unix path', re: /\/Users\/[a-z0-9._-]+\/(Desktop|Documents|Downloads)/i },
  { name: 'Browser cookie / credential tooling', re: /Local State|encrypted_key|os_crypt|cookies\.sqlite/i },
];

// Known-safe matches, each with the reason it cannot be a real secret. Keeping
// these explicit means a new finding is always worth looking at.
const ALLOWLIST = [
  {
    file: 'scripts/audit-publication.mjs',
    why: 'this audit file contains the very patterns it searches for',
  },
  {
    file: /\.test\.tsx?$/,
    why: 'test fixtures use placeholder tokens such as "test-token"',
  },
  {
    file: 'scripts/start-e2e.mjs',
    why: 'local-only e2e header value, not a credential',
  },
];

const allowed = (rel, rule) =>
  ALLOWLIST.some(
    (a) =>
      (typeof a.file === 'string' ? a.file === rel : a.file.test(rel)) &&
      (a.rule ? a.rule === rule : true)
  );

const files = listTracked();
console.log(`待提交文件: ${files.length}\n`);

const findings = [];
const big = [];
for (const rel of files) {
  let st;
  try {
    st = statSync(join(ROOT, rel));
  } catch {
    continue;
  }
  if (st.size > 1024 * 1024) big.push([rel, st.size]);
  if (!TEXT_EXT.test(rel)) continue;

  let text;
  try {
    text = readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    continue;
  }
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    if (allowed(rel, p.name)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    findings.push({ rel, line, rule: p.name, sample: m[0].slice(0, 60) });
  }
}

console.log('== 敏感内容 ==');
if (!findings.length) console.log('  ✓ 未发现');
else for (const f of findings) console.log(`  ⚠ ${f.rel}:${f.line}  [${f.rule}]  ${f.sample}`);

console.log('\n== 大文件 (> 1 MB) ==');
if (!big.length) console.log('  ✓ 无');
else
  for (const [rel, size] of big.sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(`  ${(size / 1024 / 1024).toFixed(2)} MB  ${rel}`);

console.log('\n== 顶层目录分布 ==');
const byTop = {};
for (const rel of files) {
  const top = rel.includes('/') ? rel.split('/')[0] : '(root)';
  byTop[top] = (byTop[top] ?? 0) + 1;
}
for (const [k, v] of Object.entries(byTop).sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(v).padStart(4)}  ${k}`);

console.log(`\n结论: ${findings.length === 0 ? '可以发布' : `需要处理 ${findings.length} 处`}`);
