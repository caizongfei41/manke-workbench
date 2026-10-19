/**
 * 标准画布的文档模型。
 *
 * 参考的画布把素材分成「角色 / 场景 / 设定」三类卡片，卡片之间用端口连线，
 * 底部一条生成条。这里只描述数据，渲染在组件层。
 */

export type StandardNodeKind = 'role' | 'scene' | 'setting' | 'shot';

export type StandardNode = {
  id: string;
  kind: StandardNodeKind;
  /** 卡片左上角显示的名字，空字符串时显示「未命名…」 */
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 角色/场景的参考图 */
  imageUrl?: string | null;
  /** 设定/镜头节点的文本 */
  text?: string;
};

export type StandardLink = {
  id: string;
  from: string;
  to: string;
};

export type StandardDocument = {
  version: 1;
  nodes: StandardNode[];
  links: StandardLink[];
  viewport: { x: number; y: number; zoom: number };
  /** 底部生成条记住上次的选择 */
  composer: {
    prompt: string;
    model: string;
    style: string;
  };
};

/** 图片生成用的工作流名：服务端按这个名字找模板。 */
export const STANDARD_IMAGE_MODEL_ID = '小枫-qwen-image-2-1-文生图';

/** 带参考图时用编辑工作流：它才声明了图片输入节点。 */
export const STANDARD_EDIT_MODEL_ID = '小枫-qwen-image-2-1-图像编辑';

export const NODE_SIZES: Record<StandardNodeKind, { width: number; height: number }> = {
  role: { width: 392, height: 232 },
  scene: { width: 392, height: 212 },
  setting: { width: 580, height: 200 },
  shot: { width: 320, height: 200 },
};

export const createNode = (
  kind: StandardNodeKind,
  at: { x: number; y: number },
  overrides: Partial<StandardNode> = {}
): StandardNode => {
  const size = NODE_SIZES[kind];
  const suffix =
    kind === 'role'
      ? 'role'
      : kind === 'scene'
        ? 'scene'
        : kind === 'setting'
          ? 'setting'
          : 'shot';
  return {
    id: `${suffix}-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    name: '',
    x: Math.round(at.x),
    y: Math.round(at.y),
    width: size.width,
    height: size.height,
    imageUrl: null,
    text: '',
    ...overrides,
  };
};

/** 空画布的起点：一张角色、一张场景、一块设定，和参考视频里的初始布局一致。 */
export const createDefaultDocument = (): StandardDocument => ({
  version: 1,
  nodes: [
    createNode('role', { x: 200, y: 90 }),
    createNode('scene', { x: 680, y: 150 }),
    createNode('setting', { x: 600, y: 420 }),
  ],
  links: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  composer: { prompt: '', model: 'local', style: 'image' },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toNumber = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const KINDS: StandardNodeKind[] = ['role', 'scene', 'setting', 'shot'];

/** 宽容解析：老数据、坏数据都不该让画布打不开。 */
export const parseStandardDocument = (raw: unknown): StandardDocument => {
  const fallback = createDefaultDocument();
  if (!isRecord(raw)) return fallback;

  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes
        .filter(isRecord)
        .filter((node) => KINDS.includes(node.kind as StandardNodeKind))
        .map((node) => {
          const kind = node.kind as StandardNodeKind;
          const size = NODE_SIZES[kind];
          return {
            id: typeof node.id === 'string' && node.id ? node.id : createNode(kind, { x: 0, y: 0 }).id,
            kind,
            name: typeof node.name === 'string' ? node.name : '',
            x: toNumber(node.x, 0),
            y: toNumber(node.y, 0),
            width: toNumber(node.width, size.width),
            height: toNumber(node.height, size.height),
            imageUrl: typeof node.imageUrl === 'string' ? node.imageUrl : null,
            text: typeof node.text === 'string' ? node.text : '',
          } satisfies StandardNode;
        })
    : fallback.nodes;

  const ids = new Set(nodes.map((node) => node.id));
  const links = Array.isArray(raw.links)
    ? raw.links
        .filter(isRecord)
        .filter(
          (link) =>
            typeof link.from === 'string' &&
            typeof link.to === 'string' &&
            ids.has(link.from) &&
            ids.has(link.to) &&
            link.from !== link.to
        )
        .map((link) => ({
          id: typeof link.id === 'string' && link.id ? link.id : `link-${link.from}-${link.to}`,
          from: link.from as string,
          to: link.to as string,
        }))
    : [];

  const viewport = isRecord(raw.viewport) ? raw.viewport : {};
  const composer = isRecord(raw.composer) ? raw.composer : {};

  return {
    version: 1,
    nodes,
    links,
    viewport: {
      x: toNumber(viewport.x, 0),
      y: toNumber(viewport.y, 0),
      zoom: Math.min(2.5, Math.max(0.25, toNumber(viewport.zoom, 1))),
    },
    composer: {
      prompt: typeof composer.prompt === 'string' ? composer.prompt : '',
      model: typeof composer.model === 'string' ? composer.model : 'local',
      style: typeof composer.style === 'string' ? composer.style : 'image',
    },
  };
};

/** 读快照里的 standard 字段。 */
export const loadStandardDocument = (serialized: unknown): StandardDocument => {
  if (typeof serialized !== 'string' || !serialized.trim()) return createDefaultDocument();
  try {
    return parseStandardDocument(JSON.parse(serialized));
  } catch {
    return createDefaultDocument();
  }
};

/** 写回快照时用的字符串。 */
export const serializeStandardDocument = (doc: StandardDocument) => JSON.stringify(doc);

/** 连线的两个端点之间画一条三次贝塞尔曲线。 */
export const linkPath = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  const dx = Math.max(60, Math.abs(to.x - from.x) * 0.5);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
};

/** 端口位置：右侧出、左侧入，垂直居中。 */
export const outputPort = (node: StandardNode) => ({
  x: node.x + node.width,
  y: node.y + node.height / 2,
});

export const inputPort = (node: StandardNode) => ({
  x: node.x,
  y: node.y + node.height / 2,
});
