# AICG3D 分段长视频 · 完整接入

把 ComfyUI 用户工作流 `13.AICG3D_无限分段生视频1.1.1版`（40 段）接进了工作台，
拆成三个模型条目覆盖不同显卡，分辨率从 480P 到 1080P。

---

## 一、三个模型怎么选

创作台的模型下拉里能看到：

| 模型 | 分辨率 | 显存档位 | 主模型 | 适合 |
| --- | --- | --- | --- | --- |
| **MiniMax H3 长视频 · 画质优先** | 480P / 720P / **1080P** 可选 | 自动（按显卡） | int8 hybrid + fused | 20 GB 以上，要画质 |
| **MiniMax H3 长视频 · 720P 平衡** | 720P | 12G | int8 hybrid + fused | 12~20 GB，要速度 |
| **MiniMax H3 长视频 · 480P 低显存** | 480P | 8G | w4a8 剪枝 | 8~12 GB |

三个都是 **3 段串联、每段 4 秒、成片约 12 秒、带 AAC 音轨**。

### 「自动（按显卡）」是什么意思

第一个条目的显存档位是**自动**，节点会读一次显卡总显存自己决定：

```python
if total_gb >= 15.0: return VRAM_TIER_16   # 1080P 允许
if total_gb >= 11.0: return VRAM_TIER_12   # 上限 720P
return VRAM_TIER_8                          # 上限 480P
```

所以同一个模型换台机器也能跑 —— **显存不够时它会自动降到能跑完的分辨率**，
并在日志里说明降了多少，不会直接 OOM。

### 分辨率也能在界面上改

第一个模型的质量选项是 `480p / 720p / 1080p`，选了会写进模板的
`resolution` 字段。实测映射：

```
长视频 @480p  → resolution=480P
长视频 @720p  → resolution=720P
长视频 @1080p → resolution=1080P
```

后两个模型的分辨率是锁死的（单选项），因为它们的显存档位已经决定了上限。

---

## 二、工作原理

### 结构

```
加载器 ─ h3_bundle ─► 全局设置 ─ sequence_config ─► 段落1 ─► 段落2 ─► 段落3 ─► 最终合成
                        （上一段 segment ─► 下一段 previous_segment）
```

- **一个段落 = 一次完整采样 + 解码**，产出 4 秒画面。
- **段落首尾相接**，用上一段的尾部 latent 接住下一段开头。
- **最终合成**逐段解码、逐段写进同一个编码器，落成一个 mp4。

### 为什么段数不影响显存

每段跑完就释放，显存只跟**单段**有关。这是「无限分段」和「低显存」能同时成立的根因 ——
加到 40 段也只是多花时间，峰值不变。

### 省显存的五个机制

在 `custom_nodes/ComfyUI-AICG3D-Integrated/h3easy/nodes.py` 里：

```python
VRAM_PROFILES = {
    VRAM_TIER_16: MiniMaxH3VramProfile(label="16G 档", tier=VRAM_TIER_16),
    VRAM_TIER_12: MiniMaxH3VramProfile(
        max_resolution=RESOLUTION_720,
        unload_encoder_after_conditioning=True,
        unload_before_decode=True,
        preview_interval_min=2, preview_max_side=384,
    ),
    VRAM_TIER_8: MiniMaxH3VramProfile(
        max_resolution=RESOLUTION_480,
        unload_encoder_after_conditioning=True,
        unload_before_decode=True,
        preview_interval_min=4, preview_max_side=256,
        preview_rgb_only=True, allow_rgb_handoff=False,
    ),
}
```

| 机制 | 作用 |
| --- | --- |
| `max_resolution` | 画布上限，超出自动降档并打日志 |
| `unload_encoder_after_conditioning` | 文本条件算完就卸编码器（14.6 GB），采样期间不跟主干抢 |
| `unload_before_decode` | 解码前卸主干，给 VAE 腾地方 |
| `vram_policy` | 段间释放缓存 / 卸载模型 / 不处理 |
| latent 衔接 | 尾帧不重新编码，省一次完整解码 |

外加模板里挂的 `BlockSparseAttention`（`sol-attn`，`min_tokens=12288`），
ComfyUI 自带的稀疏注意力，降低长序列峰值。

---

## 三、实测数据

**RTX 3080 20GB**，同一套 3 段 × 4 秒：

| 配置 | 显存峰值 | 耗时 | 成片 |
| --- | --- | --- | --- |
| 1080P（画质优先） | 19.3 GB | **约 20 分钟** | 1920×1088 · 12.25s · 8.7 Mbps |
| 480P（低显存） | 10.3 GB | 约 3 分钟 | 864×480 · 10.1s · 2.4 Mbps |

**1080P 慢 7 倍**，这是像素量决定的（1080P 是 480P 的 6.75 倍像素），不是配置问题。

### 用 `--reserve-vram` 模拟小显存卡

同一套 480P 配置，只改 ComfyUI 启动参数：

| 显存预算 | 实际峰值 | 耗时 |
| --- | --- | --- |
| 不限制（20 GB 卡） | 19.3 GB | 170s |
| 约 12 GB | 14.4 GB | 188s |
| **约 8 GB** | **10.3 GB** | **204s** |

全部成功，慢 20%。显存曲线（8 GB 那组）：

```
2 → 3 → 10 → 10 → 10 → 10 → 9 → 10 → 10 → 10 → 10 → 3 → 7 → 10 → … → 5 → 5 → 5 GB
```

