# 依赖清单

> 由 `scripts/audit-template-deps.mjs` 生成。模板或环境变化后重新跑一次即可更新。

- 模板：**22** 个
- 核心之外的自定义节点类：**58** 个
- 需要的自定义节点包：**13** 个
- 模型 / 资源文件：**30** 个

## 〇、从哪儿装（换机器部署必读）

本机跑通了不代表另一台也能跑。缺东西时按这张表补，命令行自检会把对应链接直接打出来。

### 基础环境

| 项目 | 版本 | 渠道 | 说明 |
| --- | --- | --- | --- |
| Node.js | 20+ | https://nodejs.org/zh-cn/download | 装 LTS 版即可 |
| pnpm | 9+ | https://pnpm.io/zh/installation | 或 npm i -g pnpm |
| ComfyUI | Windows 整合包（推荐） | https://github.com/comfyanonymous/ComfyUI/releases | Windows 解压即用，自带 python_embeded |
| Python | 3.12（整合包内置） | https://www.python.org/downloads/ | 整合包已内置，只有源码部署需要 |

### 大模型整包

逐个下 30 个文件很折腾，能整包拿优先整包：

| 渠道 | 地址 | 提取码 | 覆盖 |
| --- | --- | --- | --- |
| 漫客工作台 · 一键部署包（197 GB，115 卷） | https://pan.quark.cn/s/c0441ca5d59c | ~01793bkzer~:/ | 全部 / 115 个分卷 |
| 漫客工作台 · 模型包（197 GB，仅模型） | https://pan.quark.cn/s/ebc77c7d9817 | /~72003bgWcO~/ | 全部 / 25 个文件 |
| ModelScope · MiniMax H3 官方仓 | https://modelscope.cn/models/MiniMaxAI/MiniMax_H3 | — | Minimax-h3/minimax_h3_ |
| HuggingFace · H3 社区量化索引 | https://huggingface.co/models?search=MiniMax%20H3 | — | minimax_h3 |
| HuggingFace · Qwen-Image GGUF 索引 | https://huggingface.co/models?search=qwen-image%20gguf | — | qwen-image |

> 国内环境优先 ModelScope，直连速度快。HuggingFace 需要代理或镜像站。

### 按显存选模型版本

同一份工作流常有多个量化版。模板里写死了文件名，换版本要同步改 JSON 或做软链接。

| 显存 | 视频主模型 | 文本编码器 | 分辨率上限 |
| --- | --- | --- | --- |
| 8–12 GB | `minimax_h3_fl2va_pruned_w4a8_mixed` | `qwen3vl_8b_int8_convrot` | 480P |
| 16 GB | `minimax_h3_ref2va_pruned_int8_convrot` | `qwen3vl_32b_minimax_h3_int8_convrot` | 720P |
| 20–24 GB | `Minimax-h3_Singularity_ref2va_v1.3_int8` | `qwen3vl_32b_minimax_h3_int8_convrot` | 720P（1080P 顶边界） |
| 40 GB+ | 同上 | `qwen3vl_32b_minimax_h3_nvfp4_awq` | 1080P |

> `nvfp4` 需要 40 系及以上显卡，30 系只能用 int8。

### 命令行自检

```bash
node scripts/check-environment.mjs          # 缺什么连带下载地址一起打印
node scripts/check-environment.mjs --json   # 机器读
node scripts/fetch-models.mjs --write       # 生成带路径的清单
```

服务控制台的「环境自检」面板里，失败项下面也会列出渠道；
旁边的「依赖清单」按钮直接打开本文件。

---

## 一、需要安装的 ComfyUI 自定义节点包

把下面这些目录从旧机器的 `ComfyUI/custom_nodes/` 整个拷到新机器同名目录。

