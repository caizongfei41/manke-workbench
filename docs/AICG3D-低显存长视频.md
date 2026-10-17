# AICG3D 无限分段 · 低显存长视频

本文说明 `小枫-aicg3d-h3-低显存长视频` 这个模板为什么能省显存、实测数据是多少、
以及怎么按自己的显卡调。

模板来源是 ComfyUI 用户工作流
`10.5号最新长视频/13.AICG3D_无限分段生视频1.1.1版.json`（40 段版本）。
接入工作台时压到了 3 段，并把显存相关的开关调到最省。

---

## 一、它原本是什么

那条工作流用 4 个 AICG3D 节点把「很多个短视频」串成「一条长视频」：

```
加载器 ─ h3_bundle ─► 全局设置 ─ sequence_config ─► 段落1 ─► 段落2 ─► … ─► 最终合成视频
                        （段落之间：上一段 segment ─► 下一段 previous_segment）
```

- **一个段落 = 一次完整的采样 + 解码**，产出若干秒画面。
- **段落首尾相接**：每段开头接住上一段结尾，衔接帧数在全局设置里定。
- **最终合成节点**逐段解码、逐段写进同一个编码器，最后落成一个 mp4。

关键点：**40 段不是 40 倍显存**。因为每一段跑完就释放，显存需求只跟「单段」有关，
跟段数无关。这就是「无限分段」和「低显存」能同时成立的原因。

---

## 二、省显存的五个机制

下面每一条都能在 `custom_nodes/ComfyUI-AICG3D-Integrated/h3easy/nodes.py` 里找到对应实现。

### 1. 显存档位（`vram_tier`）

节点定义了一个 `MiniMaxH3VramProfile`，`vram_tier` 下拉选择档位，默认「自动（按显卡）」：

```python
VRAM_PROFILES = {
    VRAM_TIER_16: MiniMaxH3VramProfile(label="16G 档", tier=VRAM_TIER_16),
    VRAM_TIER_12: MiniMaxH3VramProfile(
        label="12G 档",
        max_resolution=RESOLUTION_720,
        unload_encoder_after_conditioning=True,
        unload_before_decode=True,
        preview_interval_min=2,
        preview_max_side=384,
    ),
    VRAM_TIER_8: MiniMaxH3VramProfile(
        label="8G 档",
        max_resolution=RESOLUTION_480,
        unload_encoder_after_conditioning=True,
        unload_before_decode=True,
        preview_interval_min=4,
        preview_max_side=256,
        preview_rgb_only=True,
        allow_rgb_handoff=False,
    ),
}
```

自动档按显卡总显存判定：≥15 GB → 16G 档，≥11 GB → 12G 档，否则 8G 档。
**档位不是装饰**，它实际改变四件事：

| 开关 | 作用 |
| --- | --- |
| `max_resolution` | 画布上限。选 1080P 但档位是 8G，会自动降到 480P 并在日志里说明 |
| `unload_encoder_after_conditioning` | 文本条件算完就把编码器卸出显存，采样期间不跟主干抢 |
| `unload_before_decode` | 解码大张量之前先卸主干，给 VAE 腾地方 |
| `allow_rgb_handoff` | 8G 档强制 latent 衔接，避免每段多解一次码 |

### 2. 段间显存策略（`vram_policy`）

三档：`卸载模型` / `释放缓存` / `不处理`。

- **释放缓存**（默认）：缓存显存还给驱动，模型留在显存里 —— 下一段接着跑最快。
- **卸载模型**：每段跑完把权重也卸掉 —— 显存最省，代价是每段重新加载。
- **不处理**：什么都不做，只适合显存充裕时榨速度。

模板默认选了 `卸载模型`。

### 3. latent 衔接而不是 RGB

`handoff_mode` 有两档：

- **尾帧续写（latent）**（默认）：把上一段的尾部 latent 直接给下一段，**不用解码再编码**。
- **尾帧画面（RGB）**：把尾帧解码成图片再重编码成引导，画面更贴，但每段多一次完整解码。

