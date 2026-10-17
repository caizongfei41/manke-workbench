import type { ProjectSnapshotDocument } from '@/core/projects/project-snapshot';

/**
 * Saves the drama snapshot, negotiating the version.
 *
 * Projects are created with an initial empty snapshot, so a blind
 * `baseVersion: null` is rejected with 409. This fetches the current version and
 * retries once, which keeps the optimistic-concurrency guard intact while making
 * the common path (open, edit, save) just work.
 */
export async function putDramaSnapshot({
  projectId,
  drama,
  base,
  baseVersion,
}: {
  projectId: string;
  drama: string;
  /** Snapshot to build on; defaults to a blank document. */
  base?: ProjectSnapshotDocument | null;
  baseVersion?: number | null;
}): Promise<{ ok: boolean; version?: number; conflict?: boolean }> {
  const headers = {
    'content-type': 'application/json',
    'x-beatapi-workspace-request': '1',
  };

  const send = async (version: number | null) => {
    const document: ProjectSnapshotDocument = {
      ...(base?.canvasKind === 'drama'
        ? base
        : { version: 3 as const, cards: [], frames: {} }),
      canvasKind: 'drama',
      drama,
    };
    const res = await fetch(`/api/app/projects/${projectId}/snapshot`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ document, baseVersion: version }),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };

  let version = baseVersion ?? null;
  // 没拿到版本时先问一次，避免一上来就撞 409。
  if (version === null) {
    const current = await fetch(`/api/app/projects/${projectId}/snapshot`).then((r) =>
      r.json().catch(() => null)
    );
    version = typeof current?.version === 'number' ? current.version : null;
  }

  let result = await send(version);
  if (result.status === 409) {
    const fresh = await fetch(`/api/app/projects/${projectId}/snapshot`).then((r) =>
      r.json().catch(() => null)
    );
    const retryVersion = typeof fresh?.version === 'number' ? fresh.version : null;
    result = await send(retryVersion);
    if (result.status === 409) return { ok: false, conflict: true };
  }

  if (result.status >= 400) return { ok: false };
  return {
    ok: true,
    version: typeof result.json?.version === 'number' ? result.json.version : undefined,
  };
}
