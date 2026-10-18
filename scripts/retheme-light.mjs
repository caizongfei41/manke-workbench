// 只在 html[data-theme='light'] 块内改 token，避免误伤深色块
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'C:/Users/Administrator/Desktop/ComfyUI无线画布/src/styles/globals.css';
const text = readFileSync(FILE, 'utf8');

const blockStart = text.indexOf("html[data-theme='light'] {");
if (blockStart < 0) {
  console.error('找不到浅色块');
  process.exit(1);
}
// 块结束：从起始大括号开始配平
let depth = 0;
let blockEnd = -1;
for (let i = text.indexOf('{', blockStart); i < text.length; i += 1) {
  if (text[i] === '{') depth += 1;
  else if (text[i] === '}') {
    depth -= 1;
    if (depth === 0) { blockEnd = i; break; }
  }
}
if (blockEnd < 0) {
  console.error('浅色块未闭合');
  process.exit(1);
}

let block = text.slice(blockStart, blockEnd + 1);
const applied = [];
const missed = [];

const swap = (from, to, label) => {
  if (!block.includes(from)) { missed.push(label); return; }
  block = block.split(from).join(to);
  applied.push(label);
};

// ── 基础色：暖中性纸感 ──
swap('--beat-bg: #f6f6f7;', '--beat-bg: #f7f5f1;', 'bg');
swap('--beat-text-1: #18181b;', '--beat-text-1: #17150f;', 'text-1');
swap('--beat-text-2: #52525b;', '--beat-text-2: #57534a;', 'text-2');
swap('--beat-text-3: #8b8b94;', '--beat-text-3: #8b867a;', 'text-3');
swap('--beat-surface-2: #fbfbfc;', '--beat-surface-2: #fdfcfa;', 'surface-2');
swap('--beat-control: #f4f4f5;', '--beat-control: #f2efe9;', 'control');
swap('--beat-border: rgba(9, 9, 11, 0.1);', '--beat-border: rgba(23, 21, 15, 0.09);', 'border');
swap('--beat-border-strong: rgba(9, 9, 11, 0.18);', '--beat-border-strong: rgba(23, 21, 15, 0.17);', 'border-strong');

// ── 主色：墨黑（白底上的黑块才是高端质感） ──
swap('--beat-accent: #0284c7;', '--beat-accent: #1a1815;', 'accent');
swap('--beat-accent-hover: #0369a1;', '--beat-accent-hover: #2b2822;', 'accent-hover');

// ── 卡片与面板 ──
swap(
  '--beat-card: linear-gradient(145deg, #ffffff, #f4f4f5);',
  '--beat-card: linear-gradient(145deg, #ffffff, #faf8f4);',
  'card'
);
swap('--beat-panel: rgba(9, 9, 11, 0.035);', '--beat-panel: rgba(23, 21, 15, 0.032);', 'panel');
swap('--beat-panel-2: rgba(9, 9, 11, 0.025);', '--beat-panel-2: rgba(23, 21, 15, 0.022);', 'panel-2');
swap('--beat-dot: rgba(9, 9, 11, 0.14);', '--beat-dot: rgba(23, 21, 15, 0.1);', 'dot');
swap('--beatcanvas-grid-dot: rgba(9, 9, 11, 0.22);', '--beatcanvas-grid-dot: rgba(23, 21, 15, 0.15);', 'grid-dot');

// ── 整段替掉蓝色大光晕 ──
const washStart = block.indexOf('--beat-wash:');
if (washStart >= 0) {
  const washEnd = block.indexOf(';', block.indexOf('linear-gradient(180deg', washStart)) + 1;
  const next = `--beat-wash: radial-gradient(
      ellipse 120% 58% at 50% 0%,
      rgba(255, 251, 242, 0.95),
      transparent 64%
    ),
    linear-gradient(180deg, #fdfcfa 0%, #f7f5f1 55%, #f7f5f1 100%);`;
  block = block.slice(0, washStart) + next + block.slice(washEnd);
  applied.push('wash');
} else {
  missed.push('wash');
}

// ── 追加：次级强调 + 暖调阴影（只在没有时加） ──
if (!block.includes('--beat-shadow-md')) {
  const anchor = '--beat-accent-ink: #ffffff;';
  const extra = `${anchor}

  /* 次级强调：低饱和钢蓝，只用于焦点环与链接 */
  --beat-link: #1f4e79;
  --beat-focus: rgba(31, 78, 121, 0.42);

  /* 阴影带暖调：纯黑阴影落在暖底上会发脏 */
  --beat-shadow-sm: 0 1px 2px rgba(23, 21, 15, 0.06), 0 1px 1px rgba(23, 21, 15, 0.04);
  --beat-shadow-md: 0 8px 24px rgba(23, 21, 15, 0.08), 0 2px 6px rgba(23, 21, 15, 0.05);
  --beat-shadow-lg: 0 24px 64px rgba(23, 21, 15, 0.12), 0 8px 20px rgba(23, 21, 15, 0.06);`;
  block = block.split(anchor).join(extra);
  applied.push('shadow-tokens');
} else {
  applied.push('shadow-tokens(已存在)');
}

// ── body 背景跟着换（这是绿色偏色的来源） ──
const out = text.slice(0, blockStart) + block + text.slice(blockEnd + 1);
let final = out;
const bodySwaps = [
  ['--background: #f5f6f3;', '--background: #f7f5f1;'],
  ['--foreground: #171814;', '--foreground: #17150f;'],
];
for (const [from, to] of bodySwaps) {
  if (final.includes(from)) { final = final.split(from).join(to); applied.push(from); }
  else missed.push(from);
}

writeFileSync(FILE, final, 'utf8');
console.log('  已应用:', applied.join(', '));
if (missed.length) console.log('  未命中:', missed.join(' | '));
console.log('  块内行数:', block.split('\n').length, ' 文件总行数:', final.split('\n').length);
