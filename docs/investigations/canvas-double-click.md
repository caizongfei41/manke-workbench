# 画布双击建卡：为什么打不通

> 记录于 2026-10-20，连续五轮失败之后。留给下一个接手的人，避免重复试错。

## 目标

在画布的空白处双击，就地落一张图片卡（位置跟随指针）。

## 已经确认的事实

每一条都在真实浏览器里量过，不是读代码推断。

| 事实 | 怎么确认的 |
|---|---|
| 空状态浮层覆盖整个画布中段 | `getBoundingClientRect` → `{y:401, h:451, w:2400}` |
| 把它改成 `pointer-events-none` 后落点恢复为 `.react-flow__pane` | `elementFromPoint(300,700)` |
| `dblclick` 事件确实到达画布容器 | 捕获阶段监听器记录到 `react-flow__pane selection` |
| React 的 `onDoubleClick` 挂在容器 div / ReactFlow 上都**不触发** | 派发事件后无卡片、无异常 |
| 改用原生 `addEventListener('dblclick')` 也**不产出卡片** | 同上 |
| 建卡链路本身是好的 | 点「图片卡片」按钮 → 卡片 1 张、空状态消失 |

## 最可能的卡点（未证实）

`instanceRef.current` 为 `null`。

`screenToFlowPosition` 依赖 `instanceRef`，而它由 `onInit={handleInit}` 填充。react-flow 在
`onlyRenderVisibleElements` 模式下、且画布上**一张卡片都没有**时，是否仍会触发 `onInit`，
我没有验证过。如果 `onInit` 没跑，代码会在 `if (!instance) return;` 那里静默返回 —— 
这与「无异常、无卡片」的现象完全吻合。

## 第二轮：这个假设被推翻了

在容器上暴露 `data-probe-init={instanceRef.current ? 'ready' : 'null'}` 之后实测：

```
空白板时   instanceRef: ready
有卡片时   instanceRef: ready
```

**实例是好的**，所以 `if (!instance) return;` 不是卡点。但紧接着发现的第二件事更根本：

```
在纯 pane 上双击 → 连 console.log('[dbl] ...') 都没有输出
```

也就是 **handler 一次都没有执行**。继续测：

| 验证 | 结果 |
|---|---|
| 事件到达 document | ✅ 捕获监听记录到 `doc:react-flow__pane sel` |
| 落点在容器边界内 | ✅ 容器 `{x:0,y:57,w:2400,h:1293}`，点 `(1200,177)` |
| 容器上的 React `onDoubleClick` | ❌ 不触发 |
| 容器上的原生 `addEventListener` | ❌ 不触发 |
| document 上的原生 `addEventListener` | ❌ 不触发 |

最后一条是关键：事件**确实**能到 document（捕获阶段看到了），但挂在 document 上的
冒泡监听器没跑。这说明 `dblclick` 在冒泡途中被 `stopPropagation()` 拦掉了 —— 
最可能是 ReactFlow 内部的 d3-zoom 双击处理器。

## 第三轮该试的

**不要**再依赖冒泡。用**捕获阶段**：

```js
document.addEventListener('dblclick', handler, true)   // 注意第三个参数
```

捕获阶段在目标之前执行，`stopPropagation` 拦不住它。

如果捕获也不生效，下一个怀疑对象是 `onPaneClick` / `onPanePointerDown` 之外的
`onDoubleClick` prop —— ReactFlow 有 `onDoubleClick` 自己的回调，值得直接用它
而不是绕过它：

```jsx
<ReactFlow onDoubleClick={(event) => { /* 这里 */ }} />
```

## 不要重复的路

- **不要**把 `onDoubleClick` 挂在 `<ReactFlow>` 上 —— 被 d3-zoom 的双击缩放手势吃掉。
- **不要**指望 `pointer-events-none` 一处就够 —— 空状态里的按钮必须显式开回 `pointer-events-auto`，否则点不动。
- **不要**用 `dispatchEvent(new MouseEvent('dblclick'))` 判断 React 合成事件是否生效 —— 
  它能到达原生监听器，但不保证走 React 的事件委托，容易得出「没绑上」的错误结论。
- **不要**在没有卡片时测量 —— 先点按钮建一张卡，再看双击是否还能用，这样能区分「事件问题」和「实例问题」。

## 现在的状态

所有相关改动已回退，仓库干净。`beatcanvas-start.tsx` 里那句提示文字
（「双击空白处也能新建卡片」）**仍然存在**，但目前双击并不会建卡 —— 这句话现在是不准确的。
要么把功能补上，要么先把提示改成实际支持的入口。