| 节点包目录 | 提供的节点类 |
| --- | --- |
| `ComfyUI-AICG3D-Integrated` | `AICG3D_H3Loader`, `AICG3D_H3MediaLoader`, `AICG3D_H3SequenceCombine`, `AICG3D_H3SequenceGlobal`, `AICG3D_H3SequenceSegment` |
| `ComfyUI-AICG3D-PromptSplit` | `AICG3DPromptSegmentSplit` |
| `ComfyUI-DepthAnythingV2` | `DepthAnything_V2`, `DownloadAndLoadDepthAnythingV2Model` |
| `ComfyUI-Easy-Use` | `easy cleanGpuUsed` |
| `ComfyUI-GGUF` | `UnetLoaderGGUF` |
| `ComfyUI-KJNodes` | `ImageConcatMulti` |
| `ComfyUI-QWEN3_TTS` | `Qwen3TTSCustomVoice`, `Qwen3TTSModelLoader` |
| `ComfyUI-ReActor` | `DLSS5FrameEnhancer` |
| `ComfyUI-SeedVR2_VideoUpscaler` | `SeedVR2LoadDiTModel`, `SeedVR2LoadVAEModel`, `SeedVR2TorchCompileSettings`, `SeedVR2VideoUpscaler` |
| `ComfyUI-VideoHelperSuite` | `VHS_LoadVideo`, `VHS_VideoCombine` |
| `ComfyUI_MiniMaxH3_Director` | `MiniMaxH3Director`, `MiniMaxH3DirectorFaceRefine`, `MiniMaxH3DirectorRefine` |
| `Comfyui-Qwen-Image-2.1-BlockCache-T8` | `QwenImage21BlockCacheT8` |
| `XB_ToolBox` | `XB_AudioSlicerV1`, `XB_SageAttentionAccelerator`, `XB_YuE2CoverPrep`, `XB_YuE2Lyrics`, `XB_YuE2ScoreWorkbench`, `XB_YuE2StylePrompt` |

### 随 ComfyUI 自带（无需单独安装）

- (comfy_extras)：`AudioEncoderLoader`, `BasicScheduler`, `BlockSparseAttention`, `CFGGuider`, `ComfySwitchNode`, `CreateVideo`, `EmptyFlux2LatentImage`, `EmptyYuE2LatentAudio`, `ImageScaleToTotalPixels`, `JoinImageWithAlpha`, `KSamplerSelect`, `ModelAttentionBackend`, `PreviewAny`, `QwenImage21Cache`, `RandomNoise`, `ReferenceLatent`, `ResolutionSelector`, `SamplerCustomAdvanced`, `SaveAudioAdvanced`, `SaveAudioMP3`, `SaveImageAdvanced`, `SaveVideo`, `SheetSage2AudioToABC`, `TextEncodeQwenImage21`, `VAEDecodeAudio`, `YuE2GenerateABC`, `YuE2GenerateMusic`
- (core)：`ConditioningZeroOut`

## 二、需要存在的模型 / 资源文件

`文件名` 是模板里写死的值，必须在新机器上放在 ComfyUI 对应目录下（相对路径要一致）。「实际路径」来自本机 `COMFY_DIR` 的真实扫描，找不到的会标 `未安装`。

