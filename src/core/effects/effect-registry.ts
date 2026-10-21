import {
  getGenerationModelBindingByEffectId,
  resolveProviderUpstreamModel,
} from '@/core/generation-providers/registry';

export type WorkspaceRegistryType = 'ai-video' | 'ai-image' | 'ai-audio';

type WorkspaceRegistryModelMode = 'quality' | 'fast' | 'lite';
type WorkspaceRegistryModelVariant = 'standard' | 'pro';
type WorkspaceRegistryDuration = `${number}s`;
type WorkspaceRegistryAspectRatio =
  | '16:9'
  | '21:9'
  | '4:3'
  | '5:4'
  | '9:16'
  | '9:21'
  | '3:4'
  | '1:1'
  | '1:2'
  | '2:1'
  | '1:3'
  | '3:1'
  | '2:3'
  | '3:2'
  | '4:5'
  | 'auto'
  | 'adaptive'
  | 'landscape'
  | 'portrait';
type WorkspaceRegistryQualityOption = 'standard' | 'high' | 'low' | 'medium';
type WorkspaceRegistryAudioSetting = 'auto' | 'origin';
type WorkspaceRegistryLanguage = 'zh' | 'en';
type WorkspaceRegistryOutputQuality =
  | '1k'
  | '2k'
  | '480p'
  | '720p'
  | '768p'
  | '1080p'
  | '4k'
  | 'std'
  | 'pro';
type WorkspaceRegistryReferenceType = 'image' | 'video';
export type WorkspaceRegistryBackgroundSource = 'input_image' | 'input_video';
export type WorkspaceRegistryCharacterOrientation = 'image' | 'video';

export type WorkspaceModelMode = WorkspaceRegistryModelMode;
export type WorkspaceModelVariant = WorkspaceRegistryModelVariant;
export type WorkspaceDuration = WorkspaceRegistryDuration;
export type WorkspaceAspectRatio = WorkspaceRegistryAspectRatio;
export type WorkspaceQualityOption = WorkspaceRegistryQualityOption;
export type WorkspaceAudioSetting = WorkspaceRegistryAudioSetting;
export type WorkspaceLanguage = WorkspaceRegistryLanguage;
export type WorkspaceOutputQuality = WorkspaceRegistryOutputQuality;

export type WorkspaceEffectRegistryAliasDefaults = {
  defaultMode?: WorkspaceRegistryModelMode;
  defaultVariant?: WorkspaceRegistryModelVariant;
};

export type WorkspaceEffectRegistryEntry = {
  id: string;
  name: string;
  /** 一句话说明这个模型能做什么，界面上作为悬浮注释显示。 */
  description?: string;
  workspaceType: WorkspaceRegistryType;
  routeSlug: string | null;
  routeAliases?: string[];
  routeOrder?: number;
  defaultMode?: WorkspaceRegistryModelMode;
  modeOptions?: WorkspaceRegistryModelMode[];
  defaultVariant?: WorkspaceRegistryModelVariant;
  variantOptions?: WorkspaceRegistryModelVariant[];
  defaultDuration?: WorkspaceRegistryDuration;
  supportedDurations?: WorkspaceRegistryDuration[];
  defaultAspectRatio?: WorkspaceRegistryAspectRatio;
  supportedAspectRatios?: WorkspaceRegistryAspectRatio[];
  referenceOnlyAspectRatios?: WorkspaceRegistryAspectRatio[];
  defaultOutputQuality?: WorkspaceRegistryOutputQuality;
  supportedOutputQualities?: WorkspaceRegistryOutputQuality[];
  defaultQuality?: WorkspaceRegistryQualityOption;
  qualityOptions?: WorkspaceRegistryQualityOption[];
  defaultAudioSetting?: WorkspaceRegistryAudioSetting;
  audioSettingOptions?: WorkspaceRegistryAudioSetting[];
  defaultLanguage?: WorkspaceRegistryLanguage;
  supportedLanguages?: WorkspaceRegistryLanguage[];
  defaultCharacterOrientation?: WorkspaceRegistryCharacterOrientation;
  characterOrientationOptions?: WorkspaceRegistryCharacterOrientation[];
  defaultBackgroundSource?: WorkspaceRegistryBackgroundSource;
  backgroundSourceOptions?: WorkspaceRegistryBackgroundSource[];
  requiresSourceVideoDuration?: boolean;
  requiresImageInput?: boolean;
  supportsSeed?: boolean;
  /** 本地 ComfyUI 工作流（免费，不调用外部付费 API）。 */
  isLocalFree?: boolean;
  /** 多段导演台：界面可逐段控制提示词与时长。 */
  multiSegment?: boolean;
  /**
   * 分段界面的形态：'timeline' 走 Director 的 timeline_data（MiniMaxH3 一体节点），
   * 'sequence' 走 AICG3D 的独立分段节点（每段自己的提示词/时长/参考图）。
   * 两种机制完全不同，界面不能混用。
   */
  segmentUi?: 'timeline' | 'sequence';
  referenceInputDefaultsByType?: Partial<
    Record<
      WorkspaceRegistryReferenceType,
      {
        backgroundSource?: WorkspaceRegistryBackgroundSource;
        characterOrientation?: WorkspaceRegistryCharacterOrientation;
      }
    >
  >;
  modelAliases?: string[];
  aliasDefaults?: Record<string, WorkspaceEffectRegistryAliasDefaults>;
};

