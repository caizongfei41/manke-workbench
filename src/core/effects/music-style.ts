/**
 * 音乐风格参数表。
 *
 * 取值必须与 `XB_YuE2StylePrompt` 节点的下拉项**逐字一致** —— 这个节点把选中的
 * 中文标签直接拼进提示词，传一个不存在的值不会报错，只是风格悄悄失效。所以这张
 * 表是从 ComfyUI 的 /object_info 抄下来的，改动前先对一遍。
 *
 * 放在 src/core：`src/components` 和 `src/routes` 有中文字面量限制（连注释都算），
 * 数据表和模型说明一样集中在这里。
 */

export type MusicStyleFieldType = 'select' | 'number' | 'text';

export type MusicStyleGroup = 'core' | 'voice' | 'arrange' | 'extra';

export type MusicStyleField = {
  /** 节点上的输入名，同时也是请求里 style 对象的键。 */
  key: string;
  label: string;
  type: MusicStyleFieldType;
  group: MusicStyleGroup;
  /** 下拉选项，type === 'select' 时有值。 */
  options?: readonly string[];
  default: string | number;
  min?: number;
  max?: number;
  step?: number;
  /** 简短说明，鼠标停留时显示。 */
  hint?: string;
};

const FOLLOW = '跟随风格 / Follow Style';
const UNSPECIFIED = '不指定 / Unspecified';

const STYLE_NAMES = [
  '华语流行 / Mandopop',
  '华语抒情摇滚 / Mandopop Rock Ballad',
  '粤语流行 / Cantopop',
  '城市流行 / City Pop',
  '英文流行 / English Pop',
  '民谣 / Folk',
  '国风民乐 / Chinese Folk New Age',
  '中国戏曲风 / Chinese Opera Fusion',
  '爵士 / Jazz',
  '摇摆大乐队 / Swing Big Band',
  '波萨诺瓦 / Bossa Nova',
  '灵魂乐 / Soul',
  '节奏布鲁斯 / R&B',
  '放克 / Funk',
  '摇滚 / Rock',
  '朋克 / Punk',
  '金属 / Metal',
  '电子舞曲 / EDM',
  '合成器浪潮 / Synthwave',
  '低保真嘻哈 / Lo-fi Hip-Hop',
  '嘻哈说唱 / Hip-Hop',
  '国风嘻哈 / Guofeng Trap',
  '日系动漫 / Anime J-Pop',
  '室内乐 / Chamber',
  '影视管弦 / Cinematic Orchestral',
  '治愈器乐 / Healing Instrumental',
  '儿童童谣 / Children\'s Song',
  '节日欢庆 / Festive Celebration',
  '热血战斗 / Battle Action',
  '安静田园 / Peaceful Pastoral',
  '悬疑紧张 / Suspense Tension',
  '悲伤回忆 / Tragic Memory',
] as const;

const INSTRUMENTS = [
  '钢琴 / Piano',
  '电钢琴 / Electric Piano',
  '管风琴 / Organ',
  '合成器 / Synthesizer',
  '弦乐组 / Strings',
  '小提琴 / Violin',
  '大提琴 / Cello',
  '竖琴 / Harp',
  '原声吉他 / Acoustic Guitar',
  '电吉他 / Electric Guitar',
  '失真吉他 / Distorted Guitar',
  '贝斯 / Bass',
  '低音提琴 / Upright Bass',
  '爵士鼓 / Drum Kit',
  '打击乐 / Percussion',
  '电子鼓机 / Drum Machine',
  '808 低频 / 808 Bass',
  '萨克斯 / Saxophone',
  '小号 / Trumpet',
  '铜管组 / Brass Section',
  '长笛 / Flute',
  '口琴 / Harmonica',
  '古筝 / Guzheng',
  '琵琶 / Pipa',
  '二胡 / Erhu',
  '笛子 / Dizi Flute',
  '中国鼓 / Chinese Drums',
  '战鼓 / War Drums',
  '三味线 / Shamisen',
  '尺八 / Shakuhachi',
  '马林巴 / Marimba',
  '钟琴 / Glockenspiel',
  '磁带噪底 / Tape Noise',
  '自然氛围 / Nature Ambience',
] as const;

