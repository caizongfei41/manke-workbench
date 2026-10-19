import type { DramaDocument } from './drama-document';
import { extractDialogue } from './subtitles';

/**
 * The shot list as a spreadsheet, because a producer asking for the board should not
 * receive a screenshot.
 *
 * CSV rather than XLSX: no new dependency, opens in Excel and Numbers, and a BOM makes
 * Excel read Chinese header text correctly instead of mojibake.
 */

const csvCell = (value: string | number | null | undefined) => {
  const text = value === null || value === undefined ? '' : String(value);
  // Quote every cell: prompts contain commas, quotes and newlines by nature.
  return `"${text.replace(/"/g, '""')}"`;
};

export const toCsv = (rows: (string | number | null | undefined)[][]) =>
  rows.map((row) => row.map(csvCell).join(',')).join('\r\n');

/** The prompt an editor should see: spoken lines without the markup. */
const plainPrompt = (prompt: string) =>
  prompt
    .replace(/<d>([\s\S]*?)<\/d>/g, (_match, inner: string) =>
      inner.replace(/^\s*\[[^\]]*\]\s*/, '').trim()
    )
    .replace(/<\/?d>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const buildShotListCsv = (drama: DramaDocument) => {
  const assetName = (id: string) =>
    (drama.publicAssets ?? []).find((asset) => asset.id === id)?.name ?? '';

  const header = [
    '段号',
    '秒数',
    '状态',
    '提示词',
    '台词',
    '角色 / 场景 / 道具',
    '参考图',
    '视频地址',
  ];

  const rows = (drama.shots ?? []).map((shot, index) => {
    const dialogue = extractDialogue(shot.prompt ?? '').join(' / ');
    const assets = (shot.publicAssetIds ?? []).map(assetName).filter(Boolean).join(' / ');
    const refs = (shot.ownImageUrls ?? []).length + (shot.publicAssetIds ?? []).length;
    return [
      index + 1,
      shot.seconds ?? '',
      shot.status ?? '',
      plainPrompt(shot.prompt ?? ''),
      dialogue,
      assets,
      refs,
      shot.videoUrl ?? '',
    ];
  });

  const totalSeconds = (drama.shots ?? []).reduce((sum, shot) => sum + (shot.seconds ?? 0), 0);
  const summary: (string | number)[][] = [
    [],
    ['合计', totalSeconds, '', '', '', '', '', ''],
    ['成片地址', drama.finalVideoUrl ?? '', '', '', '', '', '', ''],
  ];

  return '\uFEFF' + toCsv([header, ...rows, ...summary]);
};
