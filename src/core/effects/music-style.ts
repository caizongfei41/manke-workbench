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
    key: 'seed',
    label: '随机种子',
    type: 'number',
    group: 'extra',
    default: 0,
    min: 0,
    max: 9007199254740991,
    step: 1,
    hint: '同参数下换种子会出不同的编曲和唱法。0 表示每次用模板固定值。',
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

/** 每个分组一句话说明，显示在标签页右侧。 */
export const MUSIC_GROUP_BLURB: Record<MusicStyleGroup, string> = {
  core: '定基调：风格、语言、情绪、速度',
  voice: '谁在唱、用什么音色和唱法',
  arrange: '乐器编制、编曲密度、制作质感',
  extra: '自由补充与时长上限',
};

const CUSTOM_RECIPE = '自定义 / Custom';

/**
 * 配方会覆盖哪些字段。
 *
 * XB_YuE2StylePrompt 的 _apply_recipe() 在「配方 != 自定义」时用预设值覆盖同名
 * 参数，而且是后端覆盖，前端显示的值会被无声丢弃 —— 用户以为自己选了男声，
 * 实际按预设唱成女声。这里复刻同一份覆盖清单，界面据此把被压掉的控件标出来。
 *
 * 不在清单里的字段（音乐特征 / 自定义补充 / max_duration / seed）任何时候都生效。
 */
export const MUSIC_RECIPE_OVERRIDDEN_KEYS: ReadonlySet<string> = new Set([
  '演唱语言',
  '音乐风格',
  '风格融合',
  '人声编制',
  '人声音色',
  '人声唱法',
  '人声效果',
  '速度',
  'BPM数值',
  '情绪氛围',
  '主奏乐器',
  '辅助乐器',
  '编曲密度',
  '制作质感',
]);

/** 当前是否选中了会覆盖参数的配方。 */
export const isRecipeActive = (
  value: Record<string, string | number> | undefined
): boolean => {
  const recipe = value?.['配方'];
  return typeof recipe === 'string' && recipe !== CUSTOM_RECIPE;
};

/** 某个字段此刻是否被配方压掉（界面显示为只读/置灰）。 */
export const isFieldLockedByRecipe = (
  value: Record<string, string | number> | undefined,
  key: string
): boolean => isRecipeActive(value) && MUSIC_RECIPE_OVERRIDDEN_KEYS.has(key);

/** 每个参数都用节点默认值起手，避免一进音乐模式就有一堆「不指定」。 */
export const getDefaultMusicStyle = (): Record<string, string | number> =>
  Object.fromEntries(
    MUSIC_STYLE_FIELDS.map((field) => [field.key, field.default])
  );

/**
 * 歌词模板（工作流自带的《下辈子再做你的新娘》）。
 *
 * YuE2 靠 [Verse] / [Chorus] 这些标记切段落，不写标记它会把整段词当成一句念完。
 * 点「插入歌词模板」把这首塞进输入框，用户按同样结构改词就行；`###` 开头的标题行
 * 是被节点保留的曲名分隔，别删。
 */
export const MUSIC_LYRICS_TEMPLATE = `### 《下辈子再做你的新娘》

[Intro]
呜 呜 呜

[Verse]
指尖揉散 你肩上风霜
钟摆滴答 催促相聚时光
你望着我
轻轻问能否地久天长

[Interlude]

[Verse]
可是哥啊 听我一句劝
别再来这地方

你掌心岁月磨出的老茧
让我心伤

若是心底还闷得慌
想找个人说说话

就点最简的单
我照样把你 当作至亲一般

[Pre-Chorus]
别把血汗钱 耗在短暂相逢
前路还有安稳 值得你去等

[Chorus]
把钱好好攒着吧
找个清清白白的好姑娘
平平淡淡 才是好时光
我给不起 承诺和远方

今生这条路 早已落尘
只能陪你相遇一场

等轮回一转 换个人间
那时我一身清白 等你来我身旁
只要你还认得我 只要你还记得我

[Pre-Chorus]
要把好时光 用在真心良人
前途还有月光 值得你相逢

[Chorus]
把心好好收着吧
那个清清白白的好姑娘
安安稳稳 才是好模样
我给不起 承诺和远方

今生这条路 早已落尘
相遇已是恩泽一场

等轮回一转 换个人间
那时我一身清白 等你来我身旁
只要你还认得我 只要你还记得我

[Bridge]
今生无缘 何需誓言
倾尽温柔 仍藏遗憾
相遇深情 深种心田
只盼来生 坦荡相见

[Outro]
只要你还认得我
下辈子
我要做你的新娘

只要你还记得我
下辈子
我就是你的新娘`;

