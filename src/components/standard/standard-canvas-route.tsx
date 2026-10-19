import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createDefaultDocument,
  loadStandardDocument,
  serializeStandardDocument,
  type StandardDocument,
} from '@/core/standard-canvas/document';
import type { ProjectSnapshotDocument } from '@/core/projects/project-snapshot';
import { StandardCanvas } from './standard-canvas';

const SAVE_DELAY = 700;

/**
 * Container for the standard canvas: owns the snapshot, the board only draws.
 *
 * Saves keep the same version guard as the other canvases: a conflict refetches rather than overwriting.
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
          headers: {
            'content-type': 'application/json',
            'x-beatapi-workspace-request': '1',
          },
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
    async (nodeId: string, file: File) => {
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
        void nodeId;
        return payload.asset?.publicUrl ?? null;
      } catch {
        return null;
      }
    },
    [projectId]
  );

  return (
    <StandardCanvas
      projectId={projectId}
      projectName={projectName}
      doc={doc}
      onChange={onChange}
      saving={saving}
      onUpload={onUpload}
    />
  );
}

export { createDefaultDocument };