低显存档位直接用 latent，省的不只是时间，还有那一次解码的峰值显存。

### 4. 逐段解码、单编码器合成

最终合成节点不把所有段落的帧都读进内存，而是**逐段解码、逐段写进同一个编码器**。
所以内存占用只跟单段有关，40 段也不会线性增长。

### 5. 稀疏注意力

模板里挂了一个 `BlockSparseAttention`（`sol-attn` 选择，`min_tokens=12288`），
这是 ComfyUI 自带的 `comfy_extras.nodes_sparse_attention`，跳过不重要的注意力块，
降低长序列的峰值占用。配合 `ModelAttentionBackend` 指定后端
（原工作流用 `comfy kitchen attention`）。

---

## 三、实测数据

在 **RTX 3080 20GB** 上，用 `scripts/run-template.mjs` 跑同一个模板，
只改 ComfyUI 的 `--reserve-vram` 参数来模拟不同显存：

| 显存预算 | 实际峰值 | 耗时 | 结果 |
| --- | --- | --- | --- |
| 不限制（20 GB 卡） | 19.3 GB | 170s | 成功 |
| 约 12 GB | 14.4 GB | 188s | 成功 |
| **约 8 GB** | **10.3 GB** | **204s** | **成功** |

显存曲线（每 2 秒采样，8 GB 预算那组）：

```
2 → 3 → 10 → 10 → 10 → 10 → 9 → 10 → 10 → 10 → 10 → 3 → 7 → 10 → 10 → … → 5 → 5 → 5 GB
```

能看出三件事：

1. **段内峰值 ~10 GB** —— 被压在预算内。
2. **段间回落到 3~5 GB** —— `卸载模型` 确实在释放。
3. **耗时只增加 20%** —— 省显存不是靠慢十倍换来的。

### 为什么这张 20 GB 卡不限制时峰值是 19.3 GB？

因为显存够，ComfyUI 就把权重全驻留，不需要流式加载。**显存越大，占得越多** ——
19.3 GB 不代表这个模板需要 19.3 GB。这也是为什么用 `--reserve-vram` 测才有意义。

### 各组件实际体积

| 组件 | 文件 | 体积 |
| --- | --- | --- |
| 主模型 w4a8（模板默认） | `minimax_h3_fl2va_pruned_w4a8_mixed` | 11.7 GB |
| 主模型 int4 | `MiniMax_H3_FL2VA_pruned_mixed_int4_int8_convrot` | 14.8 GB |
| 主模型 int8 | `minimax_h3_fl2va_pruned_int8_convrot` | 19.5 GB |
| 文本编码器 32B int8 | `qwen3vl_32b_minimax_h3_int8_convrot` | 14.6 GB |
| 视频 VAE int8 | `minimax_h3_video_vae_int8_convrot` | 2.6 GB |
| 视频 VAE fp16 | `minimax_h3_video_vae_fp16` | 4.9 GB |

**一个踩过的坑**：试过把文本编码器换成 `qwen3vl_8b_int8_convrot`（8.9 GB），
节点直接报错：

```
mat1 and mat2 shapes cannot be multiplied (71x4096 and 5120x5376)
```

H3 的文本条件是 5120 维，8B 模型输出 4096 维 —— **32B 编码器是硬要求，不能换小的**。
`nvfp4_awq` 那版维度对得上，但在 Ada（30 系）上不支持原生 NVFP4，会被解量化回 bf16，
体积没省下来，峰值不变。

---

## 四、接入工作台的方式

### 模板怎么来的

工作台提交的是 **API 格式**，原文件是 **UI 格式**。用 ComfyUI 前端自己的
`graphToPrompt()` 转换（`scripts/ui-to-api.mjs`），比手写转换器可靠：

```
56 个 UI 节点 → 47 个 API 节点（Label / Note 被丢弃）
```

然后压段、重接链、改显存设置，生成 9 节点的模板。

### 一个提示词怎么覆盖三段

