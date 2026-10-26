# 工作台更新机制设计
#
# 目标：用户在控制台点一个按钮，工作台就更新到仓库最新版本。
#
# 约束：
#   · 目标机器可能没装 git —— 不能强制依赖
#   · 工作台是构建产物，更新后必须重新 pnpm install + build
#   · 构建失败要能回滚，不能把用户搞成白屏
#
# 方案：GitHub API 下载 tarball，比 git 更简单可靠
#
#   1. 版本比对
#      仓库放 version.json（提交时手写版本号）
#      控制台读本地 version.json，和远程比对
#
#   2. 下载
#      GET https://api.github.com/repos/{owner}/{repo}/tarball/{ref}
#      → 得到 tar.gz（约 3-5 MB，只有源码）
#
#   3. 覆盖
#      解压后只覆盖这些目录：src/ scripts/ messages/ public/ docs/
#      **不动**：data/（用户的项目和素材）、.output/（构建产物）、
#               node_modules/、.env、data/comfyui.config.json
#
#   4. 重建
#      pnpm install（只有 package.json 变了才跑）
#      pnpm build
#
#   5. 回滚
#      更新前把 .output 备份成 .output.bak
#      build 失败 → 恢复 .output.bak + 还原源码
#
# 为什么不用 git：
#   git 需要 .git 目录（17.6 MB）打进去，还要求目标机器装 git。
#   tarball 方式只依赖 HTTP，Node 自带 fetch，零外部依赖。

# 这个文件是设计说明，实际实现在 src/core/update/ 下
