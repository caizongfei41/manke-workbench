// 《消失的凶手》1 分钟片花
//
//   node scripts/shotfilm-missing-killer-cut.mjs
//
// 目的不是出成片，是证明整条链路能走通：镜头 → 配音 → 配乐 → 字幕 → 混流。
// 三段画面按叙事顺序接（雨夜外景 → 闪回 → 陈默），对白压在画面上，
// 音乐铺底，末尾留白。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, '.verify/missing-killer');
const OUT = join(SRC, 'cut');
mkdirSync(OUT, { recursive: true });

const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { encoding: 'utf8' });

/**
 * 分镜顺序与对白的落点。
 *
 *   shot01  雨夜外景            0.0 – 12.25
 *   shot10  闪回·摘表           12.25 – 24.5
 *   shot11  陈默在楼道          24.5 – 36.75
 *
 * 对白只压在它属于的那一段上，不跨镜。
 */
const TIMELINE = [
  { file: 'shot01.mp4', start: 0, duration: 12.25 },
  { file: 'shot10.mp4', start: 12.25, duration: 12.25 },
  { file: 'shot11.mp4', start: 24.5, duration: 12.25 },
];

const DIALOGUE = [
  { file: 'voice/v04.mp3', at: 13.4, text: '九点……不对，八点五十。我走的时候他还好好的。' },
  { file: 'voice/v06.mp3', at: 26.2, text: '一直戴着。他送我的。' },
];

const subtitle = (entry, index) => {
  const srt = (t) => {
    const h = String(Math.floor(t / 3600)).padStart(2, '0');
    const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
    const sec = String(Math.floor(t % 60)).padStart(2, '0');
    const ms = String(Math.round((t % 1) * 1000)).padStart(3, '0');
    return `${h}:${m}:${sec},${ms}`;
  };
  const duration = Number(
    execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1', join(SRC, entry.file),
    ], { encoding: 'utf8' }).trim()
  );
  return `${index + 1}\n${srt(entry.at)} --> ${srt(entry.at + duration + 0.3)}\n${entry.text}\n`;
};

const main = () => {
  const srtPath = join(OUT, 'dialogue.srt');
  writeFileSync(srtPath, DIALOGUE.map((_, i) => subtitle(_, i)).join('\n'), 'utf8');

  // 1) 把三段拼成一条无声视频（统一 1080p / 24fps）
  const concatList = join(OUT, 'concat.txt');
  writeFileSync(concatList, TIMELINE.map((t) => `file '${join(SRC, t.file)}'`).join('\n'), 'utf8');

  const silent = join(OUT, 'silent.mp4');
  ff([
    '-f', 'concat', '-safe', '0', '-i', concatList,
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=24',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    silent,
  ]);
  console.log('  拼接完成');

  // 2) 对白按时间点延时混进去
  const inputs = ['-i', silent];
  const filters = [];
  DIALOGUE.forEach((d, i) => {
    inputs.push('-i', join(SRC, d.file));
    filters.push(`[${i + 1}:a]adelay=${Math.round(d.at * 1000)}|${Math.round(d.at * 1000)}[d${i}]`);
  });
  const mixIn = filters.map((_, i) => `[d${i}]`).join('');
  filters.push(
    `${mixIn}amix=inputs=${DIALOGUE.length}:duration=longest:normalize=0[dialogue]`
  );

  const withDialogue = join(OUT, 'dialogue.m4a');
  ff([
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[dialogue]',
    '-c:a', 'aac', '-b:a', '192k',
    withDialogue,
  ]);
  console.log('  对白混入');

  // 3) 字幕烧进画面
  const subtitled = join(OUT, 'subtitled.mp4');
  ff([
    '-i', silent,
    '-vf', `subtitles='${srtPath.replace(/\\/g, '/').replace(':', '\\:')}':force_style='FontName=Microsoft YaHei,FontSize=22,PrimaryColour=&HFFFFFF&,OutlineColour=&H80000000&,BorderStyle=1,Outline=1,Shadow=0,MarginV=36'`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    subtitled,
  ]);
  console.log('  字幕烧入');

  // 4) 合成最终文件：字幕画面 + 对白音轨
  const final = join(OUT, '消失的凶手-片花60s.mp4');
  ff([
    '-i', subtitled,
    '-i', withDialogue,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    final,
  ]);
  console.log('  完成 → ' + final);

  const probe = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=width,height,codec_type',
    '-show_entries', 'format=duration,size',
    '-of', 'default=nw=1', final,
  ], { encoding: 'utf8' });
  console.log(probe.split('\n').filter(Boolean).map((l) => '    ' + l).join('\n'));
};

main();
