import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createDefaultDocument,
  loadStandardDocument,
  serializeStandardDocument,
  STANDARD_IMAGE_MODEL_ID,
  type StandardDocument,
  type StandardNode,
} from '@/core/standard-canvas/document';
import type { ProjectSnapshotDocument } from '@/core/projects/project-snapshot';
import { StandardCanvas } from './standard-canvas';

const SAVE_DELAY = 700;
const POLL_INTERVAL = 4000;
const POLL_ROUNDS = 90;


const MUTATION_HEADERS = {
  'content-type': 'application/json',
  'x-beatapi-workspace-request': '1',
};

/**
 * Container for the standard canvas: owns the snapshot and the generation call, the board
 * only draws.
 *
 * Generation is text to image. Reference plates would need the upload-intent dance the
 * studio does, so for now the linked cards contribute their text, not their pixels.
 */
export function StandardCanvasRoute({
  projectId,
  projectName,
  snapshot,
  snapshotVersion,
}: {
  projectId: string;
  projectName: string;
  snapshot: ProjectSnapshotDocument | null;
  snapshotVersion: number | null;
}) {
  const [doc, setDoc] = useState<StandardDocument>(() =>
    loadStandardDocument((snapshot as { standard?: string } | null)?.standard)
  );
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [generating, setGenerating] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const versionRef = useRef(snapshotVersion);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  // Persist the seeded board immediately so the next visit finds the same one
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      void persist(doc);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback(
    async (next: StandardDocument) => {
      setSaving('saving');
      try {
        const base = snapshot ?? { version: 3, cards: [], frames: {} };
        const written = await fetch(`/api/app/projects/${projectId}/snapshot`, {
          method: 'PUT',
          headers: MUTATION_HEADERS,
          body: JSON.stringify({
            baseVersion: versionRef.current,
            document: {
              ...base,
              canvasKind: 'standard',
              standard: serializeStandardDocument(next),
            },
          }),
        });
        if (!written.ok) throw new Error(String(written.status));
        const payload = (await written.json()) as { version?: number };
        if (typeof payload.version === 'number') versionRef.current = payload.version;
        setSaving('saved');
      } catch {
        setSaving('error');
      }
    },
    [projectId, snapshot]
  );

  const onChange = useCallback(
    (updater: (current: StandardDocument) => StandardDocument) => {
      setDoc((current) => {
        const next = updater(current);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => void persist(next), SAVE_DELAY);
        return next;
      });
    },
    [persist]
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const onUpload = useCallback(
    async (_nodeId: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('assetClass', 'original');
      try {
        const response = await fetch(`/api/app/projects/${projectId}/assets`, {
          method: 'POST',
          headers: { 'x-beatapi-workspace-request': '1' },
          body: form,
        });
        if (!response.ok) return null;
        const payload = (await response.json()) as { asset?: { publicUrl?: string } };
        return payload.asset?.publicUrl ?? null;
      } catch {
        return null;
      }
    },
    [projectId]
  );

  const generate = useCallback(
    async (nodeId: string) => {
      const target = doc.nodes.find((node) => node.id === nodeId);
      if (!target) return;
      setGenerating(nodeId);
      setGenerationError(null);

      try {
        // The linked cards describe the shot; folding their text in means the prompt is
        // the whole scene, not whatever happens to sit in one box.
        const linked = doc.links
          .filter((link) => link.to === nodeId)
          .map((link) => doc.nodes.find((node) => node.id === link.from))
          .filter((node): node is StandardNode => Boolean(node));
        const parts = [
          target.text?.trim() || target.name.trim(),
          ...linked.map((node) => [node.name.trim(), node.text?.trim()].filter(Boolean).join('：')),
        ].filter(Boolean);
        const prompt = parts.join('\n') || doc.composer.prompt.trim();
        if (!prompt) {
          setGenerationError('empty');
          setGenerating(null);
          return;
        }

        const generation = {
          version: 2,
          projectId,
          modelId: STANDARD_IMAGE_MODEL_ID,
          mode: 'image',
          prompt,
          references: [],
          parameters: { aspect_ratio: '16:9' },
        };

        const precheck = await fetch('/api/effects/precheck', {
          method: 'POST',
          headers: MUTATION_HEADERS,
          body: JSON.stringify({ generation, expectedUploadCount: 0 }),
        }).then((response) => response.json() as Promise<{ uploadIntentToken?: string }>);

        const submitted = await fetch('/api/effects/generate', {
          method: 'POST',
          headers: MUTATION_HEADERS,
          body: JSON.stringify({ generation, generationIntentToken: precheck.uploadIntentToken }),
        }).then((response) => response.json() as Promise<{ wmTaskId?: string; error?: string }>);

        if (!submitted.wmTaskId) throw new Error(submitted.error ?? 'no task');

        // A 2MP still takes about a minute on this card.
        for (let round = 0; round < POLL_ROUNDS; round += 1) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
          const status = await fetch(`/api/effects/status?wmTaskId=${submitted.wmTaskId}`).then(
            (response) => response.json() as Promise<{ status?: string; error?: string }>
          );
          if (status.status === 'failed') throw new Error(status.error ?? 'generation failed');
          if (status.status !== 'succeeded') continue;

          const gens = await fetch(`/api/app/projects/${projectId}/generations`).then(
            (response) =>
              response.json() as Promise<{ items?: { id: string; resultUrl?: string | null }[] }>
          );
          const resultUrl = (gens.items ?? []).find((item) => item.id === submitted.wmTaskId)
            ?.resultUrl;
          if (!resultUrl) throw new Error('no result');

          onChange((current) => {
            const nextNodes = current.nodes.map((node) =>
              node.id === nodeId ? { ...node, imageUrl: resultUrl } : node
            );
            // The take gets its own shot card, so regenerating never destroys the last one.
            const shot: StandardNode = {
              id: `shot-${Math.random().toString(36).slice(2, 10)}`,
              kind: 'shot',
              name: target.name ? `${target.name} · take` : '',
              x: target.x + target.width + 60,
              y: target.y,
              width: 320,
              height: 200,
              imageUrl: resultUrl,
              text: '',
            };
            return { ...current, nodes: [...nextNodes, shot] };
          });
          setGenerating(null);
          return;
        }
        throw new Error('timeout');
      } catch (error) {
        setGenerationError(String(error).slice(0, 160));
        setGenerating(null);
      }
    },
    [doc.composer.prompt, doc.links, doc.nodes, onChange, projectId]
  );

  return (
    <StandardCanvas
      projectId={projectId}
      projectName={projectName}
      doc={doc}
      onChange={onChange}
      saving={saving}
      onUpload={onUpload}
      onGenerate={generate}
      generating={generating}
      generationError={generationError}
    />
  );
}

export { createDefaultDocument };
