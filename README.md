# 漫客工作台

**本地优先的 ComfyUI 图像与视频创作工作台** —— 化繁为简，自由创作。

模型跑在你自己机器的 ComfyUI 上，不经过任何云端服务：没有账号，没有 API Key，素材不出本机。

![漫客工作台首页](docs/assets/home.png)

> 本项目是 [BeatDesign](https://github.com/BeatAPI/BeatDesign)（Apache-2.0）的分支，
> 加了完整的本地 ComfyUI 生成链路、中文化界面和 Windows 部署工具。
> 详见 [NOTICE](NOTICE) 与 [许可证与来源](#许可证与来源)。

---

## 特性

- **四个视图，一份项目数据**：创作台（专注生成）、画布（可视化编排）、剪辑（时间线）、素材（统一资产库）。
- **全本地推理**：ComfyUI 作为生成后端，也可以在局域网内指向另一台机器。
- **实时生成进度**：通过 ComfyUI 的 WebSocket 读取采样步数，界面显示「采样中 17% · 第 5/30 步」。
- **不做二次封装的工作流**：每个模型就是一个 ComfyUI API 格式工作流 JSON，改模板即可改行为。
- **Windows 开箱可用**：一键启动器 + GUI 启停控制台，无需常开命令行窗口。
- **中 / 英 / 日 三语界面**。

## 快速开始

### 前置条件

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 22 | 需要内置的 `WebSocket`（进度功能依赖） |
| pnpm | ≥ 10 | `npm i -g pnpm` |
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) | 0.3.x 以上 | 本机或局域网可达，默认 `http://127.0.0.1:8188` |

**关于模型与自定义节点**：仓库自带 16 个工作流模板，但它们依赖具体的 ComfyUI
自定义节点和模型权重（Qwen Image 2.1、Flux.2 Klein、MiniMax H3、SeedVR2、DLSS 等）。
这些**不在本仓库内**，需要你自己在 ComfyUI 里装好。缺节点时对应模型会标记为不可用，
不会静默失败。清单见 [支持的模型](#支持的模型)。

### 安装

```bash
git clone https://github.com/caizongfei41/manke-workbench.git
cd manke-workbench
pnpm install
```

### 指向你的 ComfyUI

编辑 `data/comfyui.config.json`（首次启动会自动生成）：

```json
{
  "baseUrl": "http://127.0.0.1:8188",
  "workflowDir": "comfyui/workflows",
  "pythonPath": "E:\\ComfyUI\\python_embeded\\python.exe"
}
```

`workflowDir` 是相对 `data/` 的路径，也可以写绝对路径。
`pythonPath` 只有 Windows 便携版需要，用于启动/停止 ComfyUI。

### 启动

```bash
pnpm build
pnpm start          # http://127.0.0.1:3020
```

Windows 也可以直接用启动器（会一并检查并拉起 ComfyUI）：

```
双击  启动工作台.bat
```

## 支持的模型

模型定义在 `src/core/effects/effect-registry.ts`，每个对应
`data/comfyui/workflows/` 下的一个工作流 JSON。

| 类型 | 模型 | 依赖的 ComfyUI 侧组件 |
| --- | --- | --- |
| 图像 | Qwen Image 2.1 文生图 / 图像编辑 | Qwen Image 2.1 权重 + 文本编码器 |
| 图像 | Qwen Image 2.1 4 步加速（文生图 / 图编辑） | 同上 + 4-step LoRA |
| 图像 | Qwen Image 2.1 文生图 + SeedVR2 放大 | 同上 + [SeedVR2](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) |
| 图像 | SeedVR2 图片放大 | SeedVR2 |
| 图像 | Flux.2 Klein 文生图 / 单图编辑 / 三视图 | Flux.2 Klein 权重 |
| 图像 | DLSS5 单图增强 | `ComfyUI-ReActor` 的 `r_dlssnr` |
| 图像 | Qwen3 TTS 三合一 | Qwen3 TTS 节点 |
| 视频 | MiniMax H3 导演 · 连贯成片 / 人脸修复 / 动作迁移 | ComfyUI-MiniMax-H3 系列节点 |
| 视频 | DLSS5 视频增强 | 同 DLSS5 |

> 用 `node scripts/validate-templates.mjs` 可以逐个检查模板与本机 ComfyUI 的匹配情况。

## 目录结构

```
src/
  core/
    adapters/comfyui-adapter.ts        ComfyUI 生成适配器（提交、轮询、模板加载）
    effects/comfyui-progress.ts        WebSocket 进度采集
    effects/effect-registry.ts         模型注册表
    generation-providers/              生成提供方（本地 ComfyUI / 云端）
  components/
    studio/                            创作台
    beatcanvas/                        画布
    editor/                            剪辑
    app/                               项目、素材、外壳
  routes/                              路由与 API
data/
  comfyui/workflows/                   工作流模板（API 格式）
  comfyui.config.json                  ComfyUI 连接配置
  local.db                             项目数据库（SQLite）
launcher/                              Windows 启动器与控制台
docs/                                  架构、部署、MCP 等文档
scripts/                               构建、测试、模板校验
```

## 开发

```bash
pnpm dev            # 开发服务器（含 HMR）
pnpm typecheck      # TypeScript
pnpm test           # 单元 / 集成测试
pnpm i18n:check     # 三语键一致性
pnpm build          # 生产构建
```

其他工具：

```bash
node scripts/validate-templates.mjs         # 检查模板与本地 ComfyUI 是否匹配
node scripts/run-template.mjs <模板名>       # 直接跑一个模板并等结果
node scripts/sweep-templates.mjs            # 串行跑全部模板，输出耗时报告
node scripts/clean-caches.mjs               # 清缓存并重建（排除"改了没生效"）
node scripts/make-app-icons.py <源图>        # 从一张方形图生成全套图标
```

## 常见问题

**选模型时提示 `workflow template not found`**
模板目录没找到。检查 `data/comfyui.config.json` 的 `workflowDir` —— 它相对 `data/` 解析。

**点「生成」后一直停在准备中**
ComfyUI 在跑但模型没加载完，或者该模板缺节点。看 `data/logs/comfyui.err.log`。

**改了代码没生效**
跑的是生产构建。`pnpm build` 后重启；怀疑缓存时执行 `node scripts/clean-caches.mjs`。

**界面显示旧内容**
HTML 已带 `no-cache`，但浏览器里已存的旧页面仍需硬刷新一次（Ctrl + F5）。

## 平台兼容性

主开发和验证环境是 **Windows 11 + 本地 ComfyUI**。
Linux / macOS 上核心功能应可用，但 `launcher\` 下的启动器与计划任务脚本是 Windows 专用的。

## 许可证与来源

- 代码：[Apache License 2.0](LICENSE)。
- 本项目是 **BeatDesign** 的分支，原作者 Copyright 2026 BeatAPI。
  按 Apache-2.0 第 4(b) 条，修改内容记录在 [NOTICE](NOTICE)。
- 「BeatDesign」「BeatAPI」是 BeatAPI 的商标。本项目仅作事实性来源说明，
  与 BeatAPI 无隶属或背书关系，详见 [docs/TRADEMARKS.md](docs/TRADEMARKS.md)。
- 第三方模型与公司名称归各自所有者。

## 致谢

界面与架构来自 [BeatDesign](https://github.com/BeatAPI/BeatDesign)。
生成能力来自 [ComfyUI](https://github.com/comfyanonymous/ComfyUI) 及其社区节点作者。
