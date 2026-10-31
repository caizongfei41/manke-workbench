// 模块化部署：按 manifest 一个包一个包地解，解完就能删。
//
// 和老的单一大包相比，这里多了三件事：
//
//   1. 判断哪些包已经解开（看目标目录里有没有标志文件）
//   2. 一个包解完立刻回调，界面能提示「可以删这个包了」
//   3. 进度是「第 3/9 个包 · 40%」，不是笼统的百分比
//
// 每个包解压前会写 manifest.part-<id>.done 标记，内容是包名和大小。
// 重装或者恢复时看到标记就跳过 —— 这比对比文件时间可靠得多。
const fs = require('node:fs');
const path = require('node:path');

/** 标记文件放在目标根目录，和 ComfyUI 平级。 */
const markerPath = (targetDir, partId) => path.join(targetDir, `.manke-part-${partId}.done`);

const isPartDone = (targetDir, part) => {
  const marker = markerPath(targetDir, part.id);
  if (!fs.existsSync(marker)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(marker, 'utf8'));
    // 包换了（sha 不同）就得重解
    return saved.sha256 === part.sha256;
  } catch {
    return false;
  }
};

const markPartDone = (targetDir, part) => {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      markerPath(targetDir, part.id),
      JSON.stringify(
        { id: part.id, name: part.name, sha256: part.sha256, at: new Date().toISOString() },
        null,
        2
      )
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * 判断部署的状态：哪些包已完成、下一个该解哪个。
 *
 * @param {string} targetDir 解压目标
 * @param {object} manifest  从服务器或本地读到的 manifest
 */
const inspectModules = (targetDir, manifest) => {
  const parts = [...(manifest.parts ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const done = [];
  const pending = [];
  for (const part of parts) {
    if (isPartDone(targetDir, part)) done.push(part.id);
    else pending.push(part);
  }
  return {
    total: parts.length,
    doneCount: done.length,
    done,
    pending,
    next: pending[0] ?? null,
    complete: pending.length === 0,
  };
};

/**
 * 解一个模块包。
 *
 * @param {object} opts
 * @param {string} opts.archive      .7z 文件路径
 * @param {string} opts.targetDir    解到哪
 * @param {object} opts.part         manifest 里的这一项
 * @param {string} opts.resources    找 7z.exe
 * @param {(p:{percent:number,message:string})=>void} [opts.onProgress]
 */
const extractModule = async ({ archive, targetDir, part, resources, onProgress }) => {
  // 复用 bundle.cjs 的 extractBundle，它已经处理了 7z 调用、进度、-aos
  const { extractBundle } = require('./bundle.cjs');

  const result = await extractBundle({
    firstVolume: archive,
    targetDir,
    resources,
    onProgress,
  });

  // extractBundle 会去找 python_embeded，但模型包里没有，那种情况不算失败
  if (!result.ok && result.comfyRoot === null && fs.existsSync(targetDir)) {
    // 只要 7z 退出码是 0，文件就是解出来了
    const anyContent = fs.readdirSync(targetDir).length > 0;
    if (anyContent) {
      markPartDone(targetDir, part);
      return { ok: true, message: `${part.name} 已解压`, targetDir };
    }
  }

  if (result.ok) {
    markPartDone(targetDir, part);
  }
  return {
    ok: result.ok,
    message: result.ok ? `${part.name} 已解压` : result.message,
    targetDir,
  };
};

module.exports = { isPartDone, markPartDone, inspectModules, extractModule, markerPath };
