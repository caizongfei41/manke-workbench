/**
 * Subtitle cues for a finished film.
 *
 * H3 already sings the dialogue into the generated audio through `<d>` tags, but
 * nothing puts those lines on screen, and a short drama without subtitles is not
 * something you can publish. Timing comes from the per-shot durations, which are
 * the same numbers the graph rendered with.
 */

export type SubtitleCue = {
  /** Seconds from the start of the film. */
  start: number;
  end: number;
  text: string;
};

const MAX_LINE_CHARS = 22;

/** Pull spoken lines out of a shot prompt: `<d>[Chinese] 台词</d>`. */
export const extractDialogue = (prompt: string): string[] => {
  const out: string[] = [];
  const pattern = /<d>([\s\S]*?)<\/d>/g;
  let match = pattern.exec(prompt);
  while (match) {
    const raw = match[1] ?? '';
    // 语言标记不是台词
    const text = raw
      .replace(/^\s*\[[^\]]*\]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) out.push(text);
    match = pattern.exec(prompt);
  }
  return out;
};

/** Split a line that would not fit on one subtitle row. */
const wrapLine = (text: string): string => {
  if (text.length <= MAX_LINE_CHARS) return text;
  const rows: string[] = [];
  for (let i = 0; i < text.length; i += MAX_LINE_CHARS) {
    rows.push(text.slice(i, i + MAX_LINE_CHARS));
  }
  return rows.slice(0, 2).join('\\N');
};

/**
 * Build cues from the shots, in order.
 *
 * A shot with several lines divides its duration between them; a shot with no
 * dialogue contributes time but no cue.
 */
export const buildSubtitleCues = (
  shots: { prompt: string; seconds: number }[]
): SubtitleCue[] => {
  const cues: SubtitleCue[] = [];
  let cursor = 0;
  for (const shot of shots) {
    const duration = Number.isFinite(shot.seconds) && shot.seconds > 0 ? shot.seconds : 3;
    const lines = extractDialogue(shot.prompt ?? '');
    if (lines.length > 0) {
      const per = duration / lines.length;
      lines.forEach((line, index) => {
        // 留一点间隙，别让两条字幕首尾相接
        const start = cursor + index * per;
        const end = start + per * 0.92;
        cues.push({
          start: Number(start.toFixed(2)),
          end: Number(end.toFixed(2)),
          text: wrapLine(line),
        });
      });
    }
    cursor += duration;
  }
  return cues;
};

const assTime = (seconds: number) => {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.round((total - Math.floor(total)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

/**
 * ASS rather than SRT: styling is decided by the script, so burning needs no
 * font file path and no per-filter escaping.
 */
export const buildAssSubtitle = (
  cues: SubtitleCue[],
  options: {
    fontName?: string;
    fontPx?: number;
    marginBottom?: number;
    /** Must match the exported frame, or libass stretches the text. */
    playResX?: number;
    playResY?: number;
  } = {}
): string => {
  const fontName = options.fontName ?? 'Microsoft YaHei';
  const fontPx = options.fontPx ?? 42;
  const marginBottom = options.marginBottom ?? 48;
  const playResX = options.playResX ?? 1280;
  const playResY = options.playResY ?? 720;
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // 白字黑描边，底部居中：在任何画面上都能读
    `Style: Default,${fontName},${fontPx},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,40,40,${marginBottom},134`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = cues.map(
    (cue) =>
      `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${cue.text}`
  );
  return [...header, ...events, ''].join('\n');
};

/**
 * Export targets.
 *
 * The board renders 16:9, but a short drama is published vertical: 1080x1920 is
 * what Douyin and Kuaishou take. "cover" scales until the frame is filled and
 * then centre-crops, which keeps the picture edge to edge instead of adding bars.
 */
export type ExportPresetId = 'source' | 'vertical' | 'vertical720' | 'square' | 'landscape';

export const EXPORT_PRESETS: Record<
  ExportPresetId,
  { width: number; height: number; mode: 'none' | 'cover' }
> = {
  source: { width: 0, height: 0, mode: 'none' },
  vertical: { width: 1080, height: 1920, mode: 'cover' },
  vertical720: { width: 720, height: 1280, mode: 'cover' },
  square: { width: 1080, height: 1080, mode: 'cover' },
  landscape: { width: 1920, height: 1080, mode: 'cover' },
};

/** PlayRes for the subtitle track, so text is authored at the export size. */
export const presetPlayRes = (id: ExportPresetId | string | undefined) => {
  const preset = EXPORT_PRESETS[(id as ExportPresetId) ?? 'source'] ?? EXPORT_PRESETS.source;
  return preset.mode === 'none'
    ? { playResX: 1280, playResY: 720 }
    : { playResX: preset.width, playResY: preset.height };
};
