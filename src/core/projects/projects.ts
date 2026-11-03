
import { randomUUID } from 'crypto';
import { getDb } from '@/core/workspace-lib/db-adapter';
import {
  generationAssetLink,
  project,
  projectAssetMembership,
  projectCanvasState,
  userAsset,
} from '@/config/db/schema';
import { trashLocalProjectAssets } from '@/core/projects/local-project-assets';
import {
  type ProjectSnapshotDocument,
  createEmptyProjectSnapshot,
  hasProjectSnapshotVersionConflict,
  isDestructiveEmptyProjectSnapshot,
  normalizeProjectSnapshotDocument,
} from '@/core/projects/project-snapshot';
import { and, count, desc, eq, getTableColumns } from 'drizzle-orm';
import {
  defaultWorkspaceMode,
  resolveWorkspaceMode,
  type WorkspaceMode,
} from '@/config/workspace-modes';

const DEFAULT_PROJECT_NAME = 'Untitled project';

const trimProjectName = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_PROJECT_NAME;
};

/**
 * 最近一次建项目的记录，用来挡住重复提交。
 *
 * 前端已经把按钮锁住了，但那只管一个标签页。双击、两个窗口、或者哪天后端
 * 被别的调用方直接打，都会各建一个项目 —— 实测就出现过点一次「画布」result
 * 出两个项目的情况。这里按「同样的名字 + 两秒内」判重，直接返回上一个，
 * 不再新建。
 */
let lastCreate: { name: string; mode: WorkspaceMode; at: number; id: string } | null = null;
const DUPLICATE_WINDOW_MS = 2000;

export const createProject = async ({
  name,
  initialSnapshot,
  workspaceMode = defaultWorkspaceMode,
}: {
  name?: string | null;
  initialSnapshot?: ProjectSnapshotDocument;
  workspaceMode?: WorkspaceMode;
}) => {
  const db = await getDb();
  const now = new Date();
  const trimmedName = trimProjectName(name);
  const mode = resolveWorkspaceMode(workspaceMode);

  // 两秒内同名同模式 → 认为是同一次点击的重放
  if (
    lastCreate &&
    lastCreate.name === trimmedName &&
    lastCreate.mode === mode &&
    Date.now() - lastCreate.at < DUPLICATE_WINDOW_MS
  ) {
    const existing = await db
      .select()
      .from(project)
      .where(eq(project.id, lastCreate.id))
      .limit(1);
    if (existing.length > 0) {
      return {
        id: lastCreate.id,
        name: trimmedName,
        snapshot: initialSnapshot ?? createEmptyProjectSnapshot(),
      };
    }
  }

  const id = randomUUID();
  const document = initialSnapshot ?? createEmptyProjectSnapshot();

  await db.insert(project).values({
    id,
    name: trimmedName,
    coverAssetId: null,
    status: 'active',
    currentStateVersion: 1,
    lastWorkspaceMode: mode,
    lastOpenedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(projectCanvasState).values({
    projectId: id,
    documentJson: document,
    version: 1,
    updatedAt: now,
  });

  lastCreate = { name: trimmedName, mode, at: Date.now(), id };

  return {
    id,
    name: trimmedName,
    snapshot: document,
  };
};

/**
 * 项目列表。
 *
 * 以前只有 limit、没有 offset，而且默认 24 —— 调用方不传参就永远只能看到前 24 个，
 * 后面的项目在界面上「消失」了（批量清理时删完一页又冒出一页，就是这个原因）。
 * 现在 limit/offset 都能传，limit 传 null 表示不分页。
 */
export const loadProjects = async ({
  limit = 24,
  offset = 0,
}: {
  limit?: number | null;
  offset?: number;
}) => {
  const db = await getDb();
  const query = db
    .select({
      ...getTableColumns(project),
      coverImageUrl: userAsset.publicUrl,
    })
    .from(project)
    .leftJoin(userAsset, eq(project.coverAssetId, userAsset.id))
    .where(eq(project.status, 'active'))
    .orderBy(
      desc(project.lastOpenedAt),
      desc(project.updatedAt),
      desc(project.createdAt)
    );

  const paged = limit === null ? query : query.limit(limit).offset(offset);
  const projects = await paged;

  return projects.map((entry: any) => ({
    ...entry,
    coverImageUrl: entry.coverImageUrl?.trim() || null,
  }));
};

/** 未删除的项目总数，给前端算分页用。 */
export const countProjects = async () => {
  const db = await getDb();
  const rows = await db
    .select({ value: count() })
    .from(project)
    .where(eq(project.status, 'active'));
  return Number(rows[0]?.value ?? 0);
};

export const getProject = async ({
  projectId,
}: {
  projectId: string;
}) => {
  const db = await getDb();
  const rows = await db
    .select()
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  return rows[0] ?? null;
};

export const getActiveProject = async ({
  projectId,
}: {
  projectId: string;
}) => {
  const currentProject = await getProject({ projectId });
  return currentProject?.status === 'active' ? currentProject : null;
};

export const renameProject = async ({
  projectId,
  name,
}: {
  projectId: string;
  name: string;
}) => {
  const nextName = trimProjectName(name);
  const db = await getDb();
  await db
    .update(project)
    .set({
      name: nextName,
      updatedAt: new Date(),
    })
    .where(eq(project.id, projectId));

  return nextName;
};

export const markProjectOpened = async ({
  projectId,
  workspaceMode,
}: {
  projectId: string;
  workspaceMode?: WorkspaceMode;
}) => {
  const db = await getDb();
  const now = new Date();
  await db
    .update(project)
    .set({
      lastOpenedAt: now,
      ...(workspaceMode
        ? { lastWorkspaceMode: resolveWorkspaceMode(workspaceMode) }
        : {}),
    })
    .where(eq(project.id, projectId));
};

export const loadProjectWithLatestSnapshot = async ({
  projectId,
}: {
  projectId: string;
}) => {
  const db = await getDb();
  const currentProject = await getActiveProject({ projectId });
  if (!currentProject) {
    return null;
  }

  const snapshotRows = await db
    .select()
    .from(projectCanvasState)
    .where(eq(projectCanvasState.projectId, projectId))
    .limit(1);

  return {
    project: currentProject,
    snapshotVersion: snapshotRows[0]?.version ?? 1,
    snapshot: normalizeProjectSnapshotDocument(
      snapshotRows[0]?.documentJson ?? createEmptyProjectSnapshot()
    ),
  };
};

/**
 * 删除项目，连同它的资产。
 *
 * 以前这里只把 project.status 改成 'deleted'，资产表一行不动、磁盘一个字节不删。
 * 结果每轮清理之后都留下一堆只在数据库里存在的项目：文件已经不在了，
 * asset 记录还指着它，素材库点开全是 404，而磁盘占用一直降不下去
 * （一次清理攒出 1230 条这种记录，占了 195 MB）。
 *
 * 现在的顺序：
 *   1. 先把资产目录移进回收站 —— 可恢复，且不占用项目资产的活目录
 *   2. 删掉关联表里的行（membership / generation link）
 *   3. 删掉该项目的 asset 行
 *   4. 最后软删项目本身
 *
 * 文件先走、记录后走：万一第 2、3 步抛错，文件已经在回收站里，
 * 记录还完整，重试一次就能收尾；反过来则会留下永远找不到文件的孤儿记录。
 */
export const deleteProjects = async ({
  projectIds,
}: {
  projectIds: string[];
}) => {
  if (projectIds.length === 0) return;

  const db = await getDb();
  const now = new Date();

  for (const projectId of projectIds) {
    // 1. 资产文件移进回收站
    try {
      await trashLocalProjectAssets({ projectId });
    } catch (error) {
      // 目录不存在是正常情况（项目从没上传过东西），其余错误不该阻断删除
      console.error('[projects] move assets to trash failed:', projectId, error);
    }

    // 2. 关联表
    const memberships = await db
      .select({ id: projectAssetMembership.id })
      .from(projectAssetMembership)
      .where(eq(projectAssetMembership.projectId, projectId));
    if (memberships.length > 0) {
      await db
        .delete(projectAssetMembership)
        .where(eq(projectAssetMembership.projectId, projectId));
    }

    // 3. asset 行：软删。
    //
    //    以前这里是 db.delete(userAsset)，文件虽然被 trashLocalProjectAssets
    //    挪进了回收站，数据库记录却永久没了 —— 恢复时找不到对应行，等于没救。
    //    现在只打 deletedAt 时间戳，回收站靠它列表、算 7 天到期，真正删除
    //    留给 trash 的清理逻辑。
    const owned = await db
      .select({ id: userAsset.id, originProjectId: userAsset.originProjectId })
      .from(userAsset)
      .where(eq(userAsset.originProjectId, projectId));
    const all = await db
      .select({ id: userAsset.id, objectKey: userAsset.objectKey })
      .from(userAsset);
    const byPrefix = all.filter((row: { id: string; objectKey: string | null }) =>
      String(row.objectKey ?? '').startsWith(`${projectId}/`)
    );
    const doomed = new Set<string>([
      ...owned.map((row: { id: string }) => row.id),
      ...byPrefix.map((row: { id: string }) => row.id),
    ]);

    for (const assetId of doomed) {
      await db.delete(generationAssetLink).where(eq(generationAssetLink.assetId, assetId));
      await db
        .update(userAsset)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(userAsset.id, assetId));
    }

    // 4. 项目本身
    await db
      .update(project)
      .set({
        status: 'deleted',
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(project.id, projectId));
  }
};

export const saveProjectSnapshot = async ({
  projectId,
  document,
  baseVersion,
  allowEmpty = false,
}: {
  projectId: string;
  document: ProjectSnapshotDocument;
  baseVersion?: number | null;
  allowEmpty?: boolean;
}) => {
  const db = await getDb();
  const currentProject = await getActiveProject({ projectId });
  if (!currentProject) {
    throw new Error('Project not found');
  }

  const normalizedDocument = normalizeProjectSnapshotDocument(document);
  const stateRows = await db
    .select()
    .from(projectCanvasState)
    .where(eq(projectCanvasState.projectId, projectId))
    .limit(1);

  const currentState = stateRows[0] ?? null;
  const previousDocument = currentState
    ? normalizeProjectSnapshotDocument(currentState.documentJson)
    : null;
  if (
    previousDocument &&
    isDestructiveEmptyProjectSnapshot({
      previous: previousDocument,
      next: normalizedDocument,
    }) &&
    !allowEmpty
  ) {
    const error = new Error(
      'Refusing to replace a non-empty project snapshot with an unconfirmed empty snapshot'
    );
    error.name = 'ProjectSnapshotDestructiveEmptyRejected';
    throw error;
  }
  const nextSerialized = JSON.stringify(normalizedDocument);
  const previousSerialized = previousDocument
    ? JSON.stringify(previousDocument)
    : null;

  const throwVersionConflict = (currentVersion: number) => {
    const error = new Error('Project snapshot version conflict') as Error & {
      currentVersion?: number;
    };
    error.name = 'ProjectSnapshotVersionConflict';
    error.currentVersion = currentVersion;
    throw error;
  };

  if (
    currentState &&
    hasProjectSnapshotVersionConflict({
      currentVersion: currentState.version,
      baseVersion,
      documentChanged: previousSerialized !== nextSerialized,
    })
  ) {
    throwVersionConflict(currentState.version);
  }
  const nextVersion = (currentState?.version ?? 0) + 1;
  const now = new Date();

  if (previousSerialized !== nextSerialized) {
    if (currentState) {
      const updated = await db
        .update(projectCanvasState)
        .set({
          documentJson: normalizedDocument,
          version: nextVersion,
          updatedAt: now,
        })
        .where(
          and(
            eq(projectCanvasState.projectId, projectId),
            eq(projectCanvasState.version, baseVersion as number)
          )
        )
        .returning({ version: projectCanvasState.version });
      if (updated.length === 0) {
        const latest = await db
          .select({ version: projectCanvasState.version })
          .from(projectCanvasState)
          .where(eq(projectCanvasState.projectId, projectId))
          .limit(1);
        throwVersionConflict(latest[0]?.version ?? currentState.version);
      }
    } else {
      const inserted = await db
        .insert(projectCanvasState)
        .values({
          projectId,
          documentJson: normalizedDocument,
          version: nextVersion,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ version: projectCanvasState.version });
      if (inserted.length === 0) {
        const latest = await db
          .select({ version: projectCanvasState.version })
          .from(projectCanvasState)
          .where(eq(projectCanvasState.projectId, projectId))
          .limit(1);
        throwVersionConflict(latest[0]?.version ?? 1);
      }
    }

    await db
      .update(project)
      .set({
        currentStateVersion: nextVersion,
        updatedAt: now,
        lastOpenedAt: now,
      })
      .where(eq(project.id, projectId));
  } else {
    await db
      .update(project)
      .set({
        lastOpenedAt: now,
      })
      .where(eq(project.id, projectId));
  }

  return {
    version:
      previousSerialized === nextSerialized
        ? (currentState?.version ?? 1)
        : nextVersion,
  };
};