/** 空结构骨架，给想从零写词的情况。 */
export const MUSIC_LYRICS_SKELETON = `[Intro]

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

/**
 * 歌词示例。
 *
 * 空骨架说明了结构，但没说清「每段写多少字、怎么断句」。给几首完整示例，用户照着
 * 改比从零写快得多。都是原创歌词，直接可用。
 */
export type MusicLyricsExample = {
  id: string;
  label: string;
  /** 配套的风格建议，插入示例时顺手把风格切过去。 */
  styleHint?: { 音乐风格: string; 情绪氛围: string; 人声编制: string };
  text: string;
};

export const MUSIC_LYRICS_EXAMPLES: readonly MusicLyricsExample[] = [
  {
    id: 'template',
    label: '下辈子再做你的新娘',
    styleHint: {
      音乐风格: '华语流行 / Mandopop',
      情绪氛围: '忧郁感伤 / Melancholic',
      人声编制: '女声独唱 / Female Lead',
    },
    text: MUSIC_LYRICS_TEMPLATE,
  },
  {
    id: 'skeleton',
    label: '空结构骨架',
    text: MUSIC_LYRICS_SKELETON,
  },
  {
    id: 'mandopop',
    label: '华语抒情',
    styleHint: {
      音乐风格: '华语流行 / Mandopop',
      情绪氛围: '忧郁感伤 / Melancholic',
      人声编制: '女声独唱 / Female Lead',
    },
    text: `[Intro]
钢琴独奏

[Verse 1]
窗外的雨 落在旧台阶
你留下的伞 还挂在门后
我数着秒针 走过整个下午
想着那天 你没说出口的话

[Pre-Chorus]
是不是所有告别
都藏在平常的问候里

[Chorus]
我把思念折成纸船
放进夜里最深的河
让它飘到你说过的远方
替我告诉你 我还在等

[Verse 2]
街角的花 开了又谢
我们走过的路 换了招牌
只有那家小店 还放着老歌
唱着我们没唱完的段落

[Chorus]
我把思念折成纸船
放进夜里最深的河
让它飘到你说过的远方
替我告诉你 我还在等

[Bridge]
如果时间能倒回那一站
我一定把话说得更慢
让你听清 每一句都是真的

[Outro]
窗外的雨 停了`,
  },
  {
    id: 'rock',
    label: '摇滚热血',
    styleHint: {
      音乐风格: '摇滚 / Rock',
      情绪氛围: '燃爆热血 / Energetic Anthem',
      人声编制: '男声独唱 / Male Lead',
    },
    text: `[Intro]
失真吉他 riff

[Verse 1]
闹钟砸碎凌晨六点
人群推着我往前走
他们把梦装进口袋
标好价钱 说这就够了

[Pre-Chorus]
可我听见胸口的声音
比整个城市更响

[Chorus]
我不认这条写好的路
也不认谁替我定输赢
就算只剩一盏灯
我也要把它点成太阳

[Verse 2]
摔过多少次才算数
伤口是地图 不是终点
他们笑我太吵太倔
那就再吵一点

[Chorus]
我不认这条写好的路
也不认谁替我定输赢
就算只剩一盏灯
我也要把它点成太阳

[Bridge]
喊到嗓子沙哑
也要喊出自己的名字

[Outro]
吉他 solo 渐弱`,
  },
  {
    id: 'folk',
    label: '民谣叙事',
    styleHint: {
      音乐风格: '民谣 / Folk',
      情绪氛围: '孤独深夜 / Late-night Lonely',
      人声编制: '男声独唱 / Male Lead',
    },
    text: `[Intro]
木吉他分解和弦

[Verse 1]
十八岁那年 我坐上绿皮车
口袋里装着 母亲煮的鸡蛋
她说外面的世界 很大很冷
记得冷了 就给自己添件衣裳

[Verse 2]
我在南方的工地 搬了三年砖
在夜市里 卖过两个月的唱
房东收走房租 也收走我的梦
我就到天台上 把它们捡回来

[Chorus]
列车一直往前开
我也一直往前开
身后的站台 越来越远
可我总听见 有人在喊我

[Bridge]
如果有一天 我回到那条街
我会告诉十八岁的自己
你走的路 没有走错

[Outro]
木吉他 渐弱`,
  },
];

/**
 * 一行摘要，显示在面板顶上。
 *
 * 只挑用户最可能想确认的三项，跳过「不指定 / 跟随风格」，否则摘要永远是一串默认值。
 */
export const summarizeMusicStyle = (
  value: Record<string, string | number> | undefined
): string => {
  if (!value) return '';
  const short = (raw: unknown) =>
    typeof raw === 'string' ? raw.split(' / ')[0].trim() : '';
  const skip = new Set(['不指定', '跟随风格', '自定义', '']);
  const parts = [
    short(value['音乐风格']),
    short(value['人声编制']),
    short(value['情绪氛围']),
  ].filter((item) => !skip.has(item));
  return parts.join(' · ');
};
