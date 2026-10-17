# 漫客工作台（本机部署说明）

ComfyUI 无线画布 = [BeatDesign](https://github.com/BeatAPI/BeatDesign) 的本地优先 AI 创作工作台，
本仓库是接入**本地 ComfyUI** 的分支：图像/视频/语音生成与增强全部走本机显卡，不需要任何 API Key。

- 工作台：http://127.0.0.1:3020
- ComfyUI：http://127.0.0.1:8188

---

## 三个入口，用途不同

| 入口 | 位置 | 用途 |
| --- | --- | --- |
| **漫客工作台 控制台** | **桌面快捷方式** | **日常用这个**：一键启停两个服务，看状态 |
| `服务控制台.bat` | 项目根目录 | 同上（快捷方式失效时的备份入口） |
| `检查服务状态.bat` | 项目根目录 | 只读自检，排查「没起来」时用 |

日常流程：开机 → 双击桌面控制台 → 点「全部启动」→ 等两个都变绿 → 点「打开工作台」。

启动耗时：工作台约 3 秒，ComfyUI 约 25～45 秒（要加载模型），
期间状态显示「启动中…」属正常。

---

## 备用启动器（`启动工作台.bat`）

控制台之外还保留一个纯命令行的启动器：双击项目根目录的
**`启动工作台.bat`**（脚本本体在 `launcher\start-workbench.ps1`）。

它按顺序执行：自检 Node 与构建产物 → 清理 ComfyUI 残留进程 → 拉起 ComfyUI →
拉起工作台 → 等待两个端口就绪 → 打开浏览器。**不走计划任务**，直接起进程；
已运行的端口会跳过，可重复执行。

> **修复记录（两个会让启动器静默失效的缺陷）**
>
> 1. `启动工作台.bat` 原先用 `%~dp0start-workbench.ps1` 定位脚本，即**与 bat 同目录**。
>    但 ps1 实际在 `launcher\` 子目录，双击后 PowerShell 只会报「找不到文件」——
>    什么都不发生。已改为 `%~dp0launcher\start-workbench.ps1`。
> 2. 启动器原来通过 `call run_nvidia_gpu.bat` 拉起 ComfyUI。那个 bat **结尾有 `pause`**，
>    而启动器把窗口藏起来了，所以一旦 ComfyUI 退出或启动失败，窗口会**永久卡在等待按键**上
>    且没有任何提示。已改为直接调用 `python_embeded\python.exe`，与计划任务
>    `BD-ComfyUI` 使用完全相同的命令行（也补上了此前只有任务里才有的
>    `HF_ENDPOINT` / `HF_HUB_DISABLE_TELEMETRY`）。

---

## 服务控制（桌面控制台）

**服务不随开机启动**，需要时用桌面上的「漫客工作台 控制台」手动启停。

### 桌面控制台

双击桌面 **「漫客工作台 控制台」**，打开一个小窗口：

| 区域 | 作用 |
| --- | --- |
| 状态行 | 两个服务的实时状态（绿=运行中，黄=启动中，灰=已停止），每 3 秒自动刷新 |
| 每行的「启动 / 停止」 | 单独控制一个服务 |
| 「全部启动 / 全部停止」 | 一键启停两个服务 |
| 「刷新 / 打开工作台」 | 手动刷新状态、在浏览器打开工作台 |
| 日志框 | 显示每一步做了什么 |

脚本本体：`launcher\service-console.ps1`（也可双击项目根目录的 `服务控制台.bat`）。

**手动启动大约需要**：工作台 3 秒；ComfyUI 25～45 秒（要加载模型），
期间状态显示「启动中…」属正常。

### 计划任务（由控制台调用）

控制台不是直接拉起进程，而是调用两个计划任务——这样日志重定向、隐藏窗口、
失败重试都集中在任务定义里：

| 任务 | 端口 | 日志 | 触发器 |
| --- | --- | --- | --- |
| `BD-ComfyUI` | 8188 | `data\logs\comfyui.log` / `.err.log` | **无**（只能手动启动） |
| `BD-Workbench` | 3020 | `data\logs\workbench.log` / `.err.log` | **无**（只能手动启动） |

两者都以 `SYSTEM` + `RunLevel Highest` 运行，配置了 `ExecutionTimeLimit=PT0S`（不限时）
和 `DisallowStartIfOnBatteries=false`。

等价的手工命令：

```powershell
# 启动 / 停止
Start-ScheduledTask -TaskName 'BD-ComfyUI'
Stop-ScheduledTask  -TaskName 'BD-ComfyUI'

# 停止时还要杀进程：Stop-ScheduledTask 只结束任务本身，
# 任务里 cmd 拉起的 python / node 子进程会留下来继续占端口
$p = (Get-NetTCPConnection -State Listen -LocalPort 8188).OwningProcess
taskkill /PID $p /T /F

# 状态
Get-ScheduledTask -TaskName 'BD-ComfyUI','BD-Workbench' | Select-Object TaskName,State
```

任务定义 XML 备份在 `launcher\tasks-backup\`：

| 文件 | 说明 |
| --- | --- |
| `BD-ComfyUI.xml` | 最初拿到的定义（一次性时间触发器，指向已过去的时刻） |
| `BD-ComfyUI.boot.xml` | 曾经的开机自启版本（`BootTrigger`），现未使用 |
| `BD-Workbench.xml` | 曾经的开机自启版本，现未使用 |
| `BD-ComfyUI.manual.xml` | **当前生效**（`<Triggers />`，仅手动） |
| `BD-Workbench.manual.xml` | **当前生效**（`<Triggers />`，仅手动） |

> **想改回开机自启**：用 `BD-*.boot.xml` 重新注册即可
> （`schtasks /create /tn BD-ComfyUI /xml ... /f`）。
> 前提是 Windows 的「快速启动」处于关闭状态，否则开机属于「混合启动」，
> `BootTrigger` 有概率不触发。本机已确认关闭。

> **踩过的坑**：`Stop-ScheduledTask` **不会**结束任务拉起的子进程。
> 停止后端口仍被占用的原因就在这里，必须按端口找到 PID 再 `taskkill /T /F`。

> **改了源码必须重新构建**：工作台跑的是生产构建
> （`.output\server\index.mjs`），直接改 `src\` 下的文件不会生效。流程是
> 停服务 → `pnpm build` → 启服务。构建时如果服务还在跑，会因
> `.output\server\node_modules\@libsql\...\index.node` 被占用而报 `EPERM`。

### 为什么用 SYSTEM 而不是当前用户

计划任务以 `SYSTEM` 运行意味着不依赖谁登录。已确认 `SYSTEM` 对以下路径有
`FullControl`，所以数据库与媒体资产可正常读写：

```
data\             ← SQLite 在这里创建 -wal / -journal
data\local.db
data\logs\
data\project-assets\
```

验证方法（创建一个只跑一次的临时任务，写入探测文件后删除）：

```powershell
# 确认能写 data\ 目录（SQLite 写 WAL 的位置就在这里）
# 若能创建 data\_probe.txt，说明 SYSTEM 具备写权限
```

---

## 环境与版本

| 组件 | 要求 | 本机 |
| --- | --- | --- |
| Node.js | ≥ 22 | v24.21.0 |
| pnpm | ≥ 10 | 10.32.1（corepack） |
| ComfyUI | Windows 便携版 | `E:\ComfyUI`，0.37.0，2936 个节点 |
| GPU | — | RTX 3080 20 GB |

首次安装：

```powershell
corepack enable
corepack prepare pnpm@10.32.1 --activate
$env:CI = 'true'          # 允许 pnpm 重建 node_modules
pnpm install
pnpm db:setup
pnpm db:push
pnpm build
```

开发模式：`pnpm dev` / `pnpm dev:agent` / `pnpm mcp`。

---

## 路径配置

| 用途 | 位置 | 当前值 |
| --- | --- | --- |
| 工作台根目录 | `launcher\start-workbench.ps1` 的 `$bd` | `<项目根目录>` |
| ComfyUI 目录 | 同上 `$comfy` | `E:\ComfyUI` |
| Node 目录 | `BEATDESIGN_NODE_DIR`，否则脚本内 `$nodeDir` | `C:\Program Files\nodejs` |
| ComfyUI 地址 / Python | `data\comfyui.config.json` | `http://127.0.0.1:8188`、`E:\ComfyUI\python_embeded\python.exe` |
| 服务端兜底 | `src\core\services\service-manager.ts` | `DEFAULT_COMFYUI_ROOT = E:\ComfyUI` |

---

## 品牌：名称与图标

当前名称 **漫客工作台**（英文 Manke，日文 漫客ワークベンチ）。

### 名称定义在 4 处

| 位置 | 内容 |
| --- | --- |
| `src\config\index.ts` | `app_name` —— 界面页头文字、浏览器标签标题的来源 |
| `src\core\services\service-manager.ts` | 服务列表里工作台那一条的 `label` |
| `messages\zh.json` / `en.json` / `ja.json` | 页头副标题、`product.home.metaTitle` 等界面文案 |
| `启动工作台.bat`、`launcher\start-workbench.ps1` | 控制台窗口标题与启动器横幅 |

改完**必须重新构建**（`pnpm build`）才生效，因为跑的是生产构建。

**注意 i18n 检查器的约束**：`scripts\check-i18n.mjs` 会扫描
`src\routes\**` 和 `src\components\**`，只要出现中文就判失败（防止硬编码界面文案）。
所以这些目录下的**注释也要用英文**——曾经因为汉化注释里的注释文字而被拦下。
`src\core\**` 不在扫描范围内。

### 图标

三份图标都由同一张方形源图生成，保留在 `assets\branding\app-icon-source.jpg`：

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `public\logo.png` | 300×300 | 页头 logo（渲染为 28px 圆角方块） |
| `public\apple-touch-icon.png` | 180×180 | iOS 主屏图标 |
| `public\favicon.ico` | 16/32/48/64/128/256 六种尺寸 | 浏览器标签图标 |

换图标只要替换源图后重跑（原件自动备份为 `*.bak`）：

```powershell
E:\ComfyUI\python_embeded\python.exe scripts\make-app-icons.py 新的方形图.jpg
pnpm build
```

脚本用随 ComfyUI 附带的 Python + Pillow 生成（项目没有安装 Node 图像库）。
非方形输入会先被居中裁剪成方形，避免缩放变形。

> 界面里还有一处 `public\xiaofeng-wechat-qr.png`（右下角微信二维码）。
> 文件名保留了旧前缀，但图片本身是纯二维码、无品牌字样，且文件名不出现在界面上，
> 所以没有一并改动。

---

## 网络与镜像

本机 **GitHub 与 huggingface.co 直连不通**，hf-mirror 与 gh-proxy 可用：

| 用途 | 可用通道 |
| --- | --- |
| ComfyUI 自定义节点 | `https://gh-proxy.com/https://github.com/<owner>/<repo>/archive/refs/heads/main.zip` |
| 模型权重 | `https://hf-mirror.com/<repo>/resolve/main/<file>` |
| Python 包 | `pip install -i https://pypi.tuna.tsinghua.edu.cn/simple <pkg>` |
| 运行时模型下载 | 环境变量 `HF_ENDPOINT=https://hf-mirror.com`（已写入 `BD-ComfyUI` 任务） |

---

## 已启用的 16 个模型（全部实测通过）

模板位于 `data\comfyui\workflows\`。下表为**一次连续跑完 16 个**的实测数据
（合计 22.8 分钟，平均 85 秒），每个模板都确认产出了文件：

| 模板 | 能力 | 实测 | 产出 |
| --- | --- | --- | --- |
| `小枫-dlss5-单图增强` | DLSS5 图像增强 | 9s | png |
| `小枫-dlss5-视频增强` | DLSS5 视频增强（带音轨） | 16s | mp4 |
| `小枫-qwen-image-2-1-文生图-4步加速版` | Qwen 文生图 + 4 步加速 | 21s | png |
| `小枫-qwen-image-2-1-图编辑-4步加速版` | Qwen 图像编辑 + 4 步加速 | 22s | png |
| `flux-2-klein-文生图` | Flux.2 Klein 文生图 | 28s | png |
| `flux2-klein-图片编辑-单图` | Flux.2 Klein 图像编辑 | 42s | png |
| `小枫-qwen3-tts-三合一整合版` | Qwen3 TTS 语音合成 | 49s | mp3 ×2 |
| `图片放大-seedvr2` | SeedVR2 图像放大 | 51s | png |
| `qwen-image-2-1文生图-seedvr2自动放大` | 文生图 + SeedVR2 放大到 2048 | 81s | png ×2 |
| `小枫-qwen-image-2-1-文生图` | Qwen Image 2.1 文生图 | 90s | png |
| `小枫-qwen-image-2-1-图像编辑` | Qwen 图像编辑（小枫版） | 118s | png |
| `qwen-image-2-1图像编辑` | Qwen 图像编辑（双图） | 125s | png |
| `小枫-flux2-klein-三视图工作流` | 参考图生成三视图 + 特写拼图 | 148s | png |
| `小枫-H3-导演-连贯成片` | MiniMax H3 文生视频 | 159s | mp4 |
| `小枫-h3导演台-人脸修复` | H3 导演台 + 人脸修复二采 | 200s | mp4 ×2 |
| `小枫-minimaxh3-动作迁移` | H3 动作/运镜迁移 | 207s | mp4 ×3 |

验证命令：

```powershell
node scripts\validate-templates.mjs          # 静态校验（对照 /object_info，不入队）
node scripts\run-template.mjs <模板名>        # 真实跑一次（无产出即失败）
node scripts\sweep-templates.mjs             # 连续跑完全部 16 个并留存报告
node scripts\audit-workbench-gaps.mjs        # 界面可见性 / 模型文件 / 注册表缺口
node scripts\audit-model-usage.mjs           # 哪些模型文件没被任何模板引用
```

> `run-template.mjs` 与 `sweep-templates.mjs` 都会把**报成功但没有产出文件**判为失败。
> 只看 ComfyUI 的 `success` 是不够的 —— 图被剪枝时它照样返回成功（见下文
> `easy imageSize` 陷阱）。实测报告留存于 `data\logs\template-sweep.json`。

---

## 模型要出现在界面上，光有模板文件不够

`data\comfyui\workflows\<modelId>.json` 存在**只代表能跑**。界面列不列出来由
`model-catalog.ts` 决定：

```ts
const entry = getWorkspaceEffectRegistryEntry(binding.modelId);
if (!entry) return [];        // 静默丢弃，界面上看不到
```

所以一个模型要能用，三处都得齐：

| 位置 | 作用 | 缺了会怎样 |
| --- | --- | --- |
| `src\core\generation-providers\comfyui-provider.ts` | 绑定 modelId → effectId | 界面不出现 |
| `src\core\effects\effect-registry.ts` | 名称、路由、宽高比、时长 | **界面不出现**（静默丢弃） |
| `data\comfyui\workflows\<id>.json` | 实际工作流 | 界面出现，点了报 `template not found` |
| `src\core\effects\workspace-media.ts` | 参考图/视频槽位 | 渲染时报错 |

**本次补齐**：9 个模板原本只差注册表条目（模板本身实测通过），补上后界面本地模型
从 7 个变成 **16 个**。

**本次清理**：`COMFYUI_MODEL_BINDINGS` 里移除了 9 个云端模型
（nano-banana / gpt-image / seedream / grok-imagine）。本工作区只注册 ComfyUI
provider，这些 id 在本地没有模板，显示出来点了必然报错。
另外 `minimax-h3` / `minimax-h3-max` / `minimax-h3-max-turbo` 也注释掉了
（注册表有条目但缺模板文件）——拿到网盘里的模板后取消注释即可。

自查界面实际暴露的模型：

```powershell
Invoke-RestMethod 'http://127.0.0.1:3020/api/app/effects/models' |
  ForEach-Object { $_.models ?? $_ } | Select-Object id, workspaceType
```

---

## 三视图工作流为何一度无法运行（已修复）

`小枫-flux2-klein-三视图工作流` 早期被隔离，当时的判断是「功能节点都是私有 UUID
节点，无法映射」。真实原因不同：

那 6 个 UUID 是 **ComfyUI 子图（subgraph）实例**，不是自定义节点。子图定义存放在
工作流的 `definitions.subgraphs` 里，而项目自带的是一份 **API 格式导出，导出过程
丢失了全部子图定义**——所以只剩一堆指向空定义的 UUID 引用。

修复方式是用 ComfyUI 前端自己的展开逻辑做转换（不要手写展开器）：

```powershell
# 1) 在 ComfyUI 里载入 UI 格式工作流并调用 graphToPrompt() 展开子图
node scripts\convert-klein-workflow.mjs

# 2) 改为可本地运行：删孤立节点、改模型路径、PreviewImage→SaveImage、写 _beatdesign
node scripts\adapt-klein-threeview.mjs

# 3) 校验 + 实测
node scripts\validate-templates.mjs
node scripts\run-template.mjs 小枫-flux2-klein-三视图工作流.json
```

输出为 2640×1024 拼图（3 个全身视角 640×1024 + 1 个特写 720×1024，横向拼接）。

**两个必须注意的点**：

1. **中间 `PreviewImage` 有透传输出**。该工作流的拼接链是
   `VAEDecode → PreviewImage → ImageConcatMulti`，直接删掉预览节点会断链并报
   `exception_during_inner_validation`。删除时必须把下游重连到预览的上游节点。
2. **该模板的四个分支各带固定提示词**（正面 / 背面 / 侧面全身 + 特写），不是用户输入。
   因此 `_beatdesign.positive` 被指向一个**不存在的节点 id**（`__fixed_prompts__`）：
   BeatDesign 的注入逻辑在 `positive` 为空时会回退到「覆写第一个 CLIPTextEncode」，
   会把正面视角的指令冲掉。指向不存在的节点即可让注入静默跳过。

工作区里保留了两份供日后重新导出：

| 文件 | 格式 |
| --- | --- |
| `workflows.backup-orig\小枫-flux2-klein-三视图工作流.ui.json` | 作者原始 UI 格式（含子图定义） |
| `workflows\小枫-flux2-klein-三视图工作流.json` | 展开后的 API 格式（可运行） |

---

## ⚠ 一个会「假成功」的陷阱：`easy imageSize`

**症状**：模板提交后 **3 秒就报 SUCCESS**，但 `output/` 里没有任何文件。

**原因**：ComfyUI-Easy-Use 把 `easy imageSize` 注册成了
**输出节点**（`/object_info` 里 `output_node: true`）。而模板里它同时又是
`EmptyFlux2LatentImage.width/height` 的上游。这种「既是输出节点、又是别人的上游」
的组合会让 ComfyUI 只执行它自己的子图，**把 SaveImage 那条分支整体剪掉**——
执行成功、状态 success、零产出。

这条分支根本没跑，所以看不到任何报错，只有比对 ComfyUI 的 history 才会发现
`outputs` 里只有 `easy imageSize` 一个节点。

**正确替代是核心节点 `GetImageSize`**：

| 节点 | output_node | 输出 |
| --- | --- | --- |
| `easy imageSize`（Easy-Use） | **true** ← 会触发剪枝 | `[width, height]` |
| `GetImageSize`（核心） | **false** | `[width, height, batch_size]` |

两者索引 0/1 都是宽高，所以**直接替换即可，无需改动下游索引**。

排查方法（对着 ComfyUI 的 history 看实际执行了哪些节点）：

```powershell
# 取某次提交的 outputs，正常应该包含 SaveImage 的节点号
$id = '<prompt_id>'
(Invoke-RestMethod "http://127.0.0.1:8188/history/$id").$id.outputs.PSObject.Properties.Name
# 若只列出 easy imageSize 的数字而没有 SaveImage 的数字，就是这个陷阱
```

`scripts\run-template.mjs` 现在会在「报成功但没有产出文件」时显式失败并打印
`NO OUTPUT — the run reported success but produced no file`，
`scripts\sweep-templates.mjs` 也据此判定，避免再出现假成功。

---

## ⚠ 显存争用：SeedVR2 放大模板的稳健性设置

**症状**：`qwen-image-2-1文生图-seedvr2自动放大` 单独在刚启动的 ComfyUI 上跑
约 **100 秒**；但如果在它之前跑过别的模型族（先把 Qwen 模型加载进显存），
它会陷进 **极慢状态**——日志长时间不推进，GPU/CPU 都满载，一次实测卡了
**16 分钟以上**仍未完成。

**原因**：模板原本的 SeedVR2 参数是

| 参数 | 原值 | 含义 |
| --- | --- | --- |
| `SeedVR2LoadDiTModel.offload_device` | `none` | 3B DiT 常驻显存，不空闲卸载 |
| `SeedVR2LoadVAEModel.offload_device` | `none` | VAE 也常驻 |
| `encode_tiled` / `decode_tiled` | `False` | VAE 不分块，峰值显存更高 |

三者叠加的结果是：SeedVR2 的模型必须**和已经加载的 Qwen GGUF + 文本编码器
同时挤进 20 GB**，一旦放不下就退化成反复换入换出。

**修复**（`data\comfyui\workflows\qwen-image-2-1文生图-seedvr2自动放大.json`）：

```jsonc
"23": { "inputs": { "offload_device": "cpu" } },          // DiT 空闲时卸载到内存
"24": { "inputs": {
  "offload_device": "cpu",
  "encode_tiled": true,
  "decode_tiled": true,
  "encode_tile_size": 512,
  "decode_tile_size": 512
} }
```

**效果**：先跑 Qwen 文生图占住显存，再跑该模板 ——

| | 修复前 | 修复后 |
| --- | --- | --- |
| 耗时 | 卡死 >16 分钟未完成 | **78 秒** |
| 产出 | 无 | 原图 + `seedvr2_upscaled_*.png` |

分块后的输出为 **2048×2048 RGBA 6163 KB**，与非分块版的 6248 KB 基本一致，
画质无明显接缝劣化。

> 这条经验可以推广：任何把大模型和别族模型混跑的工作流，都应检查
> `offload_device` 是否设为 `none`。`none` 在独占显存时最快，但在共享显存时
> 会退化成抖动。

---

## ⚠ 界面报「workflow template not found」的根因（已修复）

**症状**：界面里选任何模型都提交失败，报

```
ComfyUI workflow template not found for model "…".
Expected <项目根目录>\comfyui\workflows\….json
```

注意期望路径 **少了 `data\`** —— 实际模板在 `data\comfyui\workflows\`。

**根因**在 `comfyui-adapter.ts` 的 `loadConfig()`：

```ts
// 修复前
const workflowDir =
  process.env.BEATDESIGN_COMFYUI_WORKFLOW_DIR?.trim() ||
  fileConfig.workflowDir?.trim() ||                     // ← "comfyui/workflows"，未拼接基准
  resolve(await resolveDataRoot(), DEFAULT_WORKFLOW_RELATIVE_DIR);   // ← 只有这行才拼
```

`data\comfyui.config.json` 里的 `workflowDir` 是相对路径 `"comfyui/workflows"`，
本应与兜底值同样相对于 data 目录，却被直接交给 `path.resolve` 使用 ——
等于按 `process.cwd()`（项目根）解析，少了一层 `data\`。

**修复**：

```ts
// 修复后：配置里的相对路径也按 dataRoot 解析
const dataRoot = await resolveDataRoot();
const configuredWorkflowDir = fileConfig.workflowDir?.trim();
const workflowDir =
  process.env.BEATDESIGN_COMFYUI_WORKFLOW_DIR?.trim() ||
  (configuredWorkflowDir
    ? resolve(dataRoot, configuredWorkflowDir)
    : resolve(dataRoot, DEFAULT_WORKFLOW_RELATIVE_DIR));
```

`path.resolve` 遇到绝对路径会直接返回它，所以配置里写绝对路径依然有效。

### 教训：这个 bug 逃过了之前的全部验证

`scripts\run-template.mjs` 是**直接读模板文件、直接提交给 ComfyUI**，完全绕过了
应用自己的路径解析逻辑。所以：

| 验证手段 | 覆盖的路径 | 是否发现此 bug |
| --- | --- | --- |
| `validate-templates.mjs` | 只查节点/模型是否可用 | ✗ |
| `run-template.mjs` | 绕过应用，直连 ComfyUI | ✗ |
| `sweep-templates.mjs` | 同上，只是批量 | ✗ |
| **`check-ui-generation.mjs`** | **走应用自己的接口** | **✓** |

**结论：能跑通的不等于用户点得动。** 验证必须至少覆盖一次应用自己的入口。
现在补了两个脚本：

```powershell
# 提交 + 轮询到结束，验证完整链路（含产出资源可下载）
node scripts\check-ui-e2e.mjs 小枫-qwen-image-2-1-文生图-4步加速版

# 只验证模板能否被找到（快，不下完整生成）
node scripts\check-ui-generation.mjs
```

实测结果：`HTTP 200` → `status: succeeded` → 产出资源落盘到
`data\project-assets\…`，接口返回 `image/png` 2 MB。

> 这两个脚本都要带 `x-beatapi-workspace-request: 1` 请求头和同源 `origin`，
> 否则会被 `validateTrustedWorkspaceJsonMutation` 以 403 拒绝。
> 状态查询的参数名是 **`wmTaskId`**（工作台自己的记录 id），
> 不是 ComfyUI 的 `promptId`。

---

## 生成进度显示（采样步数 + 百分比）

生成进行中时，创作台列表里那条记录会显示：**阶段名 + 百分比 + 进度条 + 第 N/M 步**，
而不是只有一个转圈。

![示例] 采样中 17% ／ 进度条 ／ 第 5/30 步

### 进度从哪来

ComfyUI 的进度**只在 WebSocket 上推**：

```json
{"type":"progress","data":{"value":5,"max":30,"prompt_id":"…","node":"6"}}
{"type":"executing","data":{"node":"6","prompt_id":"…"}}
```

HTTP 接口没有任何进度信息，`/history` 只在任务结束时才出现。所以新增了
`src\core\effects\comfyui-progress.ts`：一条常驻 WebSocket，按 `prompt_id` 记录
`value/max`，供状态接口和列表接口同步读取。

### ⚠ 关键点：`client_id` 必须一致

ComfyUI 把 `progress` / `executing` 事件**只发给提交时 `client_id` 对应的那个 socket**。

适配器提交时带的是 `client_id: 'beatdesign'`（`comfyui-adapter.ts`）。
进度模块最初连的是 `beatdesign-随机串` —— **socket 连上了，但一个事件都收不到**，
界面永远停在「准备中」。这个坑很隐蔽：连接是成功的，只是消息被路由到了别的 sid。

现在两端共用同一个常量 `COMFYUI_CLIENT_ID`（定义在 `comfyui-progress.ts`，
适配器 import 它），改一处即可。

> 排查手法：直接连 `/ws?clientId=<某个id>` 并提交任务，看有没有事件。
> 换个 id 就没事件，说明路由到了别处。

### 阶段名怎么来的

WebSocket 的 `executing` 事件只给**节点 id**，不给节点类型，所以阶段名只能按已知信号推断：

| 事件 | 显示的阶段 |
| --- | --- |
| `execution_start` | 排队中 |
| 任何 `executing` | 准备中 |
| 第一次 `progress` | **采样中**（带 N/M 步） |
| 尚无任何事件 | 准备中 |

`progress` 只会由采样类节点发出，所以「采样中」这个判断是可靠的。

### 前端怎么刷新的

不需要额外改动：`beat-studio-workspace.tsx` 本来就在有 pending/processing 条目时
每 **2.5 秒**轮询一次列表接口，进度字段随之更新。

### 服务端改了哪些文件

| 文件 | 改动 |
| --- | --- |
| `src\core\effects\comfyui-progress.ts` | 新增：WebSocket 监听 + 进度快照表 |
| `src\core\adapters\comfyui-adapter.ts` | 提交用共享常量 `COMFYUI_CLIENT_ID` |
| `src\core\effects\project-generations.ts` | 列表条目增加 `progress` 字段 |
| `src\routes\api\effects\status.ts` | 状态接口增加 `progress` 字段 |
| `src\components\studio\studio-generation-feed.tsx` | 渲染阶段名 / 百分比 / 进度条 / N/M |
| `messages\{zh,en,ja}.json` | 新增 7 个进度文案键（各语言键数一致） |

### 验证

```powershell
# 提交一个耗时任务，逐秒打印进度状态（会看到 1/30 → 30/30 → 20/100 → 100/100）
node scripts\check-progress.mjs qwen-image-2-1文生图-seedvr2自动放大

# 边连 WS 边提交，看 ComfyUI 实际推了哪些事件
node scripts\probe-progress-events.mjs qwen-image-2-1文生图-seedvr2自动放大
```

实测：一次「文生图 + SeedVR2 放大」观察到 **37 种进度状态**，
两段采样（30 步 + 100 步）都正确显示。

> 注意：模板里提示词往往写死在节点中，提交时改 prompt 不会改变工作流，
> ComfyUI 会直接命中缓存、1～2 秒完成 —— 这种情况下看不到进度是正常的。
> 想验证进度要选一个必然重算的模型（如带 SeedVR2 放大的）。

---

## 界面全量验证（自动化点测）

用 CDP 驱动一个独立浏览器实例，把 7 个视图里的**每个可交互元素都点一遍**，
捕获控制台错误、失败请求和画面变化。

### 怎么跑

```powershell
# 1) 起一个带调试端口、独立配置目录的浏览器（不影响日常浏览器）
$q = "$env:LOCALAPPDATA\Programs\Quark\Quark.exe"
& cmd /c "start `"`" `"$q`" --remote-debugging-port=9224 --user-data-dir=`"$env:TEMP\quark-ui-test`" about:blank"

# 2) 侦察：枚举各视图的交互元素
node scripts\ui-recon.mjs <projectId>

# 3) 全量点测（每个元素都从干净页面重新导航再点）
node scripts\ui-clickthrough.mjs <projectId>

# 4) 只测「效果是像素级」的控件（画布工具、面板开关等）
node scripts\ui-visual-check.mjs <projectId>

# 5) 功能流程断言（输入→生成、重命名、语言、新建项目、加节点）
node scripts\ui-flows.mjs <projectId>

# 6) 服务页启停（会真的停/起 ComfyUI）
node scripts\ui-services.mjs
```

### 结果（7 视图 / 135 个元素）

| 指标 | 结果 |
| --- | --- |
| 控制台错误 | **0** |
| 失败 HTTP 请求 | **0** |
| 链接跳转 | 34 项全部正确 |
| 有效果的操作 | 19 项 |
| 禁用控件 | 15 项（均为合理禁用：无选中/无素材/无提示词） |

### 功能流程

| 流程 | 结果 |
| --- | --- |
| 创作台：输入提示词 → 「开始生成」启用 → 提交 → 出现记录 → 显示 N/M 步进度 | ✓ |
| 项目重命名并持久化到接口 | ✓ |
| 语言切换 ZH → English → 中文（`document.lang` 随之变化） | ✓ |
| 新建项目 → 选择「从画布开始」/「从创作台开始」→ 新项目创建并跳转 | ✓ |
| 画布「生成节点」连续添加多张卡片 | ✓ |
| 画布工具栏：平移/缩放/适配全部/连接线/网格吸附 | ✓ |
| 服务页：停止 ComfyUI → 端口关闭；启动 → 恢复 | ✓ |

### 排查方法上的三个坑（都踩过）

**① 枚举太早会得到「元素不存在」的假结果。**
画布页前 3 秒渲染出 **0 个**交互元素，6 秒后才稳定在 23 个。
必须先轮询到元素数量连续两次不变（`waitForStable`）再枚举。

**② 用 DOM 节点数判断「新卡片有没有加上」会误判。**
React Flow 只渲染**视口内**的节点。连续点「生成节点」时，第 4、5 张卡片
落在视口外，DOM 里查不到 —— 看起来像按钮失效，实际是成功的。
点一下「适配全部节点」，节点数立刻从 3 变成 5、缩放降到 58%。
判断画布改动要看截图差异或先适配视图，不能只看 DOM。

**③ 用文字长度判断「有没有反应」会漏掉大部分真操作。**
画布工具、面板开关改的是像素不是文字。要截两张图做基线测噪声，
再比对点击后的第三张（`scripts\ui-visual-check.mjs`）。

### 确认是正常行为的「无反应」

| 控件 | 为什么没反应 |
| --- | --- |
| 画布「选择」 | 默认工具就是 `select`（`useState('select')`），点它等于重复选中 |
| 创作台「EN」 | 提示词语言默认就是 `'en'`（`useState('en')`），本来就是选中态 |
| 剪辑「网格视图」 | 默认视图 |
| 页头各导航链接（当页时）、文本输入框 | 点击只是聚焦，本来就不该有视觉变化 |

---

## 体验问题的修复记录

上一轮点测提出 4 个问题，这一轮逐个处理。**其中 2 个经复查发现是我的测量误差，不是应用缺陷** ——
记下来是因为「怎么验证」比「改了什么」更容易再次出错。

### ① 画布新卡片滚入视口 —— 应用本来就会做

**复查结论：不是 bug。** `createDraftCard` 里的 `focusShape(cardId)` 已经把相机移到新卡片上，
实测每张新卡最终都精确居中（1440 宽视口里稳定落在 530~910）。

我之前的「视口外」结论来自**测量太早**：点了之后 1.8 秒读数，而相机动画 + React Flow
提交需要 2~3 秒才落定。等 3 秒再测，5 张卡片全部在视口内。

改动保留了一个**兜底**（`revealCardInViewport`）：`focusShape` 依赖
`getShapePageBounds`，在形状刚创建、布局还没同步时它会返回 null 而直接 return。
兜底用我们自己算出的摆放坐标复核一次，**只在真的看不见时才移动相机**，
所以正常路径下是空操作（no-op）。

> 教训：验证「有没有滚过去」必须等动画结束再量，否则会把自己写的兜底当成修复。

### ② 服务页启停后自动刷新 —— 本来就有，缺的是过渡状态

**复查结论：轮询本来就有（`POLL_MS = 5000`）。** 真正的问题是 `pending` 在 POST
返回后立刻清空，而 ComfyUI 冷启动要 25~45 秒 —— 这段时间卡片显示「已停止」，
看上去像没反应。

修复（`src\routes\services.tsx`）：

- `pending` 只在**服务真的报告了目标状态**后才清除（不再跟着 POST 走）
- 有 pending 时轮询加快到 `FAST_POLL_MS = 1500`
- `MAX_PENDING_MS = 180000` 兜底，避免服务始终起不来时无限快速轮询

### ③ 素材页空状态加入口 —— 已修

空状态文案本来就写着「生成或上传第一个素材」，但页面**没有任何入口**，是个死角。

现在空状态多两个按钮：

| 按钮 | 跳转 | 用途 |
| --- | --- | --- |
| 去创作台生成 | `/studio/{projectId}` | 生成新素材 |
| 去剪辑导入素材 | `/editor/{projectId}` | 导入本地文件 |

新增 i18n 键：`AppShell.header.projectAssets.emptyGoStudio` / `emptyGoEditor`。

> **踩的坑**：第一次插入时正则锚定文件里第一个 `"empty"`，结果键落进了
> `AppShell.studio.status` 而不是 `projectAssets`，界面直接显示原始键名
> （`emptyGoStudio`）。`scripts\fix-assets-empty-i18n.py` 把它挪回正确命名空间。
> 教训：i18n 检查只校验「三语键数一致」，**键插错命名空间它不会报错** ——
> 必须实际打开页面看渲染结果。

### ④ 预设缩略图 —— 选中后填入提示词

设计决定：**填提示词，不挂参考图**。那些缩略图只有 132px，当参考图用画质太差；
而填提示词能立刻点「生成」出效果，是最短可用路径。

| 位置 | 行为 |
| --- | --- |
| 创作台空项目 | 点击 → 对应提示词填入输入框（`onPickIdea` → `setDraft`） |
| 画布空画布 | 点击 → 直接用该提示词创建草稿卡片 |

画布那边顺带把 `onCreateImageDraft` 从 `() => void` 扩成 `(prompt?: string) => void`，
`handleCreatePromptDraft(taskType, seedPrompt = '')` 透传到 `createDraftCard({ prompt })`。
工具栏的「生成节点」仍然传空提示词，行为不变。

四张卡片的提示词写在 `studio-start-here.tsx` 的 `STUDIO_START_HERE_IDEAS[].prompt`，
想改文案直接改那里。

### 回归验证

```powershell
node scripts\verify-fixes.mjs     # 4 项断言，全部通过
```

| 断言 | 结果 |
| --- | --- |
| 连续加 4 张卡片，每次都在视口内 | ✓（0→1→2→3→4，均居中） |
| 空状态两个入口文案正确翻译 | ✓ |
| 点预设后提示词被填入 | ✓ |
| 启停过程中显示过渡状态 | ✓ |

---

## 清理缓存（排除「改了没生效」的干扰）

测试前想排除缓存干扰时，双击项目根目录的 **`清理缓存.bat`**，或直接跑：

```powershell
node scripts\clean-caches.mjs
```

它会停服务 → 清缓存 → 从零重建 → 重启 → 等就绪。

### 清掉什么

| 路径 | 是什么 | 重建方式 |
| --- | --- | --- |
| `.output` | 生产构建产物 | `vite build` |
| `node_modules/.nitro` | Nitro 构建缓存 | 构建时重建 |
| `node_modules/.vite` | Vite 预打包缓存（仅 dev 用） | `pnpm dev` 时重建 |
| `.tanstack` | 路由代码生成缓存 | 构建时重建 |
| `src/paraglide` | i18n 运行时（生成物） | `prepare-paraglide.ts` |
| `src/routeTree.gen.ts` | 路由树（生成物） | `vite build` |

**绝对不动**：`data\`（项目、生成记录、上传素材、SQLite 数据库）、`public\`、`E:\ComfyUI`（模型和节点）。

### 缓存层盘点（本应用没有 Service Worker）

| 层 | 情况 |
| --- | --- |
| Service Worker | **没有**，不存在「旧 SW 拦截请求」的问题 |
| `/assets/*` 静态资源 | `public, max-age=31536000, immutable` —— 文件名带内容哈希，这是正确配置 |
| HTML 文档 | 原本**没有任何 Cache-Control** ← 这是问题根源，见下 |
| React Query 缓存 | 未持久化，刷新即失效 |
| 浏览器 HTTP 缓存 | 需要硬刷新一次（见下） |

### 修掉的根因：HTML 没有缓存头

`/zh` 这类文档原本不带 `Cache-Control`，浏览器会**启发式缓存**，
可能继续使用引用了上一版构建哈希的旧 HTML —— 而那些资源文件已经不存在了。
表现就是「界面坏了」或「改了没生效」，且普通刷新不一定能恢复。

`src/server.ts` 现在给 HTML 补上：

```
Cache-Control: no-cache, must-revalidate
```

只作用于 `text/html`，`/assets/*` 的 `immutable` 保持不变（那里必须长缓存）。

> **重建之后浏览器仍需硬刷新一次**（Ctrl + F5），因为浏览器里存的旧 HTML 还在。
> 从那以后正常刷新就会重新校验，不会再吃到旧页面。

### 注意

- 清理脚本会**停掉工作台**，跑完自动重启。桌面「控制台」如果开着，重启后状态会自动刷新。
- `db-setup.mjs` 会作为 `prebuild` 跑一次（`schema.ts ← schema.sqlite.ts`），这是正常流程。
- 构建输出里 Vite 的 `externalized for browser compatibility` 警告和 `2>&1` 合并 stderr
  会让 PowerShell 报一个非零退出码，**那是警告不是失败** —— 看最后有没有
  `✓ 工作台已就绪` 和 `Cache-Control: no-cache` 即可。

---

## 从夸克网盘取素材（`小枫 Comfy UI` 分享）

分享页的下载按钮**不由网页执行**——它通过 `is_native_start=1` 交给桌面客户端。
网页版还刻意把每个目录渲染成**只显示 1 行**（引导用户「去客户端查看」），
所以走 DOM 自动选文件不可行。

可用的链路是 **「保存到网盘」→ 自有网盘 → 下载**：

```powershell
# 1) 解密本机夸克浏览器的登录态（DPAPI + AES-256-GCM）
node scripts\quark-decrypt-cookies.mjs

# 2) 批量：跳转到分享目录 → 点「保存到网盘」→ 从自有网盘下载
$env:QUARK_COOKIE_FILE="$env:TEMP\quark-tokens.json"
$env:QUARK_SPEC="$env:TEMP\quark-plan.json"   # [{folder:[...], files:[...]}]
node scripts\quark-pipeline.mjs
```

各脚本职责：

| 脚本 | 用途 |
| --- | --- |
| `quark-list.mjs` | 递归列出分享目录（纯只读，无需登录） |
| `quark-decrypt-cookies.mjs` | 从夸克浏览器导出登录 cookie（需先关掉浏览器） |
| `quark-pipeline.mjs` | 「保存到网盘 → 下载」全流程 |
| `quark-own-pan.mjs` / `quark-scan-pan.mjs` | 列出 / 搜索自有网盘 |
| `quark-browser-fetch.mjs` | 在浏览器上下文里取文件字节 |

**三个踩过的坑**：

1. **下载后端的父目录参数是 `pdir_fid`，不是 `pdir_id`**。传 `pdir_id` 不会报错，
   只会静默返回分享根目录，看起来像「无限同名嵌套」。
2. **「保存成功」提示不可信**。页面上常驻一个移出屏幕的 antd 消息模板，
   任何时候 `innerText` 都能匹配到 `保存成功`。必须查网盘实际内容来判定。
3. **坐标点击点不到保存按钮**。页面被一层不可见的 `ant-modal-wrap` 遮罩覆盖，
   `Input.dispatchMouseEvent` 落在遮罩上。要用 `element.click()` 绕过命中测试。
   另外 CDN 直链会返回 `412`（设备绑定），必须在浏览器上下文里 `fetch` 才能取到字节。

---

### 模型权重

| 文件 | 大小 | 位置 | 来源 |
| --- | --- | --- | --- |
| `ema_vae_fp16.safetensors` | 478 MB | `models\seedvr2\` | numz/SeedVR2_comfyUI |
| `seedvr2_ema_3b_fp8_e4m3fn.safetensors` | 3234 MB | `models\seedvr2\` | numz/SeedVR2_comfyUI |
| `qwen-image-2.1-lightning-4step-int8_convrot.safetensors` | 6921 MB | `models\loras\` | darioooooo0o/Lightning-4step-Qwen-Image-2.1-ComfyUI |
| `flux-2-klein-base-9b-fp8.safetensors` | 9124 MB | `models\diffusion_models\Flux\Flux.2-Klein\` | wissxi（官方 403，见下） |
| `qwen_3_8b_fp8mixed.safetensors` | 8263 MB | `models\text_encoders\Flux.2-Klein\` | NorbyXL/KLEIN_text_encoders |
| `flux2-vae.safetensors` | 321 MB | `models\vae\Flux\` | z7umer/flux2vae |

下载脚本：

```powershell
node scripts\download-resumable.mjs <repo> <file>    # 分块 Range + 429 退避 + 断点续传
node scripts\download-klein-weights.mjs               # Klein 三件套（串行，自动间隔）
```

> **Flux Klein 来源说明**：`black-forest-labs/*` 在 hf-mirror 上返回 **403（需授权）**，
> 上表用的是公开转载仓库，文件名与官方一致。注意 UNet 用的是 **base-9b** 版本
> （`flux-2-klein-base-9b-fp8`），非 base 的 9B 版未找到可达镜像。

---

## 本次补齐的组件

### ComfyUI 自定义节点

| 节点包 | 提供的节点 | 来源 |
| --- | --- | --- |
| `ComfyUI-DepthAnythingV2` | `DepthAnything_V2` 等 2 个 | kijai |
| `ComfyUI-QWEN3_TTS` | `Qwen3TTS*` 共 8 个 | PGCRT |
| `ComfyUI-SeedVR2_VideoUpscaler` | `SeedVR2VideoUpscaler` / `LoadDiTModel` / `LoadVAEModel` / `TorchCompileSettings` | numz |

Python 依赖：`qwen-tts`、`peft`、`rotary_embedding_torch`、`anthropic`（装 qwen-tts 时被
降级卸载，已补回）。

### DLSS5 运行时 DLL

`E:\ComfyUI\ComfyUI\custom_nodes\ComfyUI-ReActor\r_dlssnr\dll\`：

| 文件 | 大小 | 来源 |
| --- | --- | --- |
| `neuroframe_caller.dll` | 102 KB | `hf-mirror.com/datasets/Gourieff/ReActor` |
| `neuroframe_engine.dll` | 558 KB | 同上 |
| `nvngx_dlssnr.dll` | 158 MB | Merserk/dlss5-visual-enhancer v16.0 官方 release |
| `nvngx_dlss.dll` | 56 MB | 同上 |

解压 7z 需要原生 7-Zip（已装）：`winget install 7zip.7zip`。

---

## 模板适配脚本

模板原本捕获自另一台机器，节点名与模型路径均不同。以下脚本按顺序执行即可从
`workflows.backup-orig\` 完整重建：

```powershell
node scripts\fix-template-model-refs.mjs --write    # 1. 修正模型路径，隔离缺模型的模板
node scripts\adapt-qwen-t2i-template.mjs            # 2. Qwen 文生图：换 GGUF 加载器 + SaveImage
node scripts\adapt-qwen-i2i-template.mjs            # 3. Qwen 图像编辑：每槽一个 LoadImage
node scripts\adapt-tts-template.mjs                 # 4. Qwen3 TTS：适配新节点接口
node scripts\adapt-depth-template.mjs               # 5. DepthAnything V2：拆成加载器 + 预处理
node scripts\adapt-dlss-templates.mjs               # 6. DLSS5：两节点合为单节点
node scripts\adapt-seedvr2-autoscale-template.mjs   # 7. SeedVR2 自动放大：重建图
node scripts\adapt-face-refine-template.mjs          # 8. 人脸修复：枚举值对齐
node scripts\adapt-qwen-4step-templates.mjs         # 9. Qwen 4 步加速：BlockCache + LoRA 替代 FunPDD
node scripts\adapt-klein-templates.mjs              # 10. Flux Klein：模型对齐 + ImpactImageInfo 替换
node scripts\fix-tts-options.mjs                    # 11. 修正选项大小写
node scripts\fix-template-media-refs.mjs            # 12. 媒体占位符指向真实文件
node scripts\reconcile-templates.mjs                # 13. 与实时节点 schema 对账
node scripts\fix-template-runtime-issues.mjs         # 14. 修复仅在执行期暴露的缺陷
node scripts\validate-templates.mjs                  # 校验
```

`reconcile-templates.mjs` 会处理节点包升级带来的漂移：删除已废弃输入、按节点默认值补齐
缺失项、重映射失效的枚举值；并把 `PreviewImage` 换成 `SaveImage`（临时文件会被清理，
工作台拿不到产物），同时移除 `Image Comparer` 这类编辑器专用节点——它们不算输出节点，
会让 ComfyUI 裁剪掉真正的保存节点。它会保留 `images.image_N`（适配器注入点）与
`format.*`（ComfyUI 点号子参数）这两类看似未声明的字段。

`fix-template-runtime-issues.mjs` 只处理三种已实测的缺陷：SeedVR2 指向未下载的 7B 权重、
Qwen 指向无法加载的 `PE-*.gguf`、MODEL 输入误连到 CLIPLoader。**它不做类型推断** —— 早前
版本曾据此拆掉 H3 模板的 LoRA 串联链，已回滚。

### 模型路径匹配的教训

`fix-template-model-refs.mjs` 的匹配规则必须**优先同文件夹**，仅当模板里的文件夹在本机
不存在时，才退化为「按文件名唯一匹配」。反过来做会把 Qwen 模板的文本编码器换成
`Flux.2-Klein\qwen_3_8b_fp8mixed.safetensors` —— 它能加载，但产生 Flux 形状的 latent，
采样器随即报 `normalized_shape=[4096] … got input of size[1, 512, 12288]`。

同理，各适配脚本挑选 CLIP 时必须用 `qwen3vl_8b` 这类精确特征，不能用 `/8b/`
（会命中 `qwen_3_8b`）。

---

## 关键实现说明

### qwen35 架构

`models\diffusion_models\Qwen-Image-2.1-PE-*.gguf` 在
`general.architecture` 声明 `qwen35`，而 `ComfyUI-GGUF\loader.py` 的 `IMG_ARCH_LIST`
原本不含该值，加载即报 `Unexpected architecture type in GGUF file: 'qwen35'`。

ComfyUI 0.37 核心本身已支持（`comfy/model_detection.py` 识别 `qwen_image21`），
只是插件白名单未放行。已在 `loader.py:12` 的 `IMG_ARCH_LIST` 补入 `"qwen35"`
（原件备份为 `loader.py.bak-gguf`）。

> 注意：`PE-T2I` / `PE-I2I` 文件即便放行仍报 `Could not detect model type`。
> 模板统一改用实测可加载的 `qwen-image-2.1-Q8_0.gguf`。

### Qwen 图像编辑的 images 容器

`TextEncodeQwenImage21` 的 `images` 是 `io.Autogrow` 容器：
`comfy_extras/nodes_qwen.py:144` 遍历该 dict 并对每个值做 `image[:1]`。因此

- 每个 `images.image_N` 必须接**输出 IMAGE 的节点**
- `easy imageListToImageBatch` 不适用（只输出一个批次 IMAGE，第二槽无值可取）
- 传文件名列表会报 `tuple index out of range`

故每个参考槽使用独立的 `LoadImage`。

### Qwen3 TTS

`ComfyUI-Qwen3TTS-Emotional` 上游仓库缺少 `nodes.py`，其 `__init__.py` 无条件 import
它导致整个包加载失败。已改为逐模块容错导入。

替代包 `PGCRT/ComfyUI-QWEN3_TTS` 提供 `Qwen3TTS*` 节点，接口不同（需要显式
`Qwen3TTSModelLoader`、`device` 枚举为 `cuda:0`、文本字段是 `text` 而非 `target_text`）。

模板中 `use_flash_attn` 必须为 `false` —— 本机未安装 flash-attn wheel，默认 `true` 会报
`No package metadata was found for flash_attn`。`reconcile-templates.mjs` 的
`OVERRIDES` 已固化这一点。

### Qwen 4 步加速`QwenImage21FunPDDLoader` 不在任何公开节点目录中，无法安装。它的两个职责分别由
本机已有的同系列节点承担：

| 原职责 | 替代 |
| --- | --- |
| 4 步加速 LoRA | `LoraLoaderModelOnly` + `qwen-image-2.1-lightning-4step-int8_convrot.safetensors` |
| 块缓存加速 | `QwenImage21BlockCacheT8`（MODEL → MODEL） |
| SIGMAS 输出（index 2） | `BasicScheduler`（steps=4） |

实测：文生图 91s → **21s**，图像编辑 127s → **24s**。

### TextEncodeQwenImage21 的分辨率语义

该节点把图像按 /8 分块再 2×2 打包，因此 W×H 图像产生 `(W/8)*(H/8)` 个 latent 位置。
`KSampler` 要求两者一致，否则报
`Given normalized_shape=[N], expected input with shape [*N]`。

`resolution: 512` 对应 4096 token。SeedVR2 自动放大模板因此固定 512×512 基础采样，
放大交给 SeedVR2（`resolution: 2048`），并且**不设 `_beatdesign.size`** —— 否则适配器会
按界面宽高比注入 768×1024，再次造成不匹配。

### Flux Klein 的 ImpactImageInfo

`ImpactImageInfo`（ComfyUI-Impact-Pack，本机未装）被替换为 `easy imageSize`。
注意两者输出布局不同：模板原本从 **index 2** 读宽度、index 1 读高度，而
`easy imageSize` 输出 `[width, height]`，宽度索引必须改为 0，否则 latent 拿到的是
图像数量，采样时报 `float division by zero`。

---

## 验证状态

以下为最近一次完整核对的结果（每次改动后应重新跑一遍）：

| 项目 | 结果 |
| --- | --- |
| 工作台测试套件 | 407/407 通过 |
| TypeScript | 零错误 |
| i18n | en/zh/ja 各 658 键一致 |
| MCP 握手 | 29 个工具全部注册 |
| 模板静态校验 | 16/16 干净，零警告 |
| 模板真实执行 | **16/16 成功且均有产出文件**（22.8 分钟跑完） |
| **界面生成链路** | **走应用自身接口实测通过**：提交 → `succeeded` → 资源落盘并可下载 |
| 界面暴露的本地模型 | **16 个**（12 图像 + 4 视频），0 个不可用 |
| 服务控制 | 桌面「漫客工作台 控制台」一键启停；两个计划任务均为 `<Triggers />`（不随开机启动） |
| SYSTEM 写权限 | 已验证可写 `data\`（SQLite 建 WAL 的位置）与 `local.db` |
| ComfyUI 日志 | `data\logs\comfyui.log` / `.err.log`（任务启动也会写） |
| 工作台日志 | `data\logs\workbench.log` / `.err.log`（空 = 无错误） |
| 磁盘占用 | E: 剩 37.5 GB（清理了 12.9 GB 不可加载的 PE GGUF） |
| 跨系列模型错配审计 | 0 处 |
| ComfyUI 节点导入失败 | 仅 `H3_ChineseDirectorUI`（纯 UI 包，无节点，属正常） |
| ComfyUI stderr 已知噪声 | 仅 ComfyUI-Manager 连不上 raw.githubusercontent、xFormers 未装（改用 sage-attention）、LoRA 量化键告警（见下） |

### 两批可忽略的 stderr 告警

`data\logs\comfyui.err.log` 里会有两大类内容，都不影响功能：

**1. ComfyUI-Manager 的网络失败** —— 本机直连不了 GitHub，Manager 每次启动都会重试
`raw.githubusercontent.com` 并打印 `Traceback` / `ClientConnectorError`。它随后会
自动回落到本地 `custom-node-list.json`，功能不受影响。

**2. LoRA 量化键告警** —— 4 步加速 LoRA 会打印大量

```
[WARNING] lora key not loaded: transformer_blocks.0.attn.to_k.comfy_quant
[WARNING] lora key not loaded: transformer_blocks.0.attn.to_out.0.weight
```

这些 `.comfy_quant` / 部分 `weight` 键是权重在导出时带的量化元数据，加载器不会
套用到对应层上。LoRA 的主体权重仍会生效——4 步模板实测能正常出图（21～22 秒），
所以这条告警不用处理。

> 判断 stderr 是否真的有问题，看**有没有产出文件**比看日志更可靠：
> 跑一遍 `node scripts\sweep-templates.mjs`，16/16 通过即正常。

---

## 数据位置

| 内容 | 路径 |
| --- | --- |
| SQLite | `data\local.db` |
| 项目媒体 | `data\project-assets\` |
| 日志 | `data\logs\comfyui.log`、`data\logs\workbench.log` |

---

## 常见问题

| 现象 | 处理 |
| --- | --- |
| ComfyUI 日志出现 `Cannot connect to raw.githubusercontent.com` | ComfyUI-Manager 拉更新失败，不影响生成 |
| 生成报 `qwen35` | 检查 `ComfyUI-GGUF\loader.py` 的 `IMG_ARCH_LIST` 是否含 `qwen35` |
| 生成报 `Could not detect model type` | 模板误用了 `PE-*.gguf`，跑 `fix-template-runtime-issues.mjs` |
| DLSS 报 `nvngx_dlssnr.dll not found` | 四个 DLL 是否齐全，见上表 |
| TTS 报 `flash_attn` | 确认模板 `use_flash_attn` 为 `false` |
| TTS/节点下载模型失败 | 确认 `BD-ComfyUI` 任务带 `HF_ENDPOINT=https://hf-mirror.com` |
| 端口被占 | 停止占用进程或改脚本端口 |
| 工作台 3020 未启动 | 先 `pnpm build`，再运行启动器 |

---

## 服务自检

**重启后想确认服务有没有自动起来，双击项目根目录的「检查服务状态.bat」**——
它只做只读检查，会逐项打印计划任务、端口、HTTP、可用模型，最后给出结论。

等价的手工命令：

```powershell
# 计划任务与端口
Get-ScheduledTask -TaskName 'BD-ComfyUI','BD-Workbench' | Select-Object TaskName,State
Get-NetTCPConnection -State Listen -LocalPort 8188,3020 | Select-Object LocalPort,OwningProcess

# 服务状态接口
(Invoke-RestMethod http://127.0.0.1:3020/api/app/services).services
```

正常时三个服务里 `workbench` 与 `comfyui` 的 `up = true`。

### 开机后什么都不用等

服务**不随开机启动**。开机后想用工作台时，双击桌面的
**「漫客工作台 控制台」** → 点「全部启动」：

| 服务 | 就绪时间 |
| --- | --- |
| 工作台 | 约 3 秒 |
| ComfyUI | 约 25～45 秒（要加载模型） |

ComfyUI 加载期间控制台的状态显示「启动中…」是正常的。
两个都变绿之后，点「打开工作台」或直接访问 http://127.0.0.1:3020 即可。