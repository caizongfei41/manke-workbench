import type { WorkspaceMode } from '@/config/workspace-modes';
import type { ProjectGenerationItem } from '@/core/effects/project-generation-types';
import { apiJsonDelete, apiJsonGet, apiJsonPatch } from '@/lib/api-client';

export type WorkspaceProjectCardItem = {
  id: string;
  name: string;
  lastWorkspaceMode?: WorkspaceMode;
  activityAt: string;
  activityLabel: string;
  coverImageUrl?: string | null;
};

export type RecentAsset = {
  id: string;
  publicUrl: string;
  filename?: string | null;
  width: number | null;
  height: number | null;
  durationMs?: number | null;
  mimeType?: string | null;
  assetClass?: string | null;
  metadata?: unknown;
  createdAt: string | Date;
};

export type RecentAssetsResponse = {
  images: RecentAsset[];
  videos: RecentAsset[];
  audios: RecentAsset[];
};

export async function fetchRecentAssets(
  projectId?: string | null
): Promise<RecentAssetsResponse> {
  const query = projectId
    ? `?projectId=${encodeURIComponent(projectId)}`
    : '';
  return apiJsonGet<RecentAssetsResponse>(`/api/app/recent-assets${query}`);
}

export async function fetchWorkspaceProjects(): Promise<{
  projects: WorkspaceProjectCardItem[];
  total: number;
}> {
  // 项目页要能看到全部。以前固定走默认的 24 条上限，项目超过 24 个之后
  // 后面的在列表里根本看不到 —— 批量清理时删掉一页又冒出下一页就是这个。
  const payload = await apiJsonGet<{
    projects: WorkspaceProjectCardItem[];
    total?: number;
  }>('/api/app/projects?all=1');
  return {
    projects: payload.projects,
    total: payload.total ?? payload.projects.length,
  };
}

export async function renameWorkspaceProject(projectId: string, name: string) {
  return apiJsonPatch<{ id: string; name: string }>(
    `/api/app/projects/${encodeURIComponent(projectId)}`,
    { name }
  );
}

export async function deleteWorkspaceProjects(projectIds: string[]) {
  return apiJsonDelete<{ success: true }>('/api/app/projects', { projectIds });
}

export async function fetchProjectGenerations(projectId: string) {
  return apiJsonGet<{ items: ProjectGenerationItem[] }>(
    `/api/app/projects/${encodeURIComponent(projectId)}/generations`
  );
}