| 文件名 | 模板数 | 实际路径（相对 ComfyUI 根） | 大小 |
| --- | --- | --- | --- |
| `352474e31ab5d0bf4e5da57a32b957f4.jpg` | 7 | **未安装** | — |
| `4x-UltraSharp.pth` | 2 | `models/upscale_models/4x-UltraSharp.pth` | 64 MB |
| `91cc60179b7e9830e32d96bb89ba517a.jpg` | 1 | **未安装** | — |
| `Flux.2-Klein\qwen_3_8b_fp8mixed.safetensors` | 3 | `models/text_encoders/Flux.2-Klein/qwen_3_8b_fp8mixed.safetensors` | 8.1 GB |
| `Flux\Flux.2-Klein\flux-2-klein-base-9b-fp8.safetensors` | 3 | `models/diffusion_models/Flux/Flux.2-Klein/flux-2-klein-base-9b-fp8.safetensors` | 8.9 GB |
| `Flux\flux2-vae.safetensors` | 3 | `models/vae/Flux/flux2-vae.safetensors` | 321 MB |
| `H3_Combat_V2.safetensors` | 1 | `models/loras/H3_Combat_V2.safetensors` | 148 MB |
| `MiniMax/Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors` | 1 | `models/diffusion_models/MiniMax/Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors` | 31.7 GB |
| `MiniMax/minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors` | 2 | `models/diffusion_models/MiniMax/minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors` | 19.5 GB |
| `MiniMax/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors` | 2 | `models/diffusion_models/MiniMax/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors` | 19.5 GB |
| `MiniMax\Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors` | 1 | `models/diffusion_models/MiniMax/Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors` | 31.7 GB |
| `Minimax H3真实电影质感V0.1.safetensors` | 1 | `models/loras/Minimax H3真实电影质感V0.1.safetensors` | 296 MB |
| `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` | 1 | **未安装** | — |
| `YuE2\yue2_3b_bf16.safetensors` | 2 | `models/checkpoints/YuE2/yue2_3b_bf16.safetensors` | 7.3 GB |
| `minimax\minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors` | 4 | `models/loras/minimax/minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors` | 350 MB |
| `minimax_h3_audio_vae_fp32.safetensors` | 7 | `models/vae/minimax_h3_audio_vae_fp32.safetensors` | 577 MB |
| `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` | 1 | `models/loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` | 1.8 GB |
| `minimax_h3_fl2va_pruned_w4a8_mixed.safetensors` | 1 | `models/diffusion_models/minimax_h3_fl2va_pruned_w4a8_mixed.safetensors` | 11.7 GB |
| `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors` | 2 | `models/loras/minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors` | 1.8 GB |
| `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | 2 | `models/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors` | 19.5 GB |
| `minimax_h3_video_vae_fp16.safetensors` | 5 | `models/vae/minimax_h3_video_vae_fp16.safetensors` | 4.9 GB |
| `minimax_h3_video_vae_int8_convrot.safetensors` | 2 | `models/vae/minimax_h3_video_vae_int8_convrot.safetensors` | 2.6 GB |
| `qwen-image-2.1-Q6_K.gguf` | 3 | `models/diffusion_models/qwen-image-2.1-Q6_K.gguf` | 5.5 GB |
| `qwen-image-2.1-Q8_0.gguf` | 3 | `models/diffusion_models/qwen-image-2.1-Q8_0.gguf` | 7.1 GB |
| `qwen-image-2.1-lightning-4step-int8_convrot.safetensors` | 2 | `models/loras/qwen-image-2.1-lightning-4step-int8_convrot.safetensors` | 6.8 GB |
| `qwen3vl_32b_minimax_h3_int8_convrot.safetensors` | 6 | `models/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors` | 14.6 GB |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | 1 | `models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | 14.6 GB |
| `qwen3vl_8b_int8_convrot.safetensors` | 6 | `models/text_encoders/qwen3vl_8b_int8_convrot.safetensors` | 8.7 GB |
| `qwen_image_2.1_vae_bf16.safetensors` | 6 | `models/vae/qwen_image_2.1_vae_bf16.safetensors` | 644 MB |
| `古巨基 - 情深深雨濛濛.mp3` | 1 | **未安装** | — |

## 三、按模板拆分

### flux-2-klein-文生图.json

- 节点 8 个（自定义 1）
- 依赖节点包：`(comfy_extras)`
- 资源文件：`Flux\Flux.2-Klein\flux-2-klein-base-9b-fp8.safetensors`、`Flux.2-Klein\qwen_3_8b_fp8mixed.safetensors`、`Flux\flux2-vae.safetensors`

### flux2-klein-图片编辑-单图.json

- 节点 12 个（自定义 3）
- 依赖节点包：`(comfy_extras)`
- 资源文件：`352474e31ab5d0bf4e5da57a32b957f4.jpg`、`Flux\Flux.2-Klein\flux-2-klein-base-9b-fp8.safetensors`、`Flux.2-Klein\qwen_3_8b_fp8mixed.safetensors`、`Flux\flux2-vae.safetensors`

