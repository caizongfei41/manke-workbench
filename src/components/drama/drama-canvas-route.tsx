import { useCallback, useEffect, useRef, useState } from 'react';

import { DramaCanvas } from '@/components/drama/drama-canvas';
import { putDramaSnapshot } from '@/core/drama/save-drama-snapshot';
import type { ProjectSnapshotDocument } from '@/core/projects/project-snapshot';
import { m } from '@/paraglide/messages.js';

/**
 * Wraps the drama canvas with snapshot persistence.
 *
 * The drama state lives in the project snapshot as a JSON string next to
 * `canvasKind`, so reopening the project from the project list lands back in the
 * same pipeline. Saves are version-guarded like the freeform canvas: a conflict
 * refetches the version instead of clobbering someone else's write.
 */
export function DramaCanvasRoute({
  projectId,
  snapshot,
  snapshotVersion,
}: {
  projectId: string;
  snapshot?: ProjectSnapshotDocument | null;
  snapshotVersion?: number | null;
}) {
  const [dramaJson, setDramaJson] = useState<string | null>(snapshot?.drama ?? null);
  const versionRef = useRef<number | null>(snapshotVersion ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const savingRef = useRef(false);

  const persist = useCallback(
    (nextDrama: string) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setDramaJson(nextDrama);

      const base = snapshot?.canvasKind === 'drama' ? snapshot : { version: 3 as const, cards: [], frames: {} };
      const document: ProjectSnapshotDocument = {
        ...base,
        canvasKind: 'drama',
        drama: nextDrama,
      };

      void putDramaSnapshot({
        projectId,
        drama: nextDrama,
        base: snapshot,
        baseVersion: versionRef.current,
      })
        .then((result) => {
          if (result.version !== undefined) versionRef.current = result.version;
          setNotice(result.ok ? null : result.conflict ? m['drama.save.conflict']() : m['drama.save.failed']());
        })
        .catch(() => setNotice(m['drama.save.failed']()))
        .finally(() => {
          savingRef.current = false;
        });
    },
    [projectId, snapshot]
  );

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="relative h-full w-full">
      <DramaCanvas projectId={projectId} initialDocument={dramaJson} onPersist={persist} />
      {notice ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-[var(--beat-surface-2)] px-3 py-1.5 text-[13px] text-[var(--beat-text-2)] shadow-lg">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