export const MUSIC_STYLE_FIELDS: readonly MusicStyleField[] = [
  {
    key: '配方',
    label: '风格配方',
    type: 'select',
    group: 'core',
    default: '自定义 / Custom',
    hint: '一键套用一整套预设，选完下面各项会跟着变。',
    options: [
      '自定义 / Custom',
      '🎤 华语流行金曲 / Mandopop Ballad',
      '🌃 城市流行 / City Pop Night',
      '🇬🇧 英文流行 / English Pop',
      '🐉 国风民乐 / Chinese Folk New Age',
      '🎬 影视抒情 / Cinematic Ballad',
      '🎷 摇摆爵士 / Swing Big Band',
      '🙏 灵魂福音 / Gospel Soul',
      '⚡ 摇滚力量 / Rock Power Ballad',
      '🌙 深夜低保真 / Late-night Lo-fi',
      '🎹 治愈器乐 / Healing Instrumental',
      '🐲 国风嘻哈 / Guofeng Trap',
      '👫 男女对唱情歌 / Duet Love Ballad',
      '🗡️ 热血战斗 / Battle Action',
      '🌾 安静田园 / Peaceful Pastoral',
      '🕵️ 悬疑紧张 / Suspense Tension',
      '💧 悲伤回忆 / Tragic Memory',
    ],
  },
  {
    key: '演唱语言',
    label: '演唱语言',
    type: 'select',
    group: 'core',
    default: '中文 / Chinese',
    hint: '词是中文但选英文，唱出来会带英文口音。',
    options: [
      '中文 / Chinese',
      '英文 / English',
      '日文 / Japanese',
      '粤语 / Cantonese',
      '韩文 / Korean',
      '中英混合 / Chinese-English',
      '西班牙文 / Spanish',
      '法文 / French',
      '纯音乐 / Instrumental',
    ],
  },
  {
    key: '音乐风格',
    label: '音乐风格',
    type: 'select',
    group: 'core',
    default: '华语流行 / Mandopop',
    hint: '整首歌的主导风格。',
    options: STYLE_NAMES,
  },
  {
    key: '情绪氛围',
    label: '情绪氛围',
    type: 'select',
    group: 'core',
    default: UNSPECIFIED,
    hint: '决定编曲的张力和歌手的投入程度。',
    options: [
      UNSPECIFIED,
      '温暖治愈 / Warm Healing',
      '浪漫甜蜜 / Romantic Sweet',
      '忧郁感伤 / Melancholic',
      '燃爆热血 / Energetic Anthem',
      '神秘暗黑 / Dark Mysterious',
      '明亮清爽 / Bright Fresh',
      '复古怀旧 / Retro Nostalgic',
      '空灵冥想 / Ethereal Meditative',
      '慵懒放松 / Laid-back Chill',
      '宏大史诗 / Epic Cinematic',
      '调皮俏皮 / Playful Quirky',
      '坚定励志 / Determined Uplifting',
      '孤独深夜 / Late-night Lonely',
      '节日欢庆 / Festive Celebration',
      '梦幻漂移 / Dreamy Float',
      '紧张悬疑 / Tense Suspense',
    ],
  },
  {
    key: '速度',
    label: '速度档位',
    type: 'select',
    group: 'core',
    default: UNSPECIFIED,
    hint: '只看档位；填了下面的 BPM 数值就以数值为准。',
    options: [
      UNSPECIFIED,
      '慢 60-75 / Slow 60-75 BPM',
      '中慢 76-95 / Mid-Slow 76-95 BPM',
      '中速 96-108 / Mid 96-108 BPM',
      '中快 109-125 / Mid-Fast 109-125 BPM',
      '快 126-145 / Fast 126-145 BPM',
      '很快 146+ / Very Fast 146+ BPM',
    ],
  },
  {
    key: 'BPM数值',
    label: 'BPM 数值',
    type: 'number',
    group: 'core',
    default: 0,
    min: 0,
    max: 300,
    step: 1,
    hint: '0 表示按速度档位自动。想要准确tempo就填这里，例如 84。',
  },
  {
    key: '人声编制',
    label: '人声编制',
    type: 'select',
    group: 'voice',
    default: '女声独唱 / Female Lead',
    options: [
      '女声独唱 / Female Lead',
      '男声独唱 / Male Lead',
      '童声独唱 / Child Lead',
      '中性嗓音 / Androgynous Lead',
      '男女对唱 / Duet',
      '双女声对唱 / Female Duet',
      '合唱 / Choir',
      '伴唱垫底 / Backing Vocals',
      '无主唱 / No Vocals',
    ],
  },
  {
    key: '人声音色',
    label: '人声音色',
    type: 'select',
    group: 'voice',
    default: FOLLOW,
    options: [
      FOLLOW,
      '清亮 / Clear Bright',
      '温暖 / Warm',
      '气声 / Breathy',
      '沙哑 / Husky',
      '厚重 / Deep Rich',
      '空灵 / Ethereal Airy',
      '颗粒感 / Raspy',
      '柔滑 / Smooth',
      '清冷 / Cool Metallic',
    ],
  },
  {
    key: '人声唱法',
    label: '人声唱法',
    type: 'select',
    group: 'voice',
    default: FOLLOW,
    options: [
      FOLLOW,
      '流行通俗 / Pop Vocal',
      '咬字清晰 / Clear Diction',
      '慵懒后拍 / Behind-the-beat',
      '气声耳语 / Hushed Half-whispered',
      '美声 / Bel Canto',
      '假声 / Falsetto',
      '说唱 / Rap Flow',
      '民谣叙事 / Folk Storytelling',
      '高亢爆发 / Belted High Notes',
      '戏曲腔 / Operatic Folk Ornament',
    ],
  },
  {
    key: '人声效果',
    label: '人声效果',
    type: 'select',
    group: 'voice',
    default: FOLLOW,
    options: [
      FOLLOW,
      '无处理 / Dry (No FX)',
      '暖混响 / Warm Reverb',
      '磁带延迟 / Tape Delay',
      '回声 / Echo',
      '自动修音 / Auto-Tune',
      '双轨加厚 / Doubled Voice',
    ],
  },
  {
    key: '主奏乐器',
    label: '主奏乐器',
    type: 'select',
    group: 'arrange',
    default: FOLLOW,
    options: [FOLLOW, ...INSTRUMENTS],
  },
  {
    key: '辅助乐器',
    label: '辅助乐器',
    type: 'select',
    group: 'arrange',
    default: FOLLOW,
    options: [FOLLOW, '无 / None', ...INSTRUMENTS],
  },
  {
    key: '编曲密度',
    label: '编曲密度',
    type: 'select',
    group: 'arrange',
    default: FOLLOW,
    options: [
      FOLLOW,
      '极简留白 / Minimal',
      '标准 / Standard',
      '饱满丰富 / Full',
      '密集推进 / Dense Driving',
    ],
  },
  {
    key: '制作质感',
    label: '制作质感',
    type: 'select',
    group: 'arrange',
    default: FOLLOW,
    options: [
      FOLLOW,
      '干净数字 / Clean Digital',
      '温暖模拟 / Warm Analog',
      '磁带质感 / Tape Lo-fi',
      '黑胶质感 / Vinyl Warmth',
      '现场空间 / Live Room',
      '宽广开阔 / Wide Spacious',
      '贴身亲密 / Intimate Close',
    ],
  },
  {
    key: '风格融合',
    label: '风格融合',
    type: 'select',
    group: 'arrange',
    default: UNSPECIFIED,
    hint: '在主风格上再叠一层，例如华语流行 + 国风民乐。',
    options: [UNSPECIFIED, ...STYLE_NAMES],
  },
  {
    key: '音乐特征',
    label: '音乐特征',
    type: 'text',
    group: 'extra',
    default: '',
    hint: '补充几句形容，例如「副歌要有一段无伴奏清唱」。',
  },
  {
    key: '自定义补充',
    label: '自定义补充',
    type: 'text',
    group: 'extra',
    default: '',
    hint: '再加一层自由描述，会拼在风格提示词最后。',
  },
  {
    key: 'max_duration',
    label: '最长时长（秒）',
    type: 'number',
    group: 'extra',
    default: 120,
    min: 1,
    max: 900,
    step: 1,
    hint: '上限，不是目标值。实际长度由歌词段落和编曲决定。',
  },
] as const;

