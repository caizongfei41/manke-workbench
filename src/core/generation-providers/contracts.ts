import type { BaseAdapter, EffectRecord } from '@/core/adapters/base-adapter';

export type GenerationMediaCapability = 'image' | 'video' | 'audio' | 'analysis';

export type GenerationProviderModelBinding = {
  /** Stable BeatDesign product model id. */
  modelId: string;
  /** Provider-local numeric id retained for existing DB/API compatibility. */
  effectId: number;
  /** Provider model name sent upstream. */
  upstreamModelId: string;
  uploadPath: string;
  imageBucketName: string;
  upstreamModelByVariant?: Readonly<Record<string, string>>;
};

export type GenerationProviderDefinition = {
  id: string;
  label: string;
  supports: readonly GenerationMediaCapability[];
  modelBindings: readonly GenerationProviderModelBinding[];
  createAdapter: (effect: EffectRecord) => BaseAdapter;
  assertConfigured?: () => Promise<void>;
  validateInput?: (effect: EffectRecord, input: Record<string, unknown>) => void;
  /**
   * 参考图由适配器本地投递：不把项目本地素材上传到远端存储，
   * 而是直接把项目本地资产 URL 交给适配器。适合本地生成后端（如本地 ComfyUI）。
   */
  localReferenceDelivery?: boolean;
};

export type GenerationProviderRegistrar = (
  provider: GenerationProviderDefinition
) => void;
