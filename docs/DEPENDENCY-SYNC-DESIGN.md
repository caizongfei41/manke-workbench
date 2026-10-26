# 更新时补齐依赖的设计
#
# 问题：更新机制目前只换代码（12 MB tarball），但新版功能可能需要
# 新的模型或节点包，那些动辄几百 GB，不可能塞进 tarball。
#
# 三种资源，三种拿法：
#
# ┌─────────────┬──────────┬──────────────────────────────────┐
# │ 资源        │ 体积     │ 来源                              │
# ├─────────────┼──────────┼──────────────────────────────────┤
# │ 代码        │ 12 MB    │ GitHub tarball（已实现）          │
# │ 节点包      │ 250 MB   │ 各自 GitHub 仓库 clone / zip      │
# │ 模型        │ 200 GB   │ HuggingFace / ModelScope / 网盘   │
# └─────────────┴──────────┴──────────────────────────────────┘
#
# 关键设计：更新完成后，拿新的 DEPENDENCIES.json 和本地磁盘比对，
# 列出「新增了什么」，让用户决定装不装。不要自动下载 200 GB。
#
# 流程：
#
#   1. 更新代码（tarball）
#   2. 读新的 docs/DEPENDENCIES.json
#   3. 扫本地 models/ 和 custom_nodes/
#   4. 差集 = 新增依赖
#   5. 有新增 → 弹窗列出：「本次更新需要 3 个新文件，共 12 GB」
#      [ 现在下载 ]  [ 稍后 ]  [ 只看清单 ]
#   6. 下载走 data/install-sources.json 里的地址
#
# 为什么不让 pip 式的依赖自动装：
#   模型 200 GB，用户可能没有磁盘空间，也可能只想用图片功能不需要视频模型。
#   强制下载会让「更新代码」这个 30 秒的操作变成 6 小时。
#
# 增量下载的优化：
#   · 节点包：git clone --depth 1，只拿最新一版
#   · 模型：支持断点续传（curl -C -），大文件断了不用重下
#   · 已有同名的文件跳过（按文件大小判断，不重下）

## 状态文件

更新后写 `.update-report.json`，记录本次更新新增了什么：

```json
{
  "updatedAt": "2026-10-27T10:00:00Z",
  "from": "1.0.0",
  "to": "1.1.0",
  "newModels": [
    {
      "basename": "minimax_h3_v2_fp8.safetensors",
      "sizeBytes": 12582912000,
      "destPath": "models/diffusion_models/minimax_h3_v2_fp8.safetensors",
      "sources": [
        { "kind": "huggingface", "url": "https://huggingface.co/.../resolve/main/..." },
        { "kind": "quark", "url": "https://pan.quark.cn/s/...", "code": "..." }
      ]
    }
  ],
  "newNodes": [
    {
      "name": "ComfyUI-NewNode",
      "repo": "https://github.com/xxx/ComfyUI-NewNode",
      "sizeBytes": 5000000
    }
  ],
  "missingModels": [],
  "missingNodes": []
}
```

## 控制台上的表现

```
[检查更新] [更新工作台] [补齐依赖]   ← 第三个按钮，只在有缺失时才亮
```

点「补齐依赖」：

```
本次更新需要补齐：
  · 模型 2 个，约 13 GB
      minimax_h3_v2_fp8.safetensors   12 GB
      qwen3vl_8b_v2_int8.safetensors  1 GB
  · 节点包 1 个，约 5 MB
      ComfyUI-NewNode

[ 全部下载 ]  [ 逐个下载 ]  [ 取消 ]
```

## 命令行接口

```bash
# 只看缺什么
node scripts/sync-deps.mjs --check

# 全部补齐
node scripts/sync-deps.mjs --sync

# 只补节点包
node scripts/sync-deps.mjs --sync --only=nodes

# 只补某个模型
node scripts/sync-deps.mjs --sync --only=minimax_h3_v2_fp8.safetensors
```

## 边界情况

**新版删掉了旧模型**
清单里没有的模型不删。用户磁盘上的东西只能用户自己删。
但会提示：「有 3 个模型已不再被任何工作流引用，可手动删除释放 40 GB」。

**下载地址失效**
`install-sources.json` 里每个资源都有多个来源（HuggingFace / ModelScope / 网盘）。
一个失败自动试下一个，全失败就告诉用户去网盘手动下。

**磁盘不够**
下载前检查目标盘剩余空间，不够直接拒绝并说明还差多少 GB，
而不是下到一半失败。

**更新了但没重启**
`.update-report.json` 里记 `applied: false`，
控制台启动时检测到就提示「有更新待应用，需要重启工作台」。

## 为什么不做「自动静默补齐」

模型 200 GB。用户可能：
- 磁盘不够
- 只想用图片，不需要视频模型
- 在流量计费的网络上

自动下载任何一个理由都足以让人恼火。
代码可以自动更新（12 MB，30 秒），资源必须用户点确认。