export const MUSIC_STYLE_GROUP_LABELS: Record<MusicStyleGroup, string> = {
  core: '风格与语言',
  voice: '人声',
  arrange: '编曲与乐器',
  extra: '高级',
};

/** 每个参数都用节点默认值起手，避免一进音乐模式就有一堆「不指定」。 */
export const getDefaultMusicStyle = (): Record<string, string | number> =>
  Object.fromEntries(
    MUSIC_STYLE_FIELDS.map((field) => [field.key, field.default])
  );

/**
 * 歌词结构模板。
 *
 * YuE2 靠 [Verse] / [Chorus] 这些标记切段落，不写标记它会把整段词当成一句念完。
 * 点「插入歌词模板」时把这段塞进输入框，用户只改内容就行。
 */
export const MUSIC_LYRICS_TEMPLATE = `[Intro]

[Verse 1]

[Pre-Chorus]

[Chorus]

[Verse 2]

[Chorus]

[Bridge]

[Outro]`;

/** 只有真正被用户改过的参数才发给后端，其余交给节点默认值。 */
export const pickChangedMusicStyle = (
  value: Record<string, string | number> | undefined
): Record<string, string | number> => {
  if (!value) return {};
  const defaults = getDefaultMusicStyle();
  const changed: Record<string, string | number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (defaults[key] !== item) changed[key] = item;
  }
  return changed;
};

export const MUSIC_STYLE_KEYS = new Set(
  MUSIC_STYLE_FIELDS.map((field) => field.key)
);