段内峰值压住，段间回落到 3~5 GB（`卸载模型` 在释放）。

> 注意第一行：20 GB 卡不限制时峰值 19.3 GB，**不代表模板需要 19.3 GB** ——
> 显存够 ComfyUI 就全驻留。所以要用 `--reserve-vram` 测才有意义。

### 各组件体积

| 组件 | 文件 | 体积 |
| --- | --- | --- |
| 主模型 int8 | `minimax_h3_hybrid_fl2va_ref2va_b25-49-int8` | 19.5 GB |
| 主模型 int4 | `MiniMax_H3_FL2VA_pruned_mixed_int4_int8_convrot` | 14.8 GB |
| 主模型 w4a8 | `minimax_h3_fl2va_pruned_w4a8_mixed` | 11.7 GB |
| 文本编码器 32B int8 | `qwen3vl_32b_minimax_h3_int8_convrot` | 14.6 GB |
| 视频 VAE fp16 / int8 | `minimax_h3_video_vae_fp16` / `_int8_convrot` | 4.9 / 2.6 GB |

---

## 四、两个踩过的坑

### 文本编码器不能换小的

试过 `qwen3vl_8b_int8_convrot`（8.9 GB，省 6 GB），节点直接报错：

```
mat1 and mat2 shapes cannot be multiplied (71x4096 and 5120x5376)
```

H3 的文本条件是 **5120 维**，8B 模型输出 4096 维。**32B 是硬要求。**
`nvfp4_awq` 那版维度对得上，但 30 系不支持原生 NVFP4，会被解量化回 bf16，峰值没变。

### UI 格式转 API 格式

工作台提交 API 格式，原文件是 UI 格式。用 ComfyUI 前端自己的 `graphToPrompt()`
转换（`scripts/ui-to-api.mjs`），比手写转换器可靠：

```
56 个 UI 节点 → 47 个 API 节点（Label / Note 被丢弃）
```

传裸 JSON 给 `loadGraphData` 会崩在 rgthree / Easy-Use 的钩子上，
必须走 workflow manager 的 `openWorkflow`。

---

## 五、怎么改

### 改分辨率

第一个模型直接在界面质量选项里选。要固定成别的档位，改模板里
`AICG3D_H3SequenceGlobal` 节点（id `78`）的 `resolution`：

```
可选：360P / 416P / 480P / 540P / 640P / 720P / 768P / 832P / 928P / 1024P / 1080P
```

### 改段数

现在 3 段。加段分三步：

1. 复制一个 `AICG3D_H3SequenceSegment` 节点，把它的 `previous_segment` 接到最后一段
2. 把 `AICG3D_H3SequenceCombine` 的 `final_segment` 指到新段
3. 把新段 id 加进 `_beatdesign.positive`（逗号分隔），提示词才会注入进去

### 改显存策略

| 参数 | 位置 | 说明 |
| --- | --- | --- |
| `vram_tier` | 全局设置节点 | `自动（按显卡）` / `16G` / `12G` / `8G` |
| `vram_policy` | 全局设置节点 | 显存够就 `释放缓存`，紧就 `卸载模型` |
| `sample_preview` | 全局设置节点 | 采样预览会额外占显存，建议 `关` |
| `steps` | 全局设置节点 | 与 DMAD 4 步 LoRA 配套，**不要改大** |
| `handoff_frames` | 全局设置节点 | H3 原生时间栅格只有 5 / 22 / 39 档 |

### 按显卡选配置

| 显存 | 建议 |
| --- | --- |
| ≥ 20 GB | 画质优先，质量选 1080p，`vram_policy` 改 `释放缓存` |
| 16 GB | 画质优先，质量选 720p |
| 12 GB | 720P 平衡 |
| 8 GB | 480P 低显存 |

---

## 六、接入改了哪些代码

| 文件 | 改动 |
| --- | --- |
| `src/core/adapters/comfyui-adapter.ts` | `positive` 支持逗号列表（多段注入同一提示词）；新增 `meta.resolution`，把界面质量映射到分辨率枚举 |
| `src/core/effects/effect-registry.ts` | 三个模型条目 |
| `src/core/effects/workspace-media.ts` | 三个素材位定义（全空，模板内部选素材） |
| `src/core/generation-providers/comfyui-provider.ts` | 三个 provider 绑定 |

### 进度显示

轮询到的进度是**按段滚动**的：

```
[18s] sampling 1/4 25%   ← 第 1 段
[30s] sampling 4/4 100%
[51s] sampling 1/4 25%   ← 第 2 段
[69s] sampling 4/4 100%
[90s] sampling 1/4 25%   ← 第 3 段
[166s] succeeded
```

**百分比从 100% 回到 25% 是正常的** —— 下一段开始了，不是重跑。

### 提交接口的一个细节

`/api/effects/generate` 的请求体是 `.strict()` 的，只接受
`version / projectId / mode / modelId / prompt / references / parameters`。
质量要放在 `parameters` 里，放顶层会 400 `unrecognized_keys`。

---

## 七、注意

- 模板里没接参考图（`media_state` 设成空数组），因为原工作流引用的是本机示例图，
  换机器就找不到。要用参考图，在模板的 `AICG3D_H3MediaLoader` 里填。
- `卸载模型` 会让每段重新加载权重，日志里反复加载是设计行为。
- 段数越多总耗时越长，但**显存峰值不变**。
