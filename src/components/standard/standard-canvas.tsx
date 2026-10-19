import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Aperture,
  ChevronDown,
  ChevronLeft,
  CircleDot,
  Clapperboard,
  Image as ImageIcon,
  Layers,
  Lock,
  Minus,
  Monitor,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Type,
  Upload,
  User,
  Wand2,
} from 'lucide-react';

import { normalizeLocale } from '@/config/locale';
import {
  inputPort,
  linkPath,
  outputPort,
  type StandardDocument,
  type StandardLink,
  type StandardNode,
  type StandardNodeKind,
} from '@/core/standard-canvas/document';
import { m } from '@/paraglide/messages.js';

/**
 * The standard canvas, following the visual language of the reference.
 *
 * Composition: dotted grid, floating capsule bar on top, vertical rail on the left,
 * zoom stack bottom-left, composer bottom-centre. Nodes are character / scene / setting,
 * with a dot in on the left and a dot out on the right; selection adds an inner glow.
 */

const KIND_ICON: Record<StandardNodeKind, typeof User> = {
  role: User,
  scene: ImageIcon,
  setting: Type,
  shot: Clapperboard,
};

const KIND_LABEL: Record<StandardNodeKind, () => string> = {
  role: () => m['standard.kind.role'](),
  scene: () => m['standard.kind.scene'](),
  setting: () => m['standard.kind.setting'](),
  shot: () => m['standard.kind.shot'](),
};

const UNTITLED: Record<StandardNodeKind, () => string> = {
  role: () => m['standard.untitled.role'](),
  scene: () => m['standard.untitled.scene'](),
  setting: () => m['standard.untitled.setting'](),
  shot: () => m['standard.untitled.shot'](),
};