const durationRange = (from: number, to: number): WorkspaceRegistryDuration[] =>
  Array.from(
    { length: to - from + 1 },
    (_, index) => `${from + index}s` as WorkspaceRegistryDuration
  );

const SEEDANCE_ASPECT_RATIOS = [
  'adaptive',
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
] as const;

export const WORKSPACE_EFFECT_REGISTRY: readonly WorkspaceEffectRegistryEntry[] =
  [
    {
      id: 'nano-banana-pro',
      name: 'Qwen Image 2.1 (I2I)',
      workspaceType: 'ai-image',
      routeSlug: 'nano-banana-pro',
      routeOrder: 10,
      defaultAspectRatio: '1:1',
      supportedAspectRatios: [
        '1:1',
        '2:3',
        '3:2',
        '3:4',
        '4:3',
        '4:5',
        '5:4',
        '9:16',
        '16:9',
        '21:9',
        'auto',
      ],
      defaultOutputQuality: '2k',
      supportedOutputQualities: ['1k', '2k', '4k'],
      modelAliases: ['nanobananapro'],
    },
    {
      id: 'nano-banana-2',
      name: 'Nano Banana 2',
      workspaceType: 'ai-image',
      routeSlug: 'nano-banana-2',
      routeOrder: 15,
      defaultAspectRatio: '1:1',
      supportedAspectRatios: [
        '1:1',
        '9:16',
        '16:9',
        '3:4',
        '4:3',
        '3:2',
        '2:3',
        '5:4',
        '4:5',
        '21:9',
        'auto',
      ],
      defaultOutputQuality: '1k',
      supportedOutputQualities: ['1k', '2k', '4k'],
      modelAliases: ['nanobanana2'],
    },
    {
      id: 'nano-banana-2-lite',
      name: 'Nano Banana 2 Lite',
      workspaceType: 'ai-image',
      routeSlug: 'nano-banana-2-lite',
      routeOrder: 18,
      defaultAspectRatio: '1:1',
      supportedAspectRatios: [
        '1:1',
        '9:16',
        '16:9',
        '3:4',
        '4:3',
        '3:2',
        '2:3',
        '5:4',
        '4:5',
        '21:9',
        'auto',
      ],
      modelAliases: ['nanobanana2lite'],
    },
    {
      id: 'nano-banana',
      name: 'Nano Banana',
      workspaceType: 'ai-image',
      routeSlug: 'nano-banana',
      routeOrder: 20,
      defaultAspectRatio: '1:1',
      supportedAspectRatios: [
        '1:1',
        '9:16',
        '16:9',
        '3:4',
        '4:3',
        '3:2',
        '2:3',
        '5:4',
        '4:5',
        '21:9',
        'auto',
      ],
      modelAliases: ['nanobanana'],
    },
    {
      id: 'gpt-image-2',
      name: 'GPT Image 2',
      workspaceType: 'ai-image',
      routeSlug: 'gpt-image-2',
      routeOrder: 30,
      defaultAspectRatio: 'auto',
      supportedAspectRatios: [
        'auto',
        '1:1',
        '3:2',
        '2:3',
        '4:3',
        '3:4',
        '5:4',
        '4:5',
        '16:9',
        '9:16',
        '2:1',
        '1:2',
        '3:1',
        '1:3',
        '21:9',
        '9:21',
      ],
      defaultOutputQuality: '1k',
      supportedOutputQualities: ['1k', '2k', '4k'],
    },
    {
      id: 'gpt-image-2.5-flare',
      name: 'GPT Image 2.5 Flare',
      workspaceType: 'ai-image',
      routeSlug: 'gpt-image-2-5-flare',
      routeOrder: 32,
      defaultAspectRatio: 'auto',
      supportedAspectRatios: [
        'auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
        '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21',
      ],
      defaultOutputQuality: '1k',
      supportedOutputQualities: ['1k', '2k', '4k'],
    },
    {
      id: 'gpt-image-2.5-sunburst',
      name: 'GPT Image 2.5 Sunburst',
      workspaceType: 'ai-image',
      routeSlug: 'gpt-image-2-5-sunburst',
      routeOrder: 34,
      defaultAspectRatio: 'auto',
      supportedAspectRatios: [
        'auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
        '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21',
      ],
      defaultOutputQuality: '1k',
      supportedOutputQualities: ['1k', '2k', '4k'],
    },
    {
      id: 'seedream-5-pro',
      name: 'Qwen Image 2.1 (T2I)',
      workspaceType: 'ai-image',
      routeSlug: 'seedream-5-pro',
      routeOrder: 40,
      defaultAspectRatio: '1:1',
      supportedAspectRatios: [
        'auto',
        '1:1',
        '4:3',
        '3:4',
        '16:9',
        '9:16',
        '3:2',
        '2:3',
        '21:9',
      ],
      defaultOutputQuality: '1k',
      supportedOutputQualities: ['1k', '2k'],
    },
    {
      id: 'grok-imagine-image-2.0',
      name: 'Grok Imagine Image 2.0',
      workspaceType: 'ai-image',
      routeSlug: 'grok-imagine-image-2-0',
      routeAliases: ['grok-imagine-image-2.0'],
      routeOrder: 50,
      defaultAspectRatio: '1:1',
      supportedAspectRatios: ['1:1', '2:3', '3:2', '16:9', '9:16'],
      referenceOnlyAspectRatios: ['auto'],
    },
    {
      id: 'seedance-2',
      name: 'Seedance 2',
      workspaceType: 'ai-video',
      routeSlug: 'seedance-2',
      routeAliases: ['seedance-2-0', 'seedance2-0'],
      routeOrder: 10,
      defaultDuration: '5s',
      supportedDurations: durationRange(4, 15),
      defaultAspectRatio: 'adaptive',
      supportedAspectRatios: [...SEEDANCE_ASPECT_RATIOS],
      defaultOutputQuality: '720p',
      supportedOutputQualities: ['480p', '720p', '1080p', '4k'],
      modelAliases: ['seedance20'],
    },
    {
      id: 'seedance-2-fast',
      name: 'Seedance 2 Fast',
      workspaceType: 'ai-video',
      routeSlug: 'seedance-2-fast',
      routeAliases: ['seedance-2.0-fast', 'seedance20-fast'],
      routeOrder: 12,
      defaultDuration: '5s',
      supportedDurations: durationRange(4, 15),
      defaultAspectRatio: 'adaptive',
      supportedAspectRatios: [...SEEDANCE_ASPECT_RATIOS],
      defaultOutputQuality: '720p',
      supportedOutputQualities: ['480p', '720p'],
      modelAliases: ['seedance20fast'],
    },
    {
      id: 'seedance-2-mini',
      name: 'Seedance 2 Mini',
      workspaceType: 'ai-video',
      routeSlug: 'seedance-2-mini',
      routeAliases: ['seedance-2.0-mini', 'seedance20-mini'],
      routeOrder: 14,
      defaultDuration: '5s',
      supportedDurations: durationRange(4, 15),
      defaultAspectRatio: 'adaptive',
      supportedAspectRatios: [...SEEDANCE_ASPECT_RATIOS],
      defaultOutputQuality: '720p',
      supportedOutputQualities: ['480p', '720p'],
      modelAliases: ['seedance20mini'],
    },
    {
      id: 'seedance-2.5',
      name: 'Seedance 2.5',
      workspaceType: 'ai-video',
      routeSlug: 'seedance-2-5',
      routeOrder: 20,
      defaultDuration: '5s',
      supportedDurations: durationRange(4, 30),
      defaultAspectRatio: 'adaptive',
      supportedAspectRatios: [...SEEDANCE_ASPECT_RATIOS],
      defaultOutputQuality: '720p',
      supportedOutputQualities: ['720p'],
    },
    {
      id: 'minimax-h3',
      name: 'MiniMax H3 (T2V)',
      workspaceType: 'ai-video',
      routeSlug: 'minimax-h3',
      routeOrder: 30,
      defaultDuration: '5s',
      supportedDurations: durationRange(4, 30),
      defaultAspectRatio: '16:9',
      supportedAspectRatios: [...SEEDANCE_ASPECT_RATIOS],
      defaultOutputQuality: '768p',
      supportedOutputQualities: ['768p', '2k'],
    },
    {
      id: 'wan-3.0',
      name: 'Wan 3.0',
      workspaceType: 'ai-video',
      routeSlug: 'wan-3-0',
      routeOrder: 32,
      defaultDuration: '5s',
      supportedDurations: durationRange(2, 30),
      defaultAspectRatio: '16:9',
      supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      defaultOutputQuality: '720p',
      supportedOutputQualities: ['480p', '720p', '1080p'],
    },
    {
      id: 'wan-3.0-prime',
      name: 'Wan 3.0 Prime',
      workspaceType: 'ai-video',
      routeSlug: 'wan-3-0-prime',
      routeOrder: 34,
      defaultDuration: '5s',
      supportedDurations: durationRange(2, 30),
      defaultAspectRatio: '16:9',
      supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      defaultOutputQuality: '720p',
      supportedOutputQualities: ['480p', '720p', '1080p'],
    },
    {
      id: 'happyhorse-1.0',
      name: 'HappyHorse 1.0',
      workspaceType: 'ai-video',
      routeSlug: 'happyhorse-1-0',
      routeOrder: 36,
      defaultDuration: '5s',
      supportedDurations: durationRange(3, 15),
      defaultAspectRatio: '16:9',
      supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      defaultOutputQuality: '720p',
      supportedOutputQualities: ['720p', '1080p'],
      requiresImageInput: true,
    },
    {
      id: 'happyhorse-1.1',
      name: 'HappyHorse 1.1',
      workspaceType: 'ai-video',
      routeSlug: 'happyhorse-1-1',
      routeOrder: 38,
      defaultDuration: '5s',
      supportedDurations: durationRange(3, 15),
      defaultAspectRatio: '16:9',
      supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      defaultOutputQuality: '720p',
      supportedOutputQualities: ['720p', '1080p'],
      requiresImageInput: true,
    },
    {
      id: 'minimax-h3-max',
      name: 'MiniMax H3 (FL2VA/I2V)',
      workspaceType: 'ai-video',
      routeSlug: 'minimax-h3-max',
      routeOrder: 40,
      defaultDuration: '5s',
      supportedDurations: durationRange(4, 30),
      defaultOutputQuality: '768p',
      supportedOutputQualities: ['480p', '768p'],
      supportsSeed: true,
    },
    {
      id: 'minimax-h3-max-turbo',
      name: 'MiniMax H3 (R2V 参考主体)',
      workspaceType: 'ai-video',
      routeSlug: 'minimax-h3-max-turbo',
      routeOrder: 42,
      defaultDuration: '5s',
      supportedDurations: durationRange(4, 30),
      defaultOutputQuality: '768p',
      supportedOutputQualities: ['480p', '768p'],
      supportsSeed: true,
      multiSegment: true,
      requiresImageInput: true,
    },
    {
      id: 'veo-3.1',
      name: 'Veo 3.1',
      workspaceType: 'ai-video',
      routeSlug: 'veo-3-1',
      routeAliases: ['veo3-1'],
      routeOrder: 50,
      defaultAspectRatio: '16:9',
      supportedAspectRatios: ['16:9', '9:16', 'auto'],
      defaultDuration: '8s',
      defaultOutputQuality: '720p',
      supportedOutputQualities: ['720p', '1080p', '4k'],
      defaultMode: 'quality',
      modeOptions: ['quality', 'fast', 'lite'],
      modelAliases: ['veo31', 'veo31-quality', 'veo31-fast', 'veo31-lite'],
      aliasDefaults: {
        'veo31-quality': { defaultMode: 'quality' },
        'veo31-fast': { defaultMode: 'fast' },
        'veo31-lite': { defaultMode: 'lite' },
      },
    },
    {
      id: 'kling-3',
      name: 'Kling 3',
      workspaceType: 'ai-video',
      routeSlug: 'kling-3',
      routeAliases: ['kling-3-0', 'kling3-0'],
      routeOrder: 60,
      defaultDuration: '5s',
      supportedDurations: durationRange(3, 15),
      defaultAspectRatio: '16:9',
      supportedAspectRatios: ['16:9', '9:16', '1:1'],
      defaultOutputQuality: 'pro',
      supportedOutputQualities: ['std', 'pro', '4k'],
      modelAliases: ['kling30'],
    },
    {
      id: 'grok-imagine-video-1.5',
      name: 'Grok Imagine Video 1.5',
      workspaceType: 'ai-video',
      routeSlug: 'grok-imagine-video-1-5',
      routeAliases: ['grok-imagine-video-1.5'],
      routeOrder: 65,
      defaultDuration: '8s',
      supportedDurations: durationRange(1, 15),
      defaultAspectRatio: '16:9',
      supportedAspectRatios: ['1:1', '16:9', '9:16', '3:2', '2:3', 'auto'],
      defaultOutputQuality: '720p',
      supportedOutputQualities: ['480p', '720p', '1080p'],
    },
    {
      id: 'kling-2.6-motion-control',
      name: 'Kling 2.6 Motion Control',
      workspaceType: 'ai-video',
      routeSlug: 'kling-2-6-motion-control',
      routeAliases: ['kling-2.6-motion-control', 'kling26-motion-control'],
      routeOrder: 70,
      defaultOutputQuality: '720p',
      supportedOutputQualities: ['720p', '1080p'],
      defaultCharacterOrientation: 'video',
      characterOrientationOptions: ['image', 'video'],
      requiresSourceVideoDuration: true,
      referenceInputDefaultsByType: {
        video: { characterOrientation: 'video' },
      },
      modelAliases: ['kling26motioncontrol'],
    },
    {
      id: 'kling-3-motion-control',
      name: 'Kling 3.0 Motion Control',
      workspaceType: 'ai-video',
      routeSlug: 'kling-3-motion-control',
      routeAliases: ['kling-3.0-motion-control', 'kling30-motion-control'],
      routeOrder: 80,
      defaultOutputQuality: '720p',
      supportedOutputQualities: ['720p', '1080p'],
      defaultCharacterOrientation: 'video',
      characterOrientationOptions: ['image', 'video'],
      defaultBackgroundSource: 'input_video',
      backgroundSourceOptions: ['input_video', 'input_image'],
      requiresSourceVideoDuration: true,
      referenceInputDefaultsByType: {
        video: {
          characterOrientation: 'video',
          backgroundSource: 'input_video',
        },
      },
      modelAliases: ['kling3motioncontrol', 'kling30motioncontrol'],
    },
    // ===== 本地音乐工作流（YuE2）=====
    {
      id: '小枫-yue2-歌曲创作',
      name: 'YuE2 歌曲创作',
      description: '写歌词 + 选风格，生成一首带演唱的完整歌曲。约 2~4 分钟。',
      workspaceType: 'ai-audio',
      routeSlug: 'yue2-song-create',
      routeOrder: 80,
      supportsSeed: true,
      isLocalFree: true,
    },
    {
      id: '小枫-yue2-歌曲翻唱',
      name: 'YuE2 歌曲翻唱',
      description: '上传一首歌当旋律来源，保留原曲旋律换唱腔与风格。必须上传音频。',
      workspaceType: 'ai-audio',
      routeSlug: 'yue2-song-cover',
      routeOrder: 81,
      supportsSeed: true,
      isLocalFree: true,
    },

    // ===== 本地 ComfyUI 工作流（同步自用户 workflows 目录）=====
    {
      id: '小枫-H3-导演-连贯成片',
      name: 'MiniMax H3 导演·连贯成片',
      description: '一个提示词出连贯长镜头，支持逐段写不同提示词和时长；默认 5 秒。',
      workspaceType: 'ai-video',
      routeSlug: 'minimax-h3-director-film',
      routeOrder: 95,
      defaultDuration: '5s',
      supportedDurations: durationRange(1, 15),
      supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      defaultOutputQuality: '768p',
      supportedOutputQualities: ['480p', '768p'],
      supportsSeed: true,
      multiSegment: true,
      isLocalFree: true,
    },
    {
      // 无限分段：每段独立提示词，段落之间用尾帧续写接上，
      // 人物可以用 <Picture N> 参考图锁脸 —— 这是它和上面三段串联版本的区别。
      id: '小枫-无限分段生视频',
      name: 'MiniMax H3 无限分段 · 人物参考图',
      description:
        '每段独立提示词与时长，段间尾帧续写；8 张人物参考图按 <Picture 1-8> 锁定形象，适合短剧。',
      workspaceType: 'ai-video',
      routeSlug: 'minimax-h3-unlimited-segments',
      routeOrder: 95,
      defaultDuration: '12s',
      supportedDurations: durationRange(1, 60),
      supportedAspectRatios: ['16:9', '9:16', '1:1'],
      defaultOutputQuality: '1080p',
      supportedOutputQualities: ['480p', '720p', '1080p'],
      supportsSeed: true,
      multiSegment: true,
      segmentUi: 'sequence',
      isLocalFree: true,
    },
    {
      // AICG3D 分段串联家族：同一张图，三段串联，一次提交跑出 12 秒成片。
      // 三个条目只差显存档位、分辨率和模型量化 —— 分辨率也能在界面上用质量
      // 选项改（映射到全局设置节点的 resolution 枚举）。
      id: '小枫-aicg3d-h3-长视频',
      name: 'MiniMax H3 长视频 · 画质优先',
      description: '分段串联出 12 秒长视频，显存档位按显卡自动选择，可选 480P/720P/1080P。',
      workspaceType: 'ai-video',
      routeSlug: 'minimax-h3-aicg3d-1080p',
      routeOrder: 96,
      defaultDuration: '12s',
      supportedDurations: durationRange(1, 30),
      supportedAspectRatios: ['16:9', '9:16', '1:1'],
      defaultOutputQuality: '1080p',
      supportedOutputQualities: ['480p', '720p', '1080p'],
      supportsSeed: true,
      multiSegment: true,
        segmentUi: 'sequence',
      isLocalFree: true,
    },
    {
      id: '小枫-aicg3d-h3-中配长视频',
      name: 'MiniMax H3 长视频 · 720P 平衡',
      description: '同上，锁 720P、12G 显存档位，速度与画质平衡。',
      workspaceType: 'ai-video',
      routeSlug: 'minimax-h3-aicg3d-720p',
      routeOrder: 97,
      defaultDuration: '12s',
      supportedDurations: durationRange(1, 30),
      supportedAspectRatios: ['16:9', '9:16', '1:1'],
      defaultOutputQuality: '720p',
      supportedOutputQualities: ['720p'],
      supportsSeed: true,
      multiSegment: true,
        segmentUi: 'sequence',
      isLocalFree: true,
    },
    {
      id: '小枫-aicg3d-h3-低显存长视频',
      name: 'MiniMax H3 长视频 · 480P 低显存',
      description: '同上，锁 480P、8G 显存档位并段间卸载模型，8~12G 显卡可用。',
      workspaceType: 'ai-video',
      routeSlug: 'minimax-h3-aicg3d-480p',
      routeOrder: 98,
      defaultDuration: '12s',
      supportedDurations: durationRange(1, 30),
      supportedAspectRatios: ['16:9', '9:16', '1:1'],
      defaultOutputQuality: '480p',
      supportedOutputQualities: ['480p'],
      supportsSeed: true,
      multiSegment: true,
        segmentUi: 'sequence',
      isLocalFree: true,
    },
    {
      id: 'qwen-image-2-1图像编辑',
      name: 'Qwen Image 2.1 图像编辑',
      description: '上传一张图 + 描述改动，按描述重绘；适合换背景、加元素。',
      workspaceType: 'ai-image',
      routeSlug: 'qwen-image-2-1-edit',
      routeOrder: 95,
      supportsSeed: true,
      requiresImageInput: true,
      supportedOutputQualities: ['1k', '2k', '4k'],
      defaultOutputQuality: '1k',
      supportedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      defaultAspectRatio: 'auto',
      referenceOnlyAspectRatios: ['auto'],
      isLocalFree: true,
    },
    {
      id: '小枫-qwen-image-2-1-文生图',
      name: 'Qwen Image 2.1 文生图',
      description: '纯文字生成图片，支持 1K/2K/4K。',
      workspaceType: 'ai-image',
      routeSlug: 'qwen-image-2-1-t2i',
      routeOrder: 98,
      supportsSeed: true,
      supportedOutputQualities: ['1k', '2k', '4k'],
      defaultOutputQuality: '1k',
      supportedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      defaultAspectRatio: '1:1',
      isLocalFree: true,
    },
    {
      id: 'qwen-image-2-1文生图-seedvr2自动放大',
      name: 'Qwen Image 2.1 文生图 + SeedVR2 放大',
      description: '文生图后自动用 SeedVR2 放大，细节更实的 2K 成图。',
      workspaceType: 'ai-image',
      routeSlug: 'qwen-image-2-1-t2i-seedvr2',
      routeOrder: 99,
      supportsSeed: true,
      supportedOutputQualities: ['1k', '2k'],
      defaultOutputQuality: '1k',
      supportedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      defaultAspectRatio: '1:1',
      isLocalFree: true,
    },
    {
      id: '小枫-dlss5-视频增强',
      name: 'DLSS5 视频增强',
      description: '视频逐帧增强放大，输出更干净的画面。',
      workspaceType: 'ai-video',
      routeSlug: 'dlss5-video-enhance',
      routeOrder: 101,
      defaultDuration: '5s',
      supportedDurations: durationRange(1, 30),
      supportedAspectRatios: ['auto'],
      defaultAspectRatio: 'auto',
      referenceOnlyAspectRatios: ['auto'],
      isLocalFree: true,
    },
    {
      id: '小枫-qwen3-tts-三合一整合版',
      name: 'Qwen3 TTS 三合一',
      description: '文字转语音，可选音色；输出 mp3。',
      workspaceType: 'ai-image',
      routeSlug: 'qwen3-tts-all-in-one',
      routeOrder: 102,
      supportsSeed: true,
      supportedAspectRatios: ['auto'],
      defaultAspectRatio: 'auto',
      referenceOnlyAspectRatios: ['auto'],
      isLocalFree: true,
    },
    {
      id: '小枫-flux2-klein-三视图工作流',
      name: 'Flux.2 Klein 三视图工作流',
      description: '一张参考图生成正面/侧面/背面三视图，做角色设定用。',
      workspaceType: 'ai-image',
      routeSlug: 'flux2-klein-three-view',
      routeOrder: 103,
      supportsSeed: true,
      supportedOutputQualities: ['1k', '2k'],
      defaultOutputQuality: '1k',
      supportedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      defaultAspectRatio: '1:1',
      isLocalFree: true,
    },
    {
      id: 'flux-2-klein-文生图',
      name: 'Flux.2 Klein 文生图',
      description: 'Flux.2 Klein 文生图，风格偏写实，出图快。',
      workspaceType: 'ai-image',
      routeSlug: 'flux2-klein-t2i',
      routeOrder: 104,
      supportsSeed: true,
      supportedOutputQualities: ['1k', '2k'],
      defaultOutputQuality: '1k',
      supportedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      defaultAspectRatio: '1:1',
      isLocalFree: true,
    },
    {
      id: 'flux2-klein-图片编辑-单图',
      name: 'Flux.2 Klein 图片编辑（单图）',
      description: '单图编辑，保持人物/构图改风格。',
      workspaceType: 'ai-image',
      routeSlug: 'flux2-klein-edit-single',
      routeOrder: 105,
      supportsSeed: true,
      requiresImageInput: true,
      supportedOutputQualities: ['1k', '2k'],
      defaultOutputQuality: '1k',
      supportedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      defaultAspectRatio: 'auto',
      referenceOnlyAspectRatios: ['auto'],
      isLocalFree: true,
    },
    {
      id: '图片放大-seedvr2',
      name: 'SeedVR2 图片放大',
      description: '把已有图片无损放大，最高 4 倍。',
      workspaceType: 'ai-image',
      routeSlug: 'seedvr2-upscale',
      routeOrder: 106,
      requiresImageInput: true,
      supportedAspectRatios: ['auto'],
      defaultAspectRatio: 'auto',
      referenceOnlyAspectRatios: ['auto'],
      isLocalFree: true,
    },
    {
      id: '小枫-dlss5-单图增强',
      name: 'DLSS5 单图增强',
      description: 'DLSS 单图增强，补细节、去噪，适合低清图救急。',
      workspaceType: 'ai-image',
      routeSlug: 'dlss5-image-enhance',
      routeOrder: 107,
      requiresImageInput: true,
      supportedAspectRatios: ['auto'],
      defaultAspectRatio: 'auto',
      referenceOnlyAspectRatios: ['auto'],
      isLocalFree: true,
    },
    {
      id: '小枫-h3导演台-人脸修复',
      name: 'MiniMax H3 导演台 · 人脸修复',
      workspaceType: 'ai-video',
      routeSlug: 'h3-director-face-refine',
      routeOrder: 108,
      supportsSeed: true,
      defaultDuration: '5s',
      supportedDurations: durationRange(1, 15),
      supportedAspectRatios: ['auto'],
      defaultAspectRatio: 'auto',
      referenceOnlyAspectRatios: ['auto'],
      isLocalFree: true,
    },
    {
      id: '小枫-minimaxh3-动作迁移',
      name: 'MiniMax H3 动作 / 运镜迁移',
      workspaceType: 'ai-video',
      routeSlug: 'h3-motion-transfer',
      routeOrder: 109,
      supportsSeed: true,
      defaultDuration: '5s',
      supportedDurations: durationRange(1, 15),
      supportedAspectRatios: ['auto'],
      defaultAspectRatio: 'auto',
      referenceOnlyAspectRatios: ['auto'],
      isLocalFree: true,
    },
    {
      id: '小枫-qwen-image-2-1-图像编辑',
      name: 'Qwen Image 2.1 图像编辑（小枫版）',
      description: '同上，最多挂 3 张参考图。',
      workspaceType: 'ai-image',
      routeSlug: 'xiaofeng-qwen-image-2-1-edit',
      routeOrder: 110,
      supportsSeed: true,
      requiresImageInput: true,
      supportedOutputQualities: ['1k', '2k', '4k'],
      defaultOutputQuality: '1k',
      supportedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      defaultAspectRatio: 'auto',
      referenceOnlyAspectRatios: ['auto'],
      isLocalFree: true,
    },
    {
      id: '小枫-qwen-image-2-1-图编辑-4步加速版',
      name: 'Qwen Image 2.1 图编辑 4 步加速',
      description: '图像编辑的 4 步加速版，速度快约 5 倍，细节略少。',
      workspaceType: 'ai-image',
      routeSlug: 'xiaofeng-qwen-image-2-1-edit-4step',
      routeOrder: 111,
      supportsSeed: true,
      requiresImageInput: true,
      supportedOutputQualities: ['1k', '2k', '4k'],
      defaultOutputQuality: '1k',
      supportedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      defaultAspectRatio: 'auto',
      referenceOnlyAspectRatios: ['auto'],
      isLocalFree: true,
    },
    {
      id: '小枫-qwen-image-2-1-文生图-4步加速版',
      name: 'Qwen Image 2.1 文生图 4 步加速',
      description: '文生图的 4 步加速版，约 20 秒出图。',
      workspaceType: 'ai-image',
      routeSlug: 'xiaofeng-qwen-image-2-1-t2i-4step',
      routeOrder: 112,
      supportsSeed: true,
      supportedOutputQualities: ['1k', '2k', '4k'],
      defaultOutputQuality: '1k',
      supportedAspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      defaultAspectRatio: '1:1',
      isLocalFree: true,
    },
  ] as const;