### qwen-image-2-1图像编辑.json

- 节点 13 个（自定义 7）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-Easy-Use`、`ComfyUI-GGUF`
- 资源文件：`352474e31ab5d0bf4e5da57a32b957f4.jpg`、`qwen-image-2.1-Q8_0.gguf`、`qwen3vl_8b_int8_convrot.safetensors`、`qwen_image_2.1_vae_bf16.safetensors`

### qwen-image-2-1文生图-seedvr2自动放大.json

- 节点 11 个（自定义 5）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-GGUF`、`ComfyUI-SeedVR2_VideoUpscaler`
- 资源文件：`qwen-image-2.1-Q6_K.gguf`、`qwen3vl_8b_int8_convrot.safetensors`、`qwen_image_2.1_vae_bf16.safetensors`

### 图片放大-seedvr2.json

- 节点 7 个（自定义 5）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-SeedVR2_VideoUpscaler`
- 资源文件：`352474e31ab5d0bf4e5da57a32b957f4.jpg`

### 小枫-aicg3d-h3-中配长视频.json

- 节点 7 个（自定义 7）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-AICG3D-Integrated`
- 资源文件：`MiniMax/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors`、`MiniMax/minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors`、`qwen3vl_32b_minimax_h3_int8_convrot.safetensors`、`minimax_h3_video_vae_int8_convrot.safetensors`、`minimax_h3_audio_vae_fp32.safetensors`、`minimax\minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors`

### 小枫-aicg3d-h3-低显存长视频.json

- 节点 7 个（自定义 7）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-AICG3D-Integrated`
- 资源文件：`minimax_h3_fl2va_pruned_w4a8_mixed.safetensors`、`qwen3vl_32b_minimax_h3_int8_convrot.safetensors`、`minimax_h3_video_vae_int8_convrot.safetensors`、`minimax_h3_audio_vae_fp32.safetensors`、`minimax\minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors`

### 小枫-aicg3d-h3-长视频.json

- 节点 7 个（自定义 7）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-AICG3D-Integrated`
- 资源文件：`MiniMax/minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors`、`MiniMax/minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot.safetensors`、`qwen3vl_32b_minimax_h3_int8_convrot.safetensors`、`minimax_h3_video_vae_fp16.safetensors`、`minimax_h3_audio_vae_fp32.safetensors`、`minimax\minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors`

### 小枫-dlss5-单图增强.json

- 节点 3 个（自定义 1）
- 依赖节点包：`ComfyUI-ReActor`
- 资源文件：`352474e31ab5d0bf4e5da57a32b957f4.jpg`

### 小枫-dlss5-视频增强.json

- 节点 3 个（自定义 3）
- 依赖节点包：`ComfyUI-ReActor`、`ComfyUI-VideoHelperSuite`

### 小枫-flux2-klein-三视图工作流.json

