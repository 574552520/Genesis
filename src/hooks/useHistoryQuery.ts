import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

type HistoryListResult = Awaited<ReturnType<typeof api.listHistory>>;

export const historyKeys = {
  all: ["history"] as const,
  list: (limit: number, offset: number) => ["history", "list", limit, offset] as const,
};

export function useHistoryList(limit: number, offset: number) {
  return useQuery({
    queryKey: historyKeys.list(limit, offset),
    queryFn: () => api.listHistory(limit, offset),
  });
}

export function useDeleteGenerationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => api.deleteGeneration(jobId),
    onMutate: async (jobId) => {
      await queryClient.cancelQueries({ queryKey: historyKeys.all });
      const snapshots = queryClient.getQueriesData<HistoryListResult>({
        queryKey: historyKeys.all,
      });

      snapshots.forEach(([queryKey, data]) => {
        if (!data) return;
        queryClient.setQueryData<HistoryListResult>(queryKey, {
          ...data,
          items: data.items.filter((item) => item.id !== jobId),
        });
      });

      return { snapshots };
    },
    onError: (_error, _jobId, context) => {
      context?.snapshots.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSuccess: (_data, jobId) => {
      const cached = queryClient.getQueriesData<HistoryListResult>({
        queryKey: historyKeys.all,
      });
      cached.forEach(([queryKey, data]) => {
        if (!data) return;
        queryClient.setQueryData<HistoryListResult>(queryKey, {
          ...data,
          items: data.items.filter((item) => item.id !== jobId),
        });
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: historyKeys.all });
    },
  });
}
