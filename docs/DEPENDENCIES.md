# 依赖清单

> 由 `scripts/audit-template-deps.mjs` 生成。模板或环境变化后重新跑一次即可更新。

- 模板：**16** 个
- 核心之外的自定义节点类：**36** 个
- 需要的自定义节点包：**10** 个
- 模型 / 资源文件：**21** 个

## 一、需要安装的 ComfyUI 自定义节点包

把下面这些目录从旧机器的 `ComfyUI/custom_nodes/` 整个拷到新机器同名目录。

| 节点包目录 | 提供的节点类 |
| --- | --- |
| `ComfyUI-DepthAnythingV2` | `DepthAnything_V2`, `DownloadAndLoadDepthAnythingV2Model` |
| `ComfyUI-Easy-Use` | `easy cleanGpuUsed` |
| `ComfyUI-GGUF` | `UnetLoaderGGUF` |
| `ComfyUI-KJNodes` | `ImageConcatMulti` |
| `ComfyUI-QWEN3_TTS` | `Qwen3TTSCustomVoice`, `Qwen3TTSModelLoader` |
| `ComfyUI-ReActor` | `DLSS5FrameEnhancer` |
| `ComfyUI-SeedVR2_VideoUpscaler` | `SeedVR2LoadDiTModel`, `SeedVR2LoadVAEModel`, `SeedVR2TorchCompileSettings`, `SeedVR2VideoUpscaler` |
| `ComfyUI-VideoHelperSuite` | `VHS_LoadVideo`, `VHS_VideoCombine` |
| `ComfyUI_MiniMaxH3_Director` | `MiniMaxH3Director`, `MiniMaxH3DirectorFaceRefine`, `MiniMaxH3DirectorRefine` |
| `Comfyui-Qwen-Image-2` | `QwenImage21BlockCacheT8` |

### 随 ComfyUI 自带（无需单独安装）

- (comfy_extras)：`BasicScheduler`, `CFGGuider`, `ComfySwitchNode`, `CreateVideo`, `EmptyFlux2LatentImage`, `ImageScaleToTotalPixels`, `JoinImageWithAlpha`, `KSamplerSelect`, `ModelAttentionBackend`, `QwenImage21Cache`, `RandomNoise`, `ReferenceLatent`, `ResolutionSelector`, `SamplerCustomAdvanced`, `SaveAudioMP3`, `SaveImageAdvanced`, `SaveVideo`, `TextEncodeQwenImage21`

## 二、需要存在的模型 / 资源文件

`文件名` 是模板里写死的值，必须在新机器上放在 ComfyUI 对应目录下（相对路径要一致）。

| 文件名 | 模板数 | 推测目录 |
| --- | --- | --- |
| `352474e31ab5d0bf4e5da57a32b957f4.jpg` | 7 | ComfyUI/input（模板示例图） |
| `4x-UltraSharp.pth` | 2 | models/upscale_models |
| `91cc60179b7e9830e32d96bb89ba517a.jpg` | 1 | ComfyUI/input（模板示例图） |
| `Flux.2-Klein\qwen_3_8b_fp8mixed.safetensors` | 3 | models/checkpoints 或 diffusion_models |
| `Flux\Flux.2-Klein\flux-2-klein-base-9b-fp8.safetensors` | 3 | models/checkpoints 或 diffusion_models |
| `Flux\flux2-vae.safetensors` | 3 | models/VAE |
| `H3_Combat_V2.safetensors` | 1 | models/LORAS |
| `MiniMax\Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors` | 1 | models/checkpoints 或 diffusion_models |
| `Minimax H3真实电影质感V0.1.safetensors` | 1 | models/checkpoints 或 diffusion_models |
| `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` | 1 | models（TTS 权重目录） |
| `minimax_h3_audio_vae_fp32.safetensors` | 3 | models/VAE |
| `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` | 1 | models/LORAS |
| `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors` | 2 | models/LORAS |
| `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | 2 | models/checkpoints 或 diffusion_models |
| `minimax_h3_video_vae_fp16.safetensors` | 3 | models/VAE |
| `qwen-image-2.1-Q6_K.gguf` | 3 | models/UNET 或 models/diffusion_models |
| `qwen-image-2.1-Q8_0.gguf` | 3 | models/UNET 或 models/diffusion_models |
| `qwen-image-2.1-lightning-4step-int8_convrot.safetensors` | 2 | models/LORAS |
| `qwen3vl_32b_minimax_h3_int8_convrot.safetensors` | 3 | models/checkpoints 或 diffusion_models |
| `qwen3vl_8b_int8_convrot.safetensors` | 6 | models/checkpoints 或 diffusion_models |
| `qwen_image_2.1_vae_bf16.safetensors` | 6 | models/VAE |

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
- 依赖节点包：`(comfy_extras)`、`ComfyUI-GGUF`、`Comfyui-Qwen-Image-2`
- 资源文件：`qwen-image-2.1-Q6_K.gguf`、`qwen3vl_8b_int8_convrot.safetensors`、`qwen_image_2.1_vae_bf16.safetensors`、`352474e31ab5d0bf4e5da57a32b957f4.jpg`、`qwen-image-2.1-lightning-4step-int8_convrot.safetensors`

### 小枫-qwen-image-2-1-文生图-4步加速版.json

- 节点 14 个（自定义 8）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-GGUF`、`Comfyui-Qwen-Image-2`
- 资源文件：`qwen-image-2.1-Q6_K.gguf`、`qwen3vl_8b_int8_convrot.safetensors`、`qwen_image_2.1_vae_bf16.safetensors`、`qwen-image-2.1-lightning-4step-int8_convrot.safetensors`

### 小枫-qwen-image-2-1-文生图.json

- 节点 9 个（自定义 2）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-GGUF`
- 资源文件：`qwen-image-2.1-Q8_0.gguf`、`qwen3vl_8b_int8_convrot.safetensors`、`qwen_image_2.1_vae_bf16.safetensors`

### 小枫-qwen3-tts-三合一整合版.json

- 节点 3 个（自定义 3）
- 依赖节点包：`(comfy_extras)`、`ComfyUI-QWEN3_TTS`
- 资源文件：`Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`

