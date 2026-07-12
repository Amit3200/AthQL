import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import type { QueryResult, QueryStatus, QueryTab } from "../types";
import type { ProcessedResult } from "../workers/resultProcessor.worker";

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

function estimateCost(dataScannedBytes?: number): number | undefined {
  if (dataScannedBytes == null) return undefined;
  return Math.round((dataScannedBytes / 1024 ** 3) * 0.005 * 1_000_000) / 1_000_000;
}

function processResult(data: QueryResult): ProcessedResult {
  const dataSource = data.rows.map((row, index) => ({
    __rowKey: index,
    ...row,
  }));
  return {
    columns: data.columns,
    dataSource,
    rowCount: data.row_count,
  };
}

export interface UseQueryExecutionOptions {
  outputLocation?: string;
  restoredStatus?: QueryTab["restoredStatus"];
}

export function useQueryExecution(
  executionId: string | undefined,
  options?: UseQueryExecutionOptions,
) {
  const { outputLocation, restoredStatus } = options ?? {};
  const isRestoredTerminal = restoredStatus != null && TERMINAL.has(restoredStatus.status);

  const statusQuery = useQuery({
    queryKey: ["query-status", executionId],
    queryFn: () => api.status(executionId!),
    enabled: !!executionId && !isRestoredTerminal,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || TERMINAL.has(status)) return false;
      return 1500;
    },
  });

  const effectiveStatus = useMemo<QueryStatus | undefined>(() => {
    if (isRestoredTerminal && restoredStatus) {
      return {
        id: executionId ?? "restored",
        status: restoredStatus.status,
        data_scanned_bytes: restoredStatus.data_scanned_bytes,
        execution_time_ms: restoredStatus.execution_time_ms,
        error_message: restoredStatus.error_message,
        cost_usd: restoredStatus.cost_usd ?? estimateCost(restoredStatus.data_scanned_bytes),
        output_location: outputLocation,
      };
    }
    return statusQuery.data;
  }, [isRestoredTerminal, restoredStatus, executionId, outputLocation, statusQuery.data]);

  const resultOutputLocation = outputLocation ?? effectiveStatus?.output_location;

  const resultsQuery = useQuery({
    queryKey: ["query-results", executionId, resultOutputLocation],
    queryFn: async () => {
      if (executionId) {
        try {
          return await api.results(executionId);
        } catch {
          if (resultOutputLocation) {
            return await api.resultsByOutputLocation(resultOutputLocation);
          }
          throw new Error("Results unavailable");
        }
      }
      if (resultOutputLocation) {
        return await api.resultsByOutputLocation(resultOutputLocation);
      }
      throw new Error("No results source");
    },
    enabled: effectiveStatus?.status === "SUCCEEDED" && (!!executionId || !!resultOutputLocation),
    staleTime: 0,
    refetchOnMount: "always",
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 4000),
  });

  const [processed, setProcessed] = useState<ProcessedResult | null>(null);

  useEffect(() => {
    setProcessed(null);
  }, [executionId]);

  useEffect(() => {
    if (!resultsQuery.data) {
      return;
    }
    setProcessed(processResult(resultsQuery.data));
  }, [resultsQuery.data, executionId]);

  const isPolling =
    !!executionId &&
    !isRestoredTerminal &&
    (!statusQuery.data || !TERMINAL.has(statusQuery.data.status));

  return {
    status: effectiveStatus,
    isPolling,
    processed,
    isLoadingStatus: statusQuery.isLoading || statusQuery.isFetching,
    isLoadingResults: resultsQuery.isLoading || resultsQuery.isFetching,
    error: statusQuery.error || resultsQuery.error,
  };
}
