# 漫客工作台

**本地优先的 ComfyUI 图像、视频与音乐创作工作台** —— 化繁为简，自由创作。

模型跑在你自己的机器上，不经过任何云端服务：没有账号，没有 API Key，素材不出本机。
所有视图共用同一份本地项目数据。

除了单张出图和片段生成，它还内置一条 **AI 短片流水线**：写剧本 → 定角色 → 逐段生成 →
烧字幕 → 混 BGM → 竖屏成片。中断可续跑，生成不覆盖旧版本。

界面提供**浅色 / 深色 / 跟随系统**三种主题，切换即时生效并被记住——深色看图不刺眼，
浅色写提示词更舒服。

![首页 · 浅色](docs/screenshots/home-light.png)

---

## 上手

不想读源码，只想用起来？三步：

### ① 下载程序本体

> **[夸克网盘](https://pan.quark.cn/s/48f2de0199cc)**　口令 `~c1433c0TC4~:/`
>
> 255 MB，里面是 4 个文件：
>
> | 文件 | 大小 | 说明 |
> |------|------|------|
> | `漫客工作台-单文件版-0.3.0.exe` | 119.7 MB | **推荐**。双击就跑，不写注册表，卸载直接删文件 |
> | `漫客工作台-安装版-0.3.0.exe` | 135.7 MB | 一键装到本地，装完自动启动，有开始菜单和桌面图标 |
> | `安装说明.md` | — | 完整教程，含本文所有内容 |
> | `校验清单.md` | — | 9 个部署包的 SHA256 |

两个 exe 装一个就行，功能完全一样。**共用同一份用户数据**，换着用项目不会丢。

### ② 下载部署包

> **[夸克网盘 `manke-bundles`](https://pan.quark.cn/s/e9a51632e009)**　口令 `~f34c3bzCkm~:/`
>
> **178.95 GB，9 个独立压缩包** —— 不是分卷，每个都能单独解、单独删。

| 顺序 | 文件 | 大小 | 内容 |
|------|------|------|------|
| 1 | `01-python.7z` | 3.22 GB | 便携 Python 3.13 + torch 2.13 cu130 |
| 2 | `02-comfyui.7z` | 1.02 GB | ComfyUI 本体 + 13 个节点包 + models 目录骨架 |
| 3 | `03-minimax-big.7z` | 28.56 GB | MiniMax Singularity ref2va |
| 4 | `04-minimax-a.7z` | 35.02 GB | MiniMax ref2va + fused |
| 5 | `05-minimax-b.7z` | 17.51 GB | MiniMax hybrid fl2va/ref2va |
| 6 | `06-qwen-a.7z` | 5.45 GB | Qwen-Image Q6 GGUF |
| 7 | `07-qwen-b.7z` | 17.61 GB | Qwen-Image Q8 + fl2va |
| 8 | `08-text-encoders.7z` | 27.87 GB | qwen3vl 32B / 8B 文本编码器 |
| 9 | `09-models-rest.7z` | 42.67 GB | LoRA / VAE / 放大 / 音频 / Flux / YuE |

还带 `manifest.json`（工作台靠它认包）和 `校验清单.md`。

**关键：不用等全部下完，也不用一次腾 179 GB。** 工作台的引导页有「一键部署」，
它会逐个解压，每解完一个就提示你删掉那个 `.7z` —— 磁盘峰值只需要容纳最大的
一个（42.67 GB）。

### ③ 打开工作台，跟引导走

双击打开 → 三屏引导 → 点「开始检测」→ 点「一键部署」，选压缩包放的目录 →
它逐个解压 → 解完自动指向 ComfyUI，直接能生成。

> 完整图文版：[docs/漫客工作台-完整图文教程.pdf](docs/漫客工作台-完整图文教程.pdf)

---

## 从源码构建

`src/paraglide/` 是编译产物、不入库，所以克隆后必须构建一次才有文案。

```bash
pnpm install
pnpm build
pnpm start
```

**注意**：`project.inlang/settings.json` 指向
`./node_modules/@inlang/plugin-message-format/dist/index.js`。这个包是构建期依赖，
`pnpm install` 会装好。如果构建时看到

```
ERROR [paraglide-js] SyntaxError / PluginImportError
```

说明插件没装上 —— 那一步失败时编译器**不会报错，只会产出空的语言包**，
运行时表现为每个页面 `TypeError: (void 0) is not a function` 加 500。
确认 `node_modules/@inlang/plugin-message-format/dist/index.js` 存在即可。

---

## 它长什么样

### 首页 · 深色

轮播里的每一张都是这台机器真实渲染过的作品。中间一张主图，两侧逐级收窄成扇形，随页翻动。

![首页 · 深色](docs/screenshots/home-dark.png)

### 素材库

跨项目汇总所有生成的图片、视频与音频。按类型或项目筛选，点开看大图，随时下载。

![素材库](docs/screenshots/assets.png)

### 创作台

写一句话就能开始。模型、比例、时长收在同一条工具条上，结果直接进入项目素材。

![创作台](docs/screenshots/studio.png)

### 标准画布

卡片式节点工作区：角色、场景、设定三类卡片，连线决定谁参与生成。角色卡上的参考图会随连线
进入生成流程，设定卡的文字构成提示词。

![标准画布](docs/screenshots/standard.png)

### 项目列表

![项目](docs/screenshots/projects.png)

---

## 核心能力

| 模块 | 说明 |
|---|---|
| **图像生成** | 文生图；带参考图的编辑工作流 |
| **视频生成** | H3 长视频工作流，按段生成，可续跑 |
| **音乐生成** | 本地 YuE2 模型 |
| **标准画布** | 卡片节点编辑，连线即参考，一键出图或出片 |
| **短片流水线** | 剧本 → 分镜 → 逐段生成 → 字幕 → 混音 → 成片 |
| **剪辑台** | 时间线编辑，多轨（画面/叠加/字幕/声音），导出 MP4 |
| **素材库** | 跨项目汇总，筛选、预览、下载 |
| **回收站** | 删除进回收站而不是直接消失，可查可恢复 |

### 一条真实的短片是怎么跑出来的

仓库里附带一份完整案例：[`docs/projects/消失的凶手-剧本.md`](docs/projects/消失的凶手-剧本.md)，
5 分钟悬疑短剧，55 段分镜。

剧本格式是短剧模式直接吃的：

```
【第12段｜5秒】
integrated_multimodal_description: [Shot 12] narrow corridor at night,
  medium shot 50mm, 周砚 is <Picture 1>, at a dark wooden door
0.0～1.5秒：他抬起右手准备敲门。
1.5～3.2秒：敲了两下，声音闷在走廊里。
3.2～5.0秒：手收回身侧。

overall_soundscape: 指节敲门的闷响，雨声隔着墙
non_diegetic_music: N/A
```

要点：

- `【第N段｜X秒】` 是分段的唯一依据，一段 3–8 秒
- `<Picture 1>`–`<Picture 8>` 绑定定妆照，**这是人物一致的关键**——
  三张定妆照全程挂着，同一个角色才不会每段换一张脸
- 对白只写在 `<d>[Chinese] …</d>` 里，一个段落一个说话人
- 每段都要有 `overall_soundscape`，否则环境音会断

把剧本贴进短剧模式，点「交给分镜台」会自动切段、识别角色场景道具，
给每段建生成工作台，然后逐段生成、一键合成。

---

## 技术栈

- **框架**：TanStack Start + React 19，文件式路由
- **样式**：Tailwind v4（CSS-first，`@theme inline`），设计 token 驱动双主题
- **数据**：SQLite / libsql + Drizzle
- **国际化**：Paraglide（中文 / English / 日本語）
- **生成后端**：本地 ComfyUI（默认 `127.0.0.1:8188`）
- **测试**：node:test 单元测试 + CDP 驱动的端到端验证套件

---

## 快速开始

### 前置

| 项目 | 要求 | 说明 |
|---|---|---|
| Node.js | 20+ | |
| **pnpm** | 9+ | 项目用 pnpm，不认 npm 的锁文件 |
| **ComfyUI** | 本地运行，能开 `127.0.0.1:8188` | |
| **模型** | 约 230 GB | **不在仓库里**，见[模型不随仓库分发](#模型不随仓库分发) |
| **自定义节点** | 13 个包 | 见[自定义节点](#自定义节点) |
| 显卡 | 20 GB 显存起步 | 720P 视频约需 17 GB；1080P 建议 24 GB |
| 系统 | Windows | 当前主要开发平台，Linux/macOS 未验证 |

> 只有图像功能的话门槛低很多：一张 8 GB 卡 + Qwen-Image 2.1 的 Q6 量化版就够。
> 视频和音乐才需要上面那套大模型。

### 安装

```bash
git clone git@github.com:caizongfei41/manke-workbench.git
cd manke-workbench

pnpm install
pnpm db:push        # 初始化本地数据库
pnpm dev            # http://127.0.0.1:3000
```

生产构建：

```bash
pnpm build
PORT=3020 BEATDESIGN_GENERATION_PROVIDER=comfyui pnpm start
```

### 装完先核对模型

```bash
node scripts/fetch-models.mjs
```

不报缺就说明工作流需要的模型都到位了。缺什么会直接列出来。

### 一条命令拉起整套环境

```bash
pnpm stack:up
```

会检查并启动 ComfyUI、工作台本身，以及端到端验证用的浏览器调试端口。

---

## 工作流与模型

工作流放在 `data/comfyui/workflows/`，**文件名就是模型 id**。

```
小枫-qwen-image-2-1-文生图.json      文生图
小枫-qwen-image-2-1-图像编辑.json    带参考图的编辑（声明了 image / multi_image）
小枫-无限分段生视频.json             短剧模式的默认生成器
小枫-aicg3d-h3-长视频.json           视频
```

工作流里的 `_beatdesign` 元数据告诉适配器往哪些节点注入：

```json
{
  "_beatdesign": {
    "positive": "4",       // 提示词节点
    "seed": "7",           // 随机种子
    "size": "6",           // 尺寸
    "image": "476",        // 参考图输入（仅编辑类工作流）
    "multi_image": "476"
  }
}
```

> `image_urls` 只对声明了 `image` / `multi_image` 的模板有意义；
> 文生图模板会静默忽略它，所以带参考图时模型会自动切到编辑工作流。

### 模型不随仓库分发

**这一点必须先说清楚：仓库里没有模型权重，一个都没有。**

全部模型合计 **196 GB**（最大的单个主模型 31.7 GB），GitHub 单文件上限是 100 MB，
放不进 Git，用 LFS 也不现实（免费额度 1 GB/月）。

**但整套环境有现成的部署包，不用一个一个去搜。**

### 部署包（推荐）

**9 个独立包 / 178.95 GB**，含**模型 + 13 个节点包 + 便携 Python + models 目录骨架**，
目录结构已对齐，解压即用：

> **链接**：https://pan.quark.cn/s/e9a51632e009
>
> 或打开夸克 APP 复制这段：`~f34c3bzCkm~:/`

| 顺序 | 包 | 大小 | 内容 |
|---|---|---|---|
| 1 | `01-python.7z` | 3.22 GB | 便携 Python 3.13 + torch 2.13 cu130 |
| 2 | `02-comfyui.7z` | 1.02 GB | ComfyUI 本体 + 节点包 + models 目录结构 |
| 3 | `03-minimax-big.7z` | 28.56 GB | MiniMax Singularity ref2va 31.7 GB |
| 4 | `04-minimax-a.7z` | 35.02 GB | ref2va + fused（19.5×2） |
| 5 | `05-minimax-b.7z` | 17.51 GB | hybrid fl2va/ref2va |
| 6 | `06-qwen-a.7z` | 5.45 GB | Qwen-Image Q6 GGUF |
| 7 | `07-qwen-b.7z` | 17.61 GB | Qwen-Image Q8 + fl2va |
| 8 | `08-text-encoders.7z` | 27.87 GB | qwen3vl 32B / 8B |
| 9 | `09-models-rest.7z` | 42.67 GB | LoRA / VAE / 放大 / 音频 / Flux / YuE |

### 和其他分包方案的区别

**这是 9 个独立的压缩包，不是分卷。** 每个包单独解压、单独删除，互不依赖：

| | 旧的分卷方案 | 现在 |
|---|---|---|
| 下载 | 必须全部下完才能解 | 下一个解一个 |
| 磁盘峰值 | 压缩包 211 GB + 解压 211 GB = **422 GB** | 只需容纳最大的一个 **42.67 GB** |
| 坏包重下 | 整个重来 | 只重下那一个 |
| 缺模型 | 找不出缺哪个 | 工作台逐个列出 |

### 部署方式

**推荐：用工作台的引导页。**

```
1. 打开工作台 → 引导页点「开始检测」
2. 点「一键部署」，选 9 个包放的目录
3. 它检查齐不齐 → 逐个解压 → 每解完一个提示你删掉那个包
4. 解完自动指向 ComfyUI，直接能生成
```

进度会记在 `deploy-state.json`，中断了下次能续上，已解的包会跳过。

**手动部署：**

```powershell
# 全部解到同一个目录，按 01→09 顺序
7z x 01-python.7z  -o"D:\manke"
7z x 02-comfyui.7z -o"D:\manke"
7z x 03-minimax-big.7z -o"D:\manke"
# …依此到 09
```

每解完一个就可以删掉那个 `.7z`。`manifest.json` 留着，工作台靠它认包。

### 只想要模型

包里附了 `校验清单.md`，记录全部 9 个包的 SHA256，解压失败时能定位坏包。
工作台的 `docs/DEPENDENCIES.md` 里有每个模型被几个工作流引用、该放哪个目录。

这一版按 **20 GB 显存**（RTX 3080 级别）配的，720P 视频能跑通。
显存更小的机器见 [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) 的「按显存选模型版本」。

### 或者自己逐个下

仓库提供三样东西，配合使用：

1. 工作流 JSON —— 决定了需要哪些模型
2. 完整依赖清单 —— [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md)，含每个文件的真实相对路径、大小与下载渠道
3. 核对脚本 —— `scripts/fetch-models.mjs`，告诉你现在还缺什么

### 检查缺什么

```bash
# 1. 先核对：当前缺哪些、该放哪、多大
node scripts/fetch-models.mjs

# 2. 输出一份带路径的清单，照着往里放
node scripts/fetch-models.mjs --write
# → .verify/models-checklist.md
```

脚本默认找 `E:\ComfyUI\ComfyUI`，换机器时用环境变量或参数指定：

```bash
node scripts/fetch-models.mjs --write "D:\ComfyUI"
# 或
BEATDESIGN_COMFYUI_HOME="D:\ComfyUI" node scripts/fetch-models.mjs
```

输出长这样：

```
ComfyUI: E:\ComfyUI\ComfyUI
模板引用模型 33 个
已安装 33 个，合计 234.8 GB
没有缺失
```

缺文件时会逐个列出文件名和用到它的工作流。

### 模型从哪来

这台机器上的模型来自这几类来源，按工作流分组：

| 用途 | 模型 | 大小 | 大致来源 |
|---|---|---|---|
| **视频主模型** | `Minimax-h3_Singularity_ref2va_v1.3_int8` | 31.7 GB | ModelScope / HuggingFace 的 MiniMax H3 社区量化版 |
| | `minimax_h3_ref2va_pruned_int8_convrot` | 19.5 GB | 同上，剪枝加速版 |
| | `minimax_h3_hybrid_fl2va_ref2va_b25-49-int8` | 19.5 GB | 同上，混合版 |
| **文本编码器** | `qwen3vl_32b_minimax_h3_nvfp4_awq` | 14.6 GB | Qwen3-VL 32B 的 H3 适配量化版 |
| | `qwen3vl_8b_int8_convrot` | 8.7 GB | Qwen3-VL 8B，图像工作流用 |
| **VAE** | `minimax_h3_video_vae_fp16` | 4.9 GB | MiniMax H3 官方 |
| | `minimax_h3_audio_vae_fp32` | 577 MB | 同上 |
| **加速 LoRA** | `minimax_h3_DMAD_4step` | 350 MB | DMAD 4 步蒸馏 LoRA |
| | `minimax_h3_fl2v_turbo_8step` | 1.8 GB | Turbo 8 步 |
| **图像模型** | `flux-2-klein-base-9b-fp8` | 8.9 GB | Black Forest Labs Flux.2 Klein |
| | `qwen-image-2.1-Q8_0.gguf` | 7.1 GB | Qwen-Image 2.1 社区量化 |
| **音乐模型** | `yue2_3b_bf16` | 7.3 GB | YuE2 |
| **放大** | `seedvr2_ema_3b_fp8_e4m3fn` | 3.2 GB | SeedVR2 |

完整 33 项见 [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md)。

> 这些是社区量化版，同一个模型常有多个作者的不同量化（int8 / nvfp4 / gguf）。
> **模板里写死了文件名**，换文件名就得同步改工作流 JSON，或者做个软链接。

### 自定义节点

工作流依赖 13 个自定义节点包，装到 `ComfyUI/custom_nodes/` 下：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/<author>/ComfyUI-AICG3D-Integrated
git clone https://github.com/<author>/ComfyUI_MiniMaxH3_Director
# ... 其余见 docs/DEPENDENCIES.md
```

关键的一个是 `ComfyUI-AICG3D-Integrated`，它提供 H3 系列的核心节点
（`AICG3D_H3Loader`、`AICG3D_H3SequenceGlobal`、`AICG3D_H3SequenceSegment`、
`AICG3D_H3SequenceCombine`），无限分段生视频就靠这几个。

### 显存怎么规划

这套工作流在 20 GB 显存（RTX 3080）上的实测数据：

| 分辨率 | 单段 token | 单段耗时 | 显存峰值 |
|---|---|---|---|
| 720P | 约 40,000 | 3–4 分钟 | 17 GB |
| 1080P | 约 88,000–115,000 | 8–9 分钟 | 顶到边界 |

token 数大约等于 `秒数 × 14000`。20 GB 卡的安全线在 6 万 token 左右，
所以默认分辨率给的是 **720P** —— 先保证跑得完，要细节再往上调。

「显存档位」是第二道闸：选「12G」会把画布封顶 720P，「8G」封顶 480P。
要在 20 GB 卡上跑 1080P，得把档位手动设成「16G」。

---

## 验证

每个界面行为都有对应的验证套件，直接驱动真实浏览器去测量，而不是读代码猜。

```bash
pnpm test           # 单元测试
pnpm verify:ci      # 端到端套件（不需要 GPU）
pnpm verify:gpu     # 需要 ComfyUI 的生成类套件
pnpm verify:all     # 全部
```

单套运行：

```bash
pnpm verify:one standard-canvas
```

验证脚本在 `scripts/e2e/`，标注 `// @needs: comfyui` 的套件需要本地模型服务。

---

## 项目结构

```
src/
  components/
    marketing/        首页、外壳、展示轮播
    studio/           创作台
    beatcanvas/       画布基础组件
    standard/         标准画布
    drama/            短片流水线
    assets/           素材库
    app/              工作台外壳与路由装配
  core/
    adapters/         ComfyUI 适配器
    effects/          生成提交、状态轮询
    standard-canvas/  画布文档模型
    showcase/         首页展示策展逻辑
    projects/         项目与快照
  routes/             文件式路由（含 /api）
  styles/             设计 token 与全局样式
scripts/
  e2e/                端到端验证套件
  generate-showcase*  首页展示素材生成
data/
  comfyui/workflows/  ComfyUI 工作流
  project-assets/     项目素材
  trash/              回收站
```

---

## 数据与隐私

- 生成、素材、项目数据全部在本机
- 不上传云端，不需要账号
- 删除先进回收站（`data/trash/`），可审计
- 隐私相关的操作不产生任何外部请求

---

## 关于

漫客工作台基于 [BeatDesign](https://github.com/Scenth/BeatDesign) 二次开发，在原有画布体验之上
增加了本地 ComfyUI 提供方、标准画布、短片流水线与一套完整的双主题设计系统。

## 许可证

MIT
