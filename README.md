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
| **素材库** | 跨项目汇总，筛选、预览、下载 |
| **回收站** | 删除进回收站而不是直接消失，可查可恢复 |

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

- Node.js 20+
- 本地运行的 ComfyUI（需要相应工作流与模型）
- Windows（当前主要开发平台）

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
