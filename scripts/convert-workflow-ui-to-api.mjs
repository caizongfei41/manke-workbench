// UI 格式工作流 → API 格式
//
//   node scripts/convert-workflow-ui-to-api.mjs <源.json> <目标.json>
//
// ComfyUI 存的是画布格式（nodes / links / widgets_values），/prompt 要的是
// 「节点字典 + inputs 里的 [源节点, 槽位]」。控件值没有名字，只能按位置铺到
// 节点声明的输入上 —— 顺序从 /object_info 拿，不靠手写猜。
import { readFileSync, writeFileSync } from 'node:fs';

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error('用法: node convert-workflow-ui-to-api.mjs <源> <目标>');
  process.exit(1);
}

const COMFY = process.env.COMFY ?? 'http://127.0.0.1:8188';

/** 缓存每种节点的输入顺序：required 在前，optional 在后。 */
const inputOrder = new Map();
const loadInputOrder = async (classType) => {
  if (inputOrder.has(classType)) return inputOrder.get(classType);
  const response = await fetch(`${COMFY}/object_info/${encodeURIComponent(classType)}`);
  const info = (await response.json())?.[classType];
  const required = Object.keys(info?.input?.required ?? {});
  const optional = Object.keys(info?.input?.optional ?? {});
  const order = [...required, ...optional];
  inputOrder.set(classType, order);
  return order;
};

const workflow = JSON.parse(readFileSync(source, 'utf8'));
const nodes = workflow.nodes ?? [];

/** link id → { 源节点, 源槽 } */
const links = new Map();
for (const link of workflow.links ?? []) {
  links.set(link[0], { from: String(link[1]), fromSlot: link[2] });
}

const out = {};

for (const node of nodes) {
  if (/^(MarkdownNote|Note|Label \(rgthree\))$/.test(node.type)) continue;

  const inputs = {};

  // 1) 连线输入
  for (const input of node.inputs ?? []) {
    if (input.link == null) continue;
    const link = links.get(input.link);
    if (!link) continue;
    inputs[input.name] = [link.from, link.fromSlot];
  }

  // 2) 控件值按声明顺序铺开；已被连线占用的名字跳过
  const widgets = node.widgets_values;
  if (Array.isArray(widgets) && widgets.length) {
    const order = await loadInputOrder(node.type);
    let cursor = 0;
    for (const name of order) {
      if (name in inputs) continue;
      if (cursor >= widgets.length) break;
      inputs[name] = widgets[cursor];
      cursor += 1;
    }
  }

  out[String(node.id)] = {
    class_type: node.type,
    inputs,
    _meta: { title: node.title ?? node.type },
  };
}

writeFileSync(target, JSON.stringify(out, null, 2), 'utf8');
console.log(`  ${Object.keys(out).length} 个节点 → ${target}`);