工作台一次生成只有一个提示词，而这份模板有三个分段节点。
原来的注入逻辑只认单个节点 id，所以给 `_beatdesign.positive` 加了**逗号分隔列表**支持：

```json
"_beatdesign": {
  "positive": "107,108,109",
  "seed": "107"
}
```

`comfyui-adapter.ts` 里把 `meta.positive` 按逗号切开逐个注入，三段的 `prompt` 都拿到
界面上的那句话。实测确认：

```
[107] "a slow dolly shot through a rainy neon street at night…"
[108] "a slow dolly shot through a rainy neon street at night…"
[109] "a slow dolly shot through a rainy neon street at night…"
```

种子注入仍然只认第一个 id（`107`），后两段沿用模板里的固定种子 —— 这样三段不会
用完全相同的噪声。

### 注册的三处

新增一个本地模型要同时改三个文件，缺一个就会在运行时抛
`Missing workspace media schema`：

| 文件 | 加什么 |
| --- | --- |
| `src/core/effects/effect-registry.ts` | 模型条目（名称、比例、质量、时长） |
| `src/core/effects/workspace-media.ts` | 素材位定义（本模板不需要上传，全空） |
| `src/core/generation-providers/comfyui-provider.ts` | 绑定 `['模型 id', effectId]` |

### 进度显示

工作台轮询到的进度是**按段滚动**的：

```
[18s] sampling 1/4 25%   ← 第 1 段
[30s] sampling 4/4 100%
[51s] sampling 1/4 25%   ← 第 2 段
[69s] sampling 4/4 100%
[90s] sampling 1/4 25%   ← 第 3 段
[105s] sampling 3/4 75%
[166s] succeeded
```

看到百分比从 100% 回到 25% 是正常的 —— 那是下一段开始了，不是重跑。

---

## 五、怎么调

模板里的关键参数都在 `AICG3D_H3SequenceGlobal` 节点（id `78`）：

| 参数 | 模板默认 | 说明 |
| --- | --- | --- |
| `resolution` | `480P` | 480P / 540P / 720P / 1080P，显存主要杠杆 |
| `vram_tier` | `8G` | `自动` / `16G` / `12G` / `8G`；8G 会强制 480P 上限 |
| `vram_policy` | `卸载模型` | 显存够就改 `释放缓存`，快很多 |
| `sample_preview` | `关` | 采样预览会额外占显存 |
| `steps` | `4` | 与 DMAD 4 步 LoRA 配套，**不要改大** |
| `handoff_frames` | `22` | H3 原生时间栅格只有 5 / 22 / 39 档 |

分段数在模板里控制（当前 3 段 × 3 秒）。要加段：复制一个
`AICG3D_H3SequenceSegment` 节点，把它的 `previous_segment` 接到最后一段，
再把 `AICG3D_H3SequenceCombine` 的 `final_segment` 指到新段，
最后把新段 id 加进 `_beatdesign.positive`。

### 按显卡选配置

| 显存 | 建议 |
| --- | --- |
| ≥ 20 GB | `vram_tier: 16G`、`720P`、`vram_policy: 释放缓存` —— 最快 |
| 16 GB | `vram_tier: 16G`、`480P`、`释放缓存` |
| 12 GB | `vram_tier: 12G`、`480P`、`卸载模型` |
| 8 GB | 模板默认即可；再把主模型换成 w4a8（已经是） |

---

## 六、注意

- **主模型和 VAE 可以换小的，文本编码器不行**（5120 维是硬约束）。
- **段间 100% → 25% 是正常的**，不要当成失败重试。
- **`卸载模型` 会让每段重新加载权重**，日志里能看到反复加载，这是设计行为。
- 模板里没有接参考图（`media_state` 设成空数组），因为原工作流引用的是本机的
  示例图，换台机器就找不到。要用参考图，在模板的 `AICG3D_H3MediaLoader` 里填。
- 段数越多总耗时越长，但**显存峰值不变** —— 这是这个设计的核心价值。