type DragState =
  | { type: 'node'; id: string; startX: number; startY: number; originX: number; originY: number }
  | { type: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { type: 'link'; from: string; pointerX: number; pointerY: number };

export function StandardCanvas({
  projectId,
  projectName,
  doc,
  onChange,
  saving,
  onUpload,
}: {
  projectId: string;
  projectName: string;
  doc: StandardDocument;
  onChange: (updater: (current: StandardDocument) => StandardDocument) => void;
  saving: 'idle' | 'saving' | 'saved' | 'error';
  onUpload: (nodeId: string, file: File) => Promise<string | null>;
}) {
  const locale = normalizeLocale('zh');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploadTarget = useRef<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [locked, setLocked] = useState(false);
  const [menu, setMenu] = useState<'project' | 'assets' | 'model' | null>(null);

  const { viewport } = doc;
  const zoom = viewport.zoom;

  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - viewport.x) / zoom,
        y: (clientY - rect.top - viewport.y) / zoom,
      };
    },
    [viewport.x, viewport.y, zoom]
  );

  const patchNode = useCallback(
    (id: string, patch: Partial<StandardNode>) =>
      onChange((current) => ({
        ...current,
        nodes: current.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
      })),
    [onChange]
  );

  const removeNode = useCallback(
    (id: string) =>
      onChange((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => node.id !== id),
        links: current.links.filter((link) => link.from !== id && link.to !== id),
      })),
    [onChange]
  );

  const addNode = useCallback(
    (kind: StandardNodeKind) => {
      const rect = rootRef.current?.getBoundingClientRect();
      const centre = rect
        ? toCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2)
        : { x: 300, y: 200 };
      onChange((current) => ({
        ...current,
        nodes: [
          ...current.nodes,
          {
            id: `${kind}-${Math.random().toString(36).slice(2, 10)}`,
            kind,
            name: '',
            x: Math.round(centre.x),
            y: Math.round(centre.y),
            width: kind === 'setting' ? 580 : 392,
            height: kind === 'setting' ? 200 : kind === 'shot' ? 200 : 232,
            imageUrl: null,
            text: '',
          },
        ],
      }));
    },
    [onChange, toCanvas]
  );

  // Dragging, panning and linking all run through one pointer handler
  useEffect(() => {
    if (!drag) return;

    const onMove = (event: PointerEvent) => {
      if (drag.type === 'node') {
        const dx = (event.clientX - drag.startX) / zoom;
        const dy = (event.clientY - drag.startY) / zoom;
        patchNode(drag.id, {
          x: Math.round(drag.originX + dx),
          y: Math.round(drag.originY + dy),
        });
        return;
      }
      if (drag.type === 'pan') {
        onChange((current) => ({
          ...current,
          viewport: {
            ...current.viewport,
            x: drag.originX + (event.clientX - drag.startX),
            y: drag.originY + (event.clientY - drag.startY),
          },
        }));
        return;
      }
      const point = toCanvas(event.clientX, event.clientY);
      setDrag({ ...drag, pointerX: point.x, pointerY: point.y });
    };

    const onUp = (event: PointerEvent) => {
      if (drag.type === 'link') {
        // Dropping anywhere on the card counts, not only on the 12px port: aiming at a
        // dot is fiddly, and landing on the card obviously means "connect to this one".
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const inputId =
          target?.closest('[data-port-in]')?.getAttribute('data-port-in') ??
          target?.closest('[data-standard-node]')?.getAttribute('data-standard-node') ??
          null;
        if (inputId && inputId !== drag.from) {
          onChange((current) => {
            if (current.links.some((link) => link.from === drag.from && link.to === inputId)) {
              return current;
            }
            const link: StandardLink = {
              id: `link-${drag.from}-${inputId}`,
              from: drag.from,
              to: inputId,
            };
            return { ...current, links: [...current.links, link] };
          });
        }
      }
      setDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, onChange, patchNode, toCanvas, zoom]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!selected) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeNode(selected);
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [removeNode, selected]);

  const setZoom = (next: number) =>
    onChange((current) => ({
      ...current,
      viewport: { ...current.viewport, zoom: Math.min(2.5, Math.max(0.25, next)) },
    }));

  const fit = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || doc.nodes.length === 0) return;
    const minX = Math.min(...doc.nodes.map((node) => node.x));
    const minY = Math.min(...doc.nodes.map((node) => node.y));
    const maxX = Math.max(...doc.nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...doc.nodes.map((node) => node.y + node.height));
    const nextZoom = Math.min(1.4, Math.max(0.3, Math.min(rect.width / (maxX - minX + 160), rect.height / (maxY - minY + 160))));
    onChange((current) => ({
      ...current,
      viewport: {
        zoom: nextZoom,
        x: (rect.width - (maxX - minX) * nextZoom) / 2 - minX * nextZoom,
        y: (rect.height - (maxY - minY) * nextZoom) / 2 - minY * nextZoom,
      },
    }));
  };

  const nodeById = useMemo(() => new Map(doc.nodes.map((node) => [node.id, node])), [doc.nodes]);

  const savedLabel =
    saving === 'saving'
      ? m['standard.saving']()
      : saving === 'error'
        ? m['standard.saveFailed']()
        : m['standard.saved']();

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#0d0e12] text-[#e8e9ee]">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-standard-upload="true"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          const nodeId = uploadTarget.current;
          event.currentTarget.value = '';
          uploadTarget.current = null;
          if (!file || !nodeId) return;
          const url = await onUpload(nodeId, file);
          if (url) patchNode(nodeId, { imageUrl: url });
        }}
      />

      {/* Dotted grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.09) 1px, transparent 0)',
          backgroundSize: `${28 * zoom}px ${28 * zoom}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
      />

      {/* Floating capsule bar */}
      <header className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-4">
        <div className="pointer-events-auto flex h-[46px] items-center gap-1 rounded-full border border-white/10 bg-[#16171c]/92 px-2 text-[12px] shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          <span className="grid size-8 place-items-center rounded-[9px] bg-white text-[11px] font-bold text-black">
            FG
          </span>
          <button
            type="button"
            aria-label={m['standard.back']()}
            onClick={() => window.history.back()}
            className="grid size-7 place-items-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="px-1 text-white/85" data-standard-project={projectName}>
            {projectName}
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10.5px] text-emerald-300">
            <Save className="size-3" />
            <span data-standard-save-state="true">{savedLabel}</span>
          </span>

          <span className="mx-1 h-5 w-px bg-white/10" />

          {(
            [
              ['project', m['standard.menu.project']()],
              ['assets', m['standard.menu.assets']()],
              ['model', m['standard.menu.model']()],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-standard-menu={key}
              onClick={() => setMenu((current) => (current === key ? null : key))}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-white/65 transition hover:bg-white/10 hover:text-white"
            >
              {label}
              <ChevronDown className="size-3" />
            </button>
          ))}

          {menu === 'assets' ? (
            <div className="absolute left-1/2 top-[54px] w-[260px] -translate-x-1/2 rounded-[14px] border border-white/10 bg-[#16171c] p-2 shadow-2xl">
              {(['role', 'scene', 'setting', 'shot'] as StandardNodeKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  data-standard-add={kind}
                  onClick={() => {
                    addNode(kind);
                    setMenu(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[12px] text-white/75 transition hover:bg-white/8 hover:text-white"
                >
                  {(() => {
                    const Icon = KIND_ICON[kind];
                    return <Icon className="size-3.5" />;
                  })()}
                  {KIND_LABEL[kind]()}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {/* Left rail */}
      <aside className="absolute left-3 top-1/2 z-30 -translate-y-1/2">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setRailOpen((open) => !open)}
            aria-label={m['standard.rail']()}
            className="flex items-center gap-1 rounded-full border border-white/10 bg-[#16171c]/92 px-2 py-3 text-[10.5px] text-white/70 backdrop-blur-xl transition hover:text-white"
            style={{ writingMode: 'vertical-rl' }}
          >
            <CircleDot className="size-3" />
            {m['standard.rail']()}
          </button>
          {railOpen ? (
            <div className="w-[168px] rounded-[14px] border border-white/10 bg-[#16171c]/92 p-2.5 text-[11.5px] text-white/60 backdrop-blur-xl">
              <p className="font-medium text-white/85">{m['standard.railTitle']()}</p>
              <p className="mt-1.5 leading-5">{m['standard.railBody']()}</p>
            </div>
          ) : null}
        </div>
      </aside>

      {/* Zoom stack */}
      <div className="absolute bottom-4 left-4 z-30 flex flex-col overflow-hidden rounded-[10px] border border-white/10 bg-[#16171c]/92 backdrop-blur-xl">
        <button
          type="button"
          data-standard-zoom="in"
          onClick={() => setZoom(zoom * 1.15)}
          className="grid size-8 place-items-center text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label={m['standard.zoomIn']()}
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          data-standard-zoom="out"
          onClick={() => setZoom(zoom / 1.15)}
          className="grid size-8 place-items-center border-t border-white/8 text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label={m['standard.zoomOut']()}
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          data-standard-zoom="fit"
          onClick={fit}
          className="grid size-8 place-items-center border-t border-white/8 text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label={m['standard.zoomFit']()}
        >
          <Aperture className="size-3.5" />
        </button>
        <button
          type="button"
          data-standard-zoom="reset"
          onClick={() =>
            onChange((current) => ({ ...current, viewport: { x: 0, y: 0, zoom: 1 } }))
          }
          className="grid size-8 place-items-center border-t border-white/8 text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label={m['standard.zoomReset']()}
        >
          <RotateCcw className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setLocked((value) => !value)}
          aria-pressed={locked}
          className={`grid size-8 place-items-center border-t border-white/8 transition hover:bg-white/10 ${
            locked ? 'text-[#7dd3fc]' : 'text-white/60 hover:text-white'
          }`}
          aria-label={m['standard.lock']()}
        >
          <Lock className="size-3.5" />
        </button>
      </div>

      {/* Board */}
      <div
        ref={rootRef}
        data-standard-surface="true"
        className="relative flex-1 overflow-hidden"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          setSelected(null);
          if (locked) return;
          setDrag({
            type: 'pan',
            startX: event.clientX,
            startY: event.clientY,
            originX: viewport.x,
            originY: viewport.y,
          });
        }}
        onWheel={(event) => {
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            setZoom(zoom * (event.deltaY > 0 ? 0.92 : 1.08));
          }
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${zoom})` }}
        >
          {/* Links */}
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            {doc.links.map((link) => {
              const from = nodeById.get(link.from);
              const to = nodeById.get(link.to);
              if (!from || !to) return null;
              const a = outputPort(from);
              const b = inputPort(to);
              return (
                <g key={link.id}>
                  <path d={linkPath(a, b)} stroke="rgba(125,211,252,0.45)" strokeWidth={2} fill="none" />
                  <circle cx={a.x} cy={a.y} r={3} fill="#7dd3fc" />
                  <circle cx={b.x} cy={b.y} r={3} fill="#7dd3fc" />
                </g>
              );
            })}
            {drag?.type === 'link' ? (
              (() => {
                const from = nodeById.get(drag.from);
                if (!from) return null;
                const a = outputPort(from);
                return (
                  <path
                    d={linkPath(a, { x: drag.pointerX, y: drag.pointerY })}
                    stroke="rgba(125,211,252,0.8)"
                    strokeDasharray="6 5"
                    strokeWidth={2}
                    fill="none"
                  />
                );
              })()
            ) : null}
          </svg>

          {doc.nodes.map((node) => {
            const Icon = KIND_ICON[node.kind];
            const isSelected = selected === node.id;
            return (
              <article
                key={node.id}
                data-standard-node={node.id}
                data-standard-kind={node.kind}
                className="absolute"
                style={{ left: node.x, top: node.y, width: node.width }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setSelected(node.id);
                  if (locked) return;
                  setDrag({
                    type: 'node',
                    id: node.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: node.x,
                    originY: node.y,
                  });
                }}
              >
                <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-white/55">
                  <Icon className="size-3.5" />
                  <span>{KIND_LABEL[node.kind]()}</span>
                  <span className="text-white/25">·</span>
                  <input
                    value={node.name}
                    onChange={(event) => patchNode(node.id, { name: event.target.value })}
                    placeholder={UNTITLED[node.kind]()}
                    data-standard-name={node.id}
                    className="min-w-0 flex-1 bg-transparent text-[11.5px] text-white/80 outline-none placeholder:text-white/30"
                  />
                  <button
                    type="button"
                    onClick={() => removeNode(node.id)}
                    className="grid size-5 place-items-center rounded text-white/25 transition hover:bg-white/10 hover:text-red-300"
                    aria-label={m['standard.delete']()}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>

                <div
                  className={`relative overflow-hidden rounded-[18px] border bg-[#15161b] transition ${
                    isSelected
                      ? 'border-white/85 shadow-[0_0_0_1px_rgba(255,255,255,0.5),0_24px_60px_-30px_rgba(0,0,0,0.9)]'
                      : 'border-white/10 hover:border-white/25'
                  }`}
                  style={{ height: node.height }}
                >
                  {node.kind === 'setting' ? (
                    <>
                      <p className="absolute left-3 top-2.5 text-[10.5px] text-white/35">
                        {m['standard.settingHint']()}
                      </p>
                      <textarea
                        value={node.text ?? ''}
                        onChange={(event) => patchNode(node.id, { text: event.target.value })}
                        data-standard-text={node.id}
                        placeholder={m['standard.settingPlaceholder']()}
                        className="size-full resize-none bg-transparent px-3 pb-3 pt-8 text-[12.5px] leading-6 text-white/85 outline-none placeholder:text-white/20"
                      />
                    </>
                  ) : node.imageUrl ? (
                    <>
                      <img src={node.imageUrl} alt="" className="size-full object-cover" />
                      <button
                        type="button"
                        onClick={() => {
                          uploadTarget.current = node.id;
                          fileRef.current?.click();
                        }}
                        className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2.5 py-1 text-[10.5px] text-white/85 backdrop-blur transition hover:bg-black/80"
                      >
                        {m['standard.replace']()}
                      </button>
                    </>
                  ) : (
                    <div className="grid size-full place-items-center">
                      <div className="text-center">
                        <ImageIcon className="mx-auto size-5 text-white/30" />
                        <p className="mt-1.5 text-[11px] text-white/35">{UNTITLED[node.kind]()}</p>
                        <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-white/55">
                          <button
                            type="button"
                            data-standard-upload-for={node.id}
                            onClick={() => {
                              uploadTarget.current = node.id;
                              fileRef.current?.click();
                            }}
                            className="inline-flex items-center gap-1 transition hover:text-white"
                          >
                            <Upload className="size-3" />
                            {m['standard.upload']()}
                          </button>
                          <a
                            href={`/assets`}
                            className="inline-flex items-center gap-1 transition hover:text-white"
                          >
                            <Layers className="size-3" />
                            {m['standard.fromLibrary']()}
                          </a>
                        </div>
                      </div>
                    </div>
                  )}

                </div>

                {/* Ports live outside the clipped card, or half of each dot is invisible
                    and the pointer cannot land on it. */}
                <button
                  type="button"
                  data-port-out={node.id}
                  style={{ top: 40 + node.height / 2 }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    const point = toCanvas(event.clientX, event.clientY);
                    setDrag({ type: 'link', from: node.id, pointerX: point.x, pointerY: point.y });
                  }}
                  aria-label={m['standard.portOut']()}
                  className="absolute -right-[6px] z-10 size-3.5 -translate-y-1/2 rounded-full border-2 border-[#0d0e12] bg-white transition hover:scale-125 hover:bg-[#7dd3fc]"
                />
                <button
                  type="button"
                  data-port-in={node.id}
                  style={{ top: 40 + node.height / 2 }}
                  aria-label={m['standard.portIn']()}
                  className="absolute -left-[6px] z-10 size-3.5 -translate-y-1/2 rounded-full border-2 border-[#0d0e12] bg-white/55 transition hover:scale-125 hover:bg-[#7dd3fc]"
                />
              </article>
            );
          })}
        </div>
      </div>

      {/* Composer */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
        <div className="pointer-events-auto w-full max-w-[820px] rounded-[18px] border border-white/10 bg-[#16171c]/94 p-3 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)] backdrop-blur-xl">
          <textarea
            value={doc.composer.prompt}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                composer: { ...current.composer, prompt: event.target.value },
              }))
            }
            placeholder={m['standard.composerPlaceholder']()}
            data-standard-composer="true"
            className="min-h-[54px] w-full resize-none bg-transparent text-[13px] leading-6 text-white/85 outline-none placeholder:text-white/25"
          />
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/55">
            <button
              type="button"
              data-standard-add-button="true"
              onClick={() => setMenu((current) => (current === 'assets' ? null : 'assets'))}
              className="grid size-7 place-items-center rounded-full border border-white/12 transition hover:bg-white/10 hover:text-white"
              aria-label={m['standard.addNode']()}
            >
              <Plus className="size-3.5" />
            </button>
            <span className="flex items-center gap-1 rounded-full border border-white/12 px-2 py-1">
              <Monitor className="size-3" />
              {m['standard.modelLocal']()}
            </span>
            <span className="rounded-full border border-white/12 px-2 py-1">8</span>
            <span className="flex items-center gap-1 rounded-full border border-white/12 px-2 py-1">
              <Wand2 className="size-3" />
              {m['standard.styleImage']()}
            </span>
            <span className="rounded-full border border-white/12 px-2 py-1">
              {m['standard.styleDefault']()}
            </span>
            <button
              type="button"
              data-standard-generate="true"
              onClick={() => {
                // Generation lands in the setting node first; the render call comes next
                onChange((current) => {
                  const prompt = current.composer.prompt.trim();
                  if (!prompt) return current;
                  const target = current.nodes.find((node) => node.kind === 'setting');
                  if (target) {
                    return {
                      ...current,
                      nodes: current.nodes.map((node) =>
                        node.id === target.id
                          ? { ...node, text: node.text ? `${node.text}\n${prompt}` : prompt }
                          : node
                      ),
                    };
                  }
                  return {
                    ...current,
                    nodes: [
                      ...current.nodes,
                      {
                        id: `setting-${Math.random().toString(36).slice(2, 10)}`,
                        kind: 'setting',
                        name: '',
                        x: 320,
                        y: 260,
                        width: 580,
                        height: 200,
                        imageUrl: null,
                        text: prompt,
                      },
                    ],
                  };
                });
              }}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-[12px] font-medium text-black transition hover:bg-white/90"
            >
              <Sparkles className="size-3.5" />
              {m['standard.generate']()}
            </button>
          </div>
        </div>
      </div>

      {/* Status line */}
      <p
        className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 text-[10.5px] text-white/30"
        data-standard-status="true"
      >
        {m['standard.status']({
          nodes: String(doc.nodes.length),
          links: String(doc.links.length),
          zoom: String(Math.round(zoom * 100)),
        })}
      </p>
      <span className="sr-only" data-project-id={projectId} data-locale={locale} />
    </div>
  );
}
