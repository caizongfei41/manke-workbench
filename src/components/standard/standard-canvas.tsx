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
  onGenerate,
  generating,
  generationError,
  onSendToEditor,
}: {
  projectId: string;
  projectName: string;
  doc: StandardDocument;
  onChange: (updater: (current: StandardDocument) => StandardDocument) => void;
  saving: 'idle' | 'saving' | 'saved' | 'error';
  onUpload: (nodeId: string, file: File) => Promise<string | null>;
  onGenerate: (nodeId: string, mode?: 'image' | 'video') => Promise<void>;
  generating: string | null;
  generationError: string | null;
  onSendToEditor: (assetId: string, name: string) => Promise<string | null>;
}) {
  const locale = normalizeLocale('zh');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploadTarget = useRef<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [locked, setLocked] = useState(false);
  const [menu, setMenu] = useState<'project' | 'assets' | 'model' | null>(null);
  const [handedOver, setHandedOver] = useState<Record<string, string>>({});

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

  // A board nobody has panned yet is still in its default viewport; fit it once so the
  // content uses the panel instead of sitting in the top-left corner.
  const fittedOnce = useRef(false);
  useEffect(() => {
    if (fittedOnce.current || doc.nodes.length === 0) return;
    const pristine = doc.viewport.x === 0 && doc.viewport.y === 0 && doc.viewport.zoom === 1;
    if (!pristine) { fittedOnce.current = true; return; }
    fittedOnce.current = true;
    const timer = setTimeout(() => fit(), 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.nodes.length]);


  const savedLabel =
    saving === 'saving'
      ? m['standard.saving']()
      : saving === 'error'
        ? m['standard.saveFailed']()
        : m['standard.saved']();

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col gap-2.5 overflow-hidden bg-[var(--beat-bg)] p-3 text-[var(--beat-text-1)] sm:p-4">
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
            'radial-gradient(circle at 1px 1px, var(--beat-grid-dot) 1px, transparent 0)',
          backgroundSize: `${28 * zoom}px ${28 * zoom}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
      />

      {/* Floating capsule bar */}
      {/* Canvas tools only: the shell above already carries the project name, the tabs and
          the monitor. One slim row, readable size, no second navigation. */}
      <div className="relative z-30 flex shrink-0 flex-wrap items-center gap-2">
        <div className="beat-glass flex h-11 min-w-0 flex-1 items-center gap-1 rounded-[14px] pl-1.5 pr-1.5 text-[13px]">
          <button
            type="button"
            data-standard-add-button="true"
            onClick={() => setMenu((current) => (current === 'assets' ? null : 'assets'))}
            className="flex items-center gap-2 rounded-full px-3 py-2 text-[13px] text-[var(--beat-text-2)] transition hover:bg-ink/[0.07] hover:text-ink"
          >
            <Plus className="size-3.5" />
            {m['standard.addNode']()}
          </button>
          <span className="mx-0.5 h-5 w-px bg-ink/[0.1]" />
          <span className="flex items-center gap-1.5 px-2 text-[12.5px] text-[var(--beat-text-2)]">
            <Save className="size-3" />
            <span data-standard-save-state="true">{savedLabel}</span>
          </span>
        </div>

        <div className="beat-glass flex h-11 shrink-0 items-center gap-0.5 rounded-[14px] px-1.5 text-[13px]">
          <button
            type="button"
            data-standard-zoom="out"
            onClick={() => setZoom(zoom / 1.15)}
            aria-label={m['standard.zoomOut']()}
            className="grid size-8 place-items-center rounded-full text-[var(--beat-text-2)] transition hover:bg-ink/[0.07] hover:text-ink"
          >
            <Minus className="size-3.5" />
          </button>
          <span className="min-w-[44px] text-center text-[12.5px] tabular-nums text-[var(--beat-text-2)]">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            data-standard-zoom="in"
            onClick={() => setZoom(zoom * 1.15)}
            aria-label={m['standard.zoomIn']()}
            className="grid size-8 place-items-center rounded-full text-[var(--beat-text-2)] transition hover:bg-ink/[0.07] hover:text-ink"
          >
            <Plus className="size-3.5" />
          </button>
          <span className="mx-0.5 h-5 w-px bg-ink/[0.1]" />
          <button
            type="button"
            data-standard-zoom="fit"
            onClick={fit}
            aria-label={m['standard.zoomFit']()}
            className="grid size-8 place-items-center rounded-full text-[var(--beat-text-2)] transition hover:bg-ink/[0.07] hover:text-ink"
          >
            <Aperture className="size-3.5" />
          </button>
          <button
            type="button"
            data-standard-zoom="reset"
            onClick={() => onChange((current) => ({ ...current, viewport: { x: 0, y: 0, zoom: 1 } }))}
            aria-label={m['standard.zoomReset']()}
            className="grid size-8 place-items-center rounded-full text-[var(--beat-text-2)] transition hover:bg-ink/[0.07] hover:text-ink"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setLocked((value) => !value)}
            aria-pressed={locked}
            aria-label={m['standard.lock']()}
            className={`grid size-8 place-items-center rounded-full transition hover:bg-ink/[0.07] ${
              locked ? 'text-[var(--beat-accent)]' : 'text-[var(--beat-text-2)] hover:text-ink'
            }`}
          >
            <Lock className="size-3.5" />
          </button>
        </div>

        {menu === 'assets' ? (
          <div className="pointer-events-auto absolute left-4 top-[52px] w-[240px] rounded-[14px] border border-ink/[0.1] bg-[var(--beat-surface)] p-2 shadow-[var(--beat-card-shadow)]">
            {(['role', 'scene', 'setting', 'shot'] as StandardNodeKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                data-standard-add={kind}
                onClick={() => {
                  addNode(kind);
                  setMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[12.5px] text-[var(--beat-text-2)] transition hover:bg-ink/[0.06] hover:text-ink"
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


      {/* Board */}
      <div
        ref={rootRef}
        data-standard-surface="true"
        className="relative min-h-0 flex-1 overflow-hidden rounded-[20px] border border-ink/[0.08] bg-[var(--beat-surface-2)] shadow-[0_1px_0_rgba(255,255,255,0.6)_inset]"
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
                <div className="mb-2 flex items-center gap-1.5 text-[12.5px] text-[var(--beat-text-2)]">
                  <Icon className="size-3.5" />
                  <span>{KIND_LABEL[node.kind]()}</span>
                  <span className="text-[var(--beat-text-3)]">·</span>
                  <input
                    value={node.name}
                    onChange={(event) => patchNode(node.id, { name: event.target.value })}
                    placeholder={UNTITLED[node.kind]()}
                    data-standard-name={node.id}
                    className="min-w-0 flex-1 bg-transparent text-[12.5px] text-white/80 outline-none placeholder:text-[var(--beat-text-3)]"
                  />
                  <button
                    type="button"
                    onClick={() => removeNode(node.id)}
                    className="grid size-5 place-items-center rounded text-[var(--beat-text-3)] transition hover:bg-ink/[0.07] hover:text-red-300"
                    aria-label={m['standard.delete']()}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>

                <div
                  className={`relative overflow-hidden rounded-[18px] border bg-[var(--beat-surface)] transition ${
                    isSelected
                      ? 'border-white/85 shadow-[0_0_0_1px_rgba(255,255,255,0.5),0_24px_60px_-30px_rgba(0,0,0,0.9)]'
                      : 'border-ink/[0.1] hover:border-white/25'
                  }`}
                  style={{ height: node.height }}
                >
                  {node.kind === 'setting' ? (
                    <>
                      <p className="absolute left-3 top-2.5 text-[12px] text-[var(--beat-text-3)]">
                        {m['standard.settingHint']()}
                      </p>
                      <textarea
                        value={node.text ?? ''}
                        onChange={(event) => patchNode(node.id, { text: event.target.value })}
                        data-standard-text={node.id}
                        placeholder={m['standard.settingPlaceholder']()}
                        className="size-full resize-none bg-transparent px-3 pb-3 pt-8 text-[12.5px] leading-6 text-[var(--beat-text-1)] outline-none placeholder:text-[var(--beat-text-3)]"
                      />
                    </>
                  ) : node.imageUrl ? (
                    <>
                      {node.mediaKind === 'video' ? (
                        <video
                          src={node.imageUrl}
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          data-standard-video={node.id}
                          onMouseEnter={(event) => void event.currentTarget.play().catch(() => {})}
                          onMouseLeave={(event) => event.currentTarget.pause()}
                          className="size-full object-cover"
                        />
                      ) : (
                        <img src={node.imageUrl} alt="" className="size-full object-cover" />
                      )}
                      <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                        {node.kind === 'shot' && node.mediaKind === 'video' ? (
                          <>
                          <button
                            type="button"
                            data-standard-send-editor={node.id}
                            onClick={async (event) => {
                              event.stopPropagation();
                              const match = /\/assets\/([^/?#]+)/.exec(node.imageUrl ?? '');
                              if (!match) return;
                              const editorProjectId = await onSendToEditor(
                                match[1],
                                node.name || node.kind
                              );
                              if (editorProjectId) {
                                setHandedOver((current) => ({ ...current, [node.id]: editorProjectId }));
                              }
                            }}
                            className="rounded-full bg-[#7dd3fc] px-2.5 py-1 text-[12px] font-medium text-[var(--beat-accent-ink)] transition hover:bg-[#a5e3ff]"
                          >
                            {handedOver[node.id] ? m['standard.sentToEditor']() : m['standard.sendToEditor']()}
                          </button>
                          {handedOver[node.id] ? (
                            <a
                              href={`/zh/editor/${handedOver[node.id]}`}
                              className="rounded-full bg-[var(--beat-accent)] px-2.5 py-1 text-[12px] font-medium text-[var(--beat-accent-ink)] transition hover:bg-white"
                            >
                              {m['standard.openEditor']()}
                            </a>
                          ) : null}
                          </>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            uploadTarget.current = node.id;
                            fileRef.current?.click();
                          }}
                          className="rounded-full bg-black/60 px-2.5 py-1 text-[12px] text-[var(--beat-text-1)] backdrop-blur transition hover:bg-black/80"
                        >
                          {m['standard.replace']()}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="grid size-full place-items-center">
                      <div className="text-center">
                        <ImageIcon className="mx-auto size-5 text-[var(--beat-text-3)]" />
                        <p className="mt-1.5 text-[12px] text-[var(--beat-text-3)]">{UNTITLED[node.kind]()}</p>
                        <div className="mt-3 flex items-center justify-center gap-3 text-[12px] text-[var(--beat-text-2)]">
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
                  className="absolute -right-[6px] z-10 size-3.5 -translate-y-1/2 rounded-full border-2 border-[#0d0e12] bg-[var(--beat-accent)] transition hover:scale-125 hover:bg-[#7dd3fc]"
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
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-3">
        <div className="beat-glass pointer-events-auto w-full max-w-[780px] rounded-[16px] p-2.5 sm:p-3">
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
            className="min-h-[56px] w-full resize-none bg-transparent text-[13.5px] leading-6 text-[var(--beat-text-1)] outline-none placeholder:text-[var(--beat-text-3)]"
          />
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--beat-text-2)]">
            <button
              type="button"
              data-standard-add-button="true"
              onClick={() => setMenu((current) => (current === 'assets' ? null : 'assets'))}
              className="grid size-7 place-items-center rounded-full border border-ink/[0.12] transition hover:bg-ink/[0.07] hover:text-white"
              aria-label={m['standard.addNode']()}
            >
              <Plus className="size-3.5" />
            </button>
            <span className="hidden items-center gap-1 rounded-full border border-ink/[0.12] px-2 py-1 sm:flex">
              <Monitor className="size-3" />
              {m['standard.modelLocal']()}
            </span>
            <span className="hidden rounded-full border border-ink/[0.12] px-2 py-1 sm:inline">8</span>
            <span className="hidden items-center gap-1 rounded-full border border-ink/[0.12] px-2 py-1 sm:flex">
              <Wand2 className="size-3" />
              {m['standard.styleImage']()}
            </span>
            <span className="hidden rounded-full border border-ink/[0.12] px-2 py-1 sm:inline">
              {m['standard.styleDefault']()}
            </span>
            <button
              type="button"
              data-standard-generate="true"
              disabled={generating !== null}
              onClick={() => {
                const prompt = doc.composer.prompt.trim();
                // The composer text goes into the setting card first, then the render runs
                // on it — so what is on the board is always what was sent.
                const target =
                  doc.nodes.find((node) => node.id === selected) ??
                  doc.nodes.find((node) => node.kind === 'setting');
                if (!target) return;
                if (prompt) {
                  onChange((current) => ({
                    ...current,
                    nodes: current.nodes.map((node) =>
                      node.id === target.id
                        ? { ...node, text: node.text ? `${node.text}\n${prompt}` : prompt }
                        : node
                    ),
                  }));
                }
                setSelected(target.id);
                void onGenerate(target.id, 'image');
              }}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[var(--beat-accent)] px-4 py-1.5 text-[12px] font-medium text-[var(--beat-accent-ink)] transition hover:bg-[var(--beat-accent-hover)] disabled:opacity-55"
            >
              <Sparkles className={`size-3.5 ${generating ? 'animate-pulse' : ''}`} />
              {generating ? m['standard.generating']() : m['standard.generate']()}
            </button>
            <button
              type="button"
              data-standard-generate-video="true"
              disabled={generating !== null}
              title={m['standard.videoHint']()}
              onClick={() => {
                const target =
                  doc.nodes.find((node) => node.id === selected) ??
                  doc.nodes.find((node) => node.kind === 'setting');
                if (!target) return;
                setSelected(target.id);
                void onGenerate(target.id, 'video');
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[12px] text-[var(--beat-text-2)] transition hover:border-white/35 hover:text-white disabled:opacity-55"
            >
              <Clapperboard className="size-3.5" />
              {m['standard.generateVideo']()}
            </button>
          </div>
        </div>
      </div>

      {/* Status line */}
      <p
        className="absolute bottom-1 left-1/2 z-20 hidden -translate-x-1/2 text-[12px] text-[var(--beat-text-3)] sm:block"
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