- 节点 13 个（自定义 4）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-KJNodes`
- 资源文件：`352474e31ab5d0bf4e5da57a32b957f4.jpg`、`Flux.2-Klein\qwen_3_8b_fp8mixed.safetensors`、`Flux\Flux.2-Klein\flux-2-klein-base-9b-fp8.safetensors`、`Flux\flux2-vae.safetensors`

### 小枫-H3-导演-连贯成片.json

- 节点 7 个（自定义 3）
- 依赖节点包：`(comfy_extras)`、`ComfyUI_MiniMaxH3_Director`
- 资源文件：`minimax_h3_ref2va_pruned_int8_convrot.safetensors`、`qwen3vl_32b_minimax_h3_int8_convrot.safetensors`、`minimax_h3_video_vae_fp16.safetensors`、`minimax_h3_audio_vae_fp32.safetensors`、`minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors`

### 小枫-h3导演台-人脸修复.json

- 节点 10 个（自定义 5）
- 依赖节点包：`(comfy_extras)`、`ComfyUI_MiniMaxH3_Director`
- 资源文件：`MiniMax\Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors`、`4x-UltraSharp.pth`、`qwen3vl_32b_minimax_h3_int8_convrot.safetensors`、`minimax_h3_video_vae_fp16.safetensors`、`minimax_h3_audio_vae_fp32.safetensors`、`minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors`

### 小枫-minimaxh3-动作迁移.json

- 节点 14 个（自定义 9）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-DepthAnythingV2`、`ComfyUI-VideoHelperSuite`、`ComfyUI_MiniMaxH3_Director`
- 资源文件：`minimax_h3_ref2va_pruned_int8_convrot.safetensors`、`qwen3vl_32b_minimax_h3_int8_convrot.safetensors`、`minimax_h3_video_vae_fp16.safetensors`、`minimax_h3_audio_vae_fp32.safetensors`、`minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors`、`Minimax H3真实电影质感V0.1.safetensors`、`4x-UltraSharp.pth`、`H3_Combat_V2.safetensors`

### 小枫-qwen-image-2-1-图像编辑.json

- 节点 9 个（自定义 3）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-GGUF`
- 资源文件：`qwen-image-2.1-Q8_0.gguf`、`352474e31ab5d0bf4e5da57a32b957f4.jpg`、`91cc60179b7e9830e32d96bb89ba517a.jpg`、`qwen3vl_8b_int8_convrot.safetensors`、`qwen_image_2.1_vae_bf16.safetensors`

### 小枫-qwen-image-2-1-图编辑-4步加速版.json

- 节点 14 个（自定义 8）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-GGUF`、`Comfyui-Qwen-Image-2.1-BlockCache-T8`
- 资源文件：`qwen-image-2.1-Q6_K.gguf`、`qwen3vl_8b_int8_convrot.safetensors`、`qwen_image_2.1_vae_bf16.safetensors`、`352474e31ab5d0bf4e5da57a32b957f4.jpg`、`qwen-image-2.1-lightning-4step-int8_convrot.safetensors`

### 小枫-qwen-image-2-1-文生图-4步加速版.json

- 节点 14 个（自定义 8）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-GGUF`、`Comfyui-Qwen-Image-2.1-BlockCache-T8`
- 资源文件：`qwen-image-2.1-Q6_K.gguf`、`qwen3vl_8b_int8_convrot.safetensors`、`qwen_image_2.1_vae_bf16.safetensors`、`qwen-image-2.1-lightning-4step-int8_convrot.safetensors`

### 小枫-qwen-image-2-1-文生图.json

- 节点 9 个（自定义 2）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-GGUF`
- 资源文件：`qwen-image-2.1-Q8_0.gguf`、`qwen3vl_8b_int8_convrot.safetensors`、`qwen_image_2.1_vae_bf16.safetensors`

### 小枫-qwen3-tts-三合一整合版.json

- 节点 3 个（自定义 3）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-QWEN3_TTS`
- 资源文件：`Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`

### 小枫-yue2-歌曲创作.json

- 节点 13 个（自定义 11）
- 依赖节点包：`(comfy_extras)`、`(core)`、`XB_ToolBox`
- 资源文件：`YuE2\yue2_3b_bf16.safetensors`

### 小枫-yue2-歌曲翻唱.json

- 节点 14 个（自定义 12）
- 依赖节点包：`(comfy_extras)`、`(core)`、`XB_ToolBox`
- 资源文件：`YuE2\yue2_3b_bf16.safetensors`、`古巨基 - 情深深雨濛濛.mp3`

### 小枫-无限分段生视频.json

- 节点 8 个（自定义 8）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-AICG3D-Integrated`、`ComfyUI-AICG3D-PromptSplit`
- 资源文件：`MiniMax/Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors`、`qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`、`minimax_h3_video_vae_fp16.safetensors`、`minimax_h3_audio_vae_fp32.safetensors`、`minimax\minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors`

