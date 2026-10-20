import { readFileSync, writeFileSync } from 'node:fs';
const f = 'src/components/studio/studio-start-here.tsx';
const lines = readFileSync(f, 'utf8').split(/\r?\n/);
// 从能力带注释行一直替换到文件最后一行的 '}'
const start = lines.findIndex((l, i) => i > 340 && l.includes('What this machine can do'));
if (start < 0) { console.log('  ✗ 未找到起点'); process.exit(1); }
const lastBrace = lines.length - 1;
while (lastBrace > start && lines[lastBrace].trim() !== '}') { }
const block = [
  '      {/* What this machine can do, so the composer is not floating in space */}',
  '      <div className="mt-10 grid gap-3 sm:grid-cols-3" data-start-capabilities="true">',
  '        {[',
  "          { key: 'image', title: m['startHere.capability.image'](), body: m['startHere.capability.imageBody']() },",
  "          { key: 'video', title: m['startHere.capability.video'](), body: m['startHere.capability.videoBody']() },",
  "          { key: 'music', title: m['startHere.capability.music'](), body: m['startHere.capability.musicBody']() },",
  '        ].map((item) => (',
  '          <div',
  '            key={item.key}',
  '            className="rounded-[14px] border border-ink/[0.08] bg-[var(--beat-surface)]/60 px-4 py-3.5"',
  '          >',
  '            <p className="text-[13.5px] font-semibold text-[var(--beat-text-1)]">{item.title}</p>',
  '            <p className="mt-1 text-[13px] leading-6 text-[var(--beat-text-2)]">{item.body}</p>',
  '          </div>',
  '        ))}',
  '      </div>',
  '    </div>',
  '  );',
  '}',
];
lines.splice(start, lines.length - start, ...block);
writeFileSync(f, lines.join('\n'), 'utf8');
console.log('  ✓ 尾部已重写，共', lines.length, '行');
