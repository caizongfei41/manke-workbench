import {
  deleteWorkspaceProjects,
  fetchWorkspaceProjects,
  renameWorkspaceProject,
  type WorkspaceProjectCardItem,
} from '@/core/workspace-lib/app/workspace-client-api';
import { invalidateWorkspaceAfterProjectMutation } from '@/core/workspace-lib/app/workspace-query-invalidation';
import { workspaceProjectsKeys } from '@/core/workspace-lib/app/workspace-query-keys';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

export function workspaceProjectsQueryOptions({
  locale,
  initialProjects,
  enabled,
}: {
  locale: string;
  initialProjects?: WorkspaceProjectCardItem[];
  enabled: boolean;
}) {
  return queryOptions({
    queryKey: workspaceProjectsKeys.list(locale),
    queryFn: async () => {
      const result = await fetchWorkspaceProjects();
      return result.projects;
    },
    enabled,
    initialData: initialProjects,
    staleTime: 30 * 1000,
  });
}

export function useWorkspaceProjects({
  locale,
  initialProjects,
  enabled,
}: {
  locale: string;
  initialProjects: WorkspaceProjectCardItem[];
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = workspaceProjectsKeys.list(locale);
  const projectsQuery = useQuery(
    workspaceProjectsQueryOptions({
      locale,
      initialProjects,
      enabled,
    })
  );

  const renameProjectMutation = useMutation({
    mutationFn: ({ projectId, name }: { projectId: string; name: string }) =>
      renameWorkspaceProject(projectId, name),
    onSuccess: (result) => {
      // 立刻改本地缓存，界面不用等一次完整刷新
      queryClient.setQueryData<WorkspaceProjectCardItem[]>(queryKey, (current) =>
        (current ?? []).map((project) =>
          project.id === result.id ? { ...project, name: result.name } : project
        )
      );
    },
    onSettled: () => invalidateWorkspaceAfterProjectMutation(queryClient),
  });

  const deleteProjectsMutation = useMutation({
    mutationFn: deleteWorkspaceProjects,
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey });
      const previousProjects =
        queryClient.getQueryData<WorkspaceProjectCardItem[]>(queryKey) ?? [];

      queryClient.setQueryData<WorkspaceProjectCardItem[]>(
        queryKey,
        previousProjects.filter((project) => !ids.includes(project.id))
      );

      return { previousProjects };
    },
    onError: (_error, _ids, context) => {
      if (context?.previousProjects) {
        queryClient.setQueryData(queryKey, context.previousProjects);
      }
    },
    onSettled: () => invalidateWorkspaceAfterProjectMutation(queryClient),
  });

  return {
    projects: projectsQuery.data ?? [],
    isLoading: projectsQuery.isLoading,
    isFetching: projectsQuery.isFetching,
    error: projectsQuery.error,
    renameProject: async (projectId: string, name: string) => {
      await renameProjectMutation.mutateAsync({ projectId, name });
    },
    isRenaming: renameProjectMutation.isPending,
    deleteProjects: async (ids: string[]) => {
      await deleteProjectsMutation.mutateAsync(ids);
    },
    isDeleting: deleteProjectsMutation.isPending,
  };
}