const WORKSPACE_EFFECT_REGISTRY_BY_ID = new Map(
  WORKSPACE_EFFECT_REGISTRY.map((entry) => [entry.id, entry])
);

const WORKSPACE_EFFECT_REGISTRY_BY_ALIAS = new Map(
  WORKSPACE_EFFECT_REGISTRY.flatMap((entry) =>
    (entry.modelAliases ?? []).map((alias) => [alias, entry] as const)
  )
);

export const getWorkspaceEffectRegistryEntry = (
  modelId: string
): WorkspaceEffectRegistryEntry | null =>
  WORKSPACE_EFFECT_REGISTRY_BY_ID.get(modelId) ??
  WORKSPACE_EFFECT_REGISTRY_BY_ALIAS.get(modelId) ??
  null;

export const getWorkspaceEffectRegistryEntryByEffectId = (
  effectId: number,
  providerId?: string
): WorkspaceEffectRegistryEntry | null => {
  const binding = getGenerationModelBindingByEffectId({ effectId, providerId });
  return binding ? getWorkspaceEffectRegistryEntry(binding.modelId) : null;
};

export const resolveWorkspaceEffectProviderModelVariant = ({
  modelId,
  variant,
}: {
  modelId: string;
  variant?: WorkspaceRegistryModelVariant | null;
}): string => {
  return resolveProviderUpstreamModel({ modelId, variant });
};

export const getWorkspaceEffectReferenceInputDefaults = ({
  modelId,
  referenceType,
}: {
  modelId: string;
  referenceType?: WorkspaceRegistryReferenceType | null;
}) => {
  const entry = getWorkspaceEffectRegistryEntry(modelId);
  if (!entry || !referenceType) {
    return null;
  }

  return entry.referenceInputDefaultsByType?.[referenceType] ?? null;
};

export const getWorkspaceEffectRegistryEntriesByType = (
  workspaceType: WorkspaceRegistryType
): WorkspaceEffectRegistryEntry[] =>
  WORKSPACE_EFFECT_REGISTRY.filter(
    (entry) => entry.workspaceType === workspaceType
  );

export const getRoutableWorkspaceEffectRegistryEntriesByType = (
  workspaceType: WorkspaceRegistryType
): Array<WorkspaceEffectRegistryEntry & { routeSlug: string }> =>
  WORKSPACE_EFFECT_REGISTRY.filter(
    (entry): entry is WorkspaceEffectRegistryEntry & { routeSlug: string } =>
      entry.workspaceType === workspaceType &&
      typeof entry.routeSlug === 'string'
  ).sort((left, right) => (left.routeOrder ?? 0) - (right.routeOrder ?? 0));
