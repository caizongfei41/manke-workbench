# 发布到 GitHub

本仓库已经整理成可以直接公开的状态。下面是收尾步骤。

## 1. 替换占位符

有三处占位符需要换成你自己的：

| 文件 | 占位符 | 换成 |
| --- | --- | --- |
| `package.json` | `<your-account>`（3 处） | 你的 GitHub 用户名 |
| `glama.json` | `<your-github-handle>` | 你的 GitHub 用户名 |
| `README.md` / `README.en.md` | `<your-account>` | 同上 |

一次性替换：

```powershell
$me = '你的GitHub用户名'
Get-ChildItem package.json, glama.json, README.md, README.en.md |
  ForEach-Object {
    $c = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8)
    $c = $c.Replace('<your-account>', $me).Replace('<your-github-handle>', $me)
    [IO.File]::WriteAllText($_.FullName, $c, (New-Object Text.UTF8Encoding($false)))
  }
```

## 2. 发布前自检

```powershell
node scripts\audit-publication.mjs .
```

它会检查待提交文件里的密钥、私钥、硬编码凭据、个人路径、浏览器 cookie 工具，以及大文件。
输出 `结论: 可以发布` 才继续。

另外建议跑一遍：

```powershell
pnpm typecheck
pnpm test
pnpm i18n:check
```

## 3. 创建仓库并推送

```powershell
git init
git add -A
git commit -m "Initial public release of 漫客工作台 0.3.0"
git branch -M main
git remote add origin https://github.com/<your-account>/manke-workbench.git
git push -u origin main
```

## 4. 发布后在 GitHub 上做三件事

1. **Description**：填 `本地优先的 ComfyUI 图像与视频创作工作台`
2. **Topics**：`comfyui` `stable-diffusion` `local-first` `ai-canvas` `text-to-image` `windows`
3. **About → License**：GitHub 会自动识别 `LICENSE` 为 Apache-2.0

## 不会进入仓库的内容

这些已经在 `.gitignore` 里，但仍然说明一下，避免误操作：

| 路径 | 内容 | 为什么不能公开 |
| --- | --- | --- |
| `data/local.db` | 你的项目数据库（76 MB） | 个人创作记录 |
| `data/project-assets/` | 生成的图片和视频（166 MB） | 个人素材 |
| `data/logs/` | 运行日志 | 含机器路径 |
| `data/comfyui.config.json` | ComfyUI 连接配置 | 每台机器不同 |
| `node_modules/` `.output/` `.tanstack/` | 依赖与构建产物 | 可由 `pnpm install` / `pnpm build` 重建 |
| `src/paraglide/` `src/routeTree.gen.ts` | 生成代码 | 构建时重新生成 |

**唯一会提交的 `data/` 子目录是 `data/comfyui/workflows/`** —— 那 16 个工作流模板是产品的一部分。
`.gitignore` 用了三行例外专门处理这一点：

```gitignore
/data/*
!/data/comfyui/
/data/comfyui/*
!/data/comfyui/workflows/
```

改这段要小心：gitignore 是**后面的规则优先**，末尾再加一条 `/data/` 会把模板也一起排掉。

## 已移出仓库的内容

为了不让个人运维脚本混进公开仓库，以下内容被移到了同级目录
`..\ComfyUI无线画布-本地运维\`（**不在仓库内，仍可正常使用**）：

| 目录 | 内容 |
| --- | --- |
| `scripts\`（66 个） | 网盘下载、浏览器 cookie 解密、CDP 自动化、界面点测、一次性模板迁移脚本 |
| `launcher\tasks-backup\` | 你机器上的计划任务定义（含个人路径） |
| `workflows-disabled\` | 三视图模板的旧版副本（5.1 KB，已被 10 KB 版取代） |
| `upstream-originals\` | 上游的 `README.ja.md`、`README.zh-CN.md`、封面图 |

桌面控制台和启动器**没有**被移走，仍在 `launcher\`；`launcher\start-workbench.ps1`
已改为用 `$PSScriptRoot` 推算项目根目录，不再写死路径。

## 协议与合规

- 代码是 **Apache-2.0**（沿用上游，`LICENSE` 保留原版权声明 `Copyright 2026 BeatAPI`）。
- **`NOTICE` 是必须的**：Apache-2.0 第 4(b) 条要求声明对原作品的修改。文件里已列了 6 类改动。
- 按上游 [TRADEMARKS.md](TRADEMARKS.md)，分支**必须用自己的产品名和视觉标识** ——
  这一点已经做了（漫客工作台 / Manke Workbench），只在描述来源时提及 BeatDesign/BeatAPI。
- 不要在仓库描述、README 标题或 Logo 里暗示与 BeatAPI 的隶属或背书关系。

## 后续维护提示

- 版本号要同时改 5 处，`pnpm test` 会检查它们是否一致：
  `package.json`、`.claude-plugin/marketplace.json`、
  `integrations/codex/.../plugin.json`、`integrations/claude-code/.../plugin.json`、
  `integrations/workbuddy/.../connector-meta.json`、`lhm.plugin.json`。
- 新增 i18n 文案要三语同步，`pnpm i18n:check` 会报错。
  注意它**只校验键数一致**，键插错命名空间不会报错 —— 要实际打开页面确认渲染。
