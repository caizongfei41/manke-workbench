import { ComfyUiAdapter } from '@/core/adapters/comfyui-adapter';

import type { GenerationProviderDefinition } from './contracts';

export const COMFYUI_PROVIDER_ID = 'comfyui';

/**
 * 绑定到本地 ComfyUI 的图像与视频模型。
 * 每个模型对应 data/comfyui/workflows/<modelId>.json 模板。
 *
 * 这里只列**本地能跑**的模型。云端模型（nano-banana、gpt-image、seedream、
 * grok-imagine 等）已从列表中移除：本工作区只注册 ComfyUI provider
 * （见 src/config/generation-providers.ts），而 model-catalog 会为每个绑定查
 * 注册表条目，只要条目存在就会把它显示出来——那些云端 id 在本地没有对应模板，
 * 显示出来点了必然报错，所以不再保留。
 *
 * minimax-h3 / minimax-h3-max / minimax-h3-max-turbo 同样暂时移除：
 * 注册表有条目但 data/comfyui/workflows/ 下没有模板文件。
 * 补上模板后把对应行加回来即可。
 */
export const COMFYUI_MODEL_BINDINGS = [
  // 待补模板（注册表已有条目，但 data/comfyui/workflows/ 下缺文件）。
  // 取到模板后取消注释即可，否则界面会显示一个点了报错的模型。
  // ['minimax-h3', 17],
  // ['minimax-h3-max', 33],
  // ['minimax-h3-max-turbo', 34],
  // 以下 7 个既无模板也无注册表条目，暂时不会出现在界面上，保留作为待办清单。
  ['minimaxh3-口播开头专用导演台', 100],
  ['minimaxh3-导演台-二采-加速', 101],
  ['minimaxh3-导演台-二采-多lora-kitchen加速-快1-5-2倍', 102],
  ['minimaxh3-视频生成导演台-二次采样', 103],
  ['小枫-minimaxh3-动作迁移', 104],
  ['小枫-h3导演台-人脸修复', 114],
  ['小枫-h3导演台-文生视频', 115],
  ['小枫-h3导演台-参考主体', 116],
  ['小枫-h3导演台-首尾帧', 117],
  ['小枫-H3-导演-连贯成片', 118],
  ['qwen-image-2-1图像编辑', 105],
  ['小枫-qwen-image-2-1-图像编辑', 106],
  ['小枫-qwen-image-2-1-图编辑-4步加速版', 107],
  ['小枫-qwen-image-2-1-文生图', 108],
  ['小枫-qwen-image-2-1-文生图-4步加速版', 109],
  ['flux-2-klein-文生图', 110],
  ['flux2-klein-图片编辑-单图', 111],
  ['小枫-flux2-klein-三视图工作流', 119],
  ['图片放大-seedvr2', 112],
  ['小枫-dlss5-单图增强', 113],
  ['小枫-dlss5-视频增强', 120],
  ['qwen-image-2-1文生图-seedvr2自动放大', 121],
  ['小枫-qwen3-tts-三合一整合版', 122],
  ['小枫-aicg3d-h3-低显存长视频', 123],
  ['小枫-aicg3d-h3-长视频', 124],
  ['小枫-aicg3d-h3-中配长视频', 125],
] as const;

export const comfyUiGenerationProvider: GenerationProviderDefinition = {
  id: COMFYUI_PROVIDER_ID,
  label: 'Local ComfyUI',
  supports: ['image', 'video'],
  localReferenceDelivery: true,
  modelBindings: COMFYUI_MODEL_BINDINGS.map(([modelId, effectId]) => ({
    modelId,
    effectId,
    upstreamModelId: modelId,
    uploadPath: '',
    imageBucketName: '',
  })),
  createAdapter: (effect) => new ComfyUiAdapter(effect),
  validateInput: (effect, input) => {
    if (
      !input ||
      typeof input !== 'object' ||
      typeof (input as Record<string, unknown>).prompt !== 'string'
    ) {
      throw new Error('Prompt is required.');
    }
  },
};
