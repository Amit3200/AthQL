import { DownloadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Table, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import { RowJsonModal } from "./RowJsonModal";
import type { ProcessedResult } from "../workers/resultProcessor.worker";
import type { QueryStatus } from "../types";

interface ResultsGridProps {
  status?: QueryStatus;
  processed: ProcessedResult | null;
  isLoading: boolean;
  isLoadingStatus?: boolean;
  error?: Error | null;
  executionId?: string;
  outputLocation?: string;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function ResultsGridInner({
  status,
  processed,
  isLoading,
  isLoadingStatus = false,
  error,
  executionId,
  outputLocation,
}: ResultsGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(240);
  const [jsonRow, setJsonRow] = useState<{ row: Record<string, unknown>; index: number } | null>(null);

  useLayoutEffect(() => {
    const wrap = tableWrapRef.current;
    const grid = gridRef.current;
    if (!wrap || !grid) return;

    const updateScrollHeight = () => {
      const thead = wrap.querySelector(".ant-table-thead");
      const headerHeight = thead?.getBoundingClientRect().height ?? 39;
      const body = wrap.querySelector(".ant-table-body") as HTMLElement | null;
      const horizontalScrollbar =
        body && body.scrollWidth > body.clientWidth
          ? body.offsetHeight - body.clientHeight
          : 0;
      const next = Math.floor(wrap.clientHeight - headerHeight - horizontalScrollbar - 1);
      setScrollY((prev) => {
        const clamped = Math.max(80, next);
        return prev === clamped ? prev : clamped;
      });
    };

    let rafId = 0;
    const scheduleUpdate = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        updateScrollHeight();
      });
    };

    scheduleUpdate();

    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(wrap);
    observer.observe(grid);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [status?.status, processed?.dataSource.length, isLoading, processed?.columns.length]);

  const columns: ColumnsType<Record<string, unknown>> = useMemo(() => {
    if (!processed) return [];

    const jsonColumn: ColumnsType<Record<string, unknown>>[number] = {
      title: "",
      key: "__json",
      width: 44,
      fixed: "left",
      className: "athql-results-json-col",
      render: (_value, record, index) => (
        <Tooltip title="View row as JSON">
          <button
            type="button"
            className="athql-row-json-btn"
            aria-label={`View row ${index + 1} as JSON`}
            onClick={(event) => {
              event.stopPropagation();
              setJsonRow({ row: record, index });
            }}
          >
            {"{}"}
          </button>
        </Tooltip>
      ),
    };

    const dataColumns = processed.columns.map((col) => ({
      title: col.name,
      dataIndex: col.name,
      key: col.name,
      width: 160,
      ellipsis: true,
      align: ["integer", "number", "decimal"].includes(col.type) ? ("right" as const) : ("left" as const),
      render: (value: unknown) =>
        value == null ? <Typography.Text type="secondary">NULL</Typography.Text> : String(value),
    }));

    return [jsonColumn, ...dataColumns];
  }, [processed]);

  const handleDownload = async () => {
    try {
      if (executionId) {
        const { url } = await api.downloadUrl(executionId);
        window.open(url, "_blank");
        return;
      }
      if (outputLocation) {
        const { url } = await api.downloadUrlByOutputLocation(outputLocation);
        window.open(url, "_blank");
      }
    } catch (err) {
      if (outputLocation) {
        const { url } = await api.downloadUrlByOutputLocation(outputLocation);
        window.open(url, "_blank");
        return;
      }
      throw err;
    }
  };

  if (status?.status === "FAILED") {
    return (
      <Alert
        className="athql-result-alert"
        type="error"
        message="Query failed"
        description={status.error_message}
        showIcon
      />
    );
  }

  if (error && status?.status === "SUCCEEDED") {
    return (
      <Alert
        className="athql-result-alert"
        type="error"
        message="Results unavailable"
        description={error instanceof Error ? error.message : "Failed to load query results"}
        showIcon
      />
    );
  }

  if (status && !["SUCCEEDED"].includes(status.status)) {
    return (
      <Alert
        className="athql-result-alert"
        type="info"
        message={`Query ${status.status.toLowerCase()}…`}
        showIcon
      />
    );
  }

  if (!status && executionId) {
    return (
      <Alert
        className="athql-result-alert"
        type="info"
        message={isLoadingStatus ? "Starting query…" : "Query running…"}
        showIcon
      />
    );
  }

  if (!status && !isLoading) {
    return (
      <div ref={gridRef} className="athql-results-grid" style={{ justifyContent: "center", alignItems: "center", height: "100%", background: "var(--athql-surface-subtle)" }}>
        <Empty
          description={
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              No query executed yet. Press <kbd style={{ padding: "2px 4px", background: "var(--athql-tag-bg)", border: "1px solid var(--athql-border)", borderRadius: 3, fontSize: 11, fontFamily: "monospace" }}>Cmd/Ctrl+Enter</kbd> to run.
            </Typography.Text>
          }
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    );
  }

  return (
    <div ref={gridRef} className="athql-results-grid">
      {status && (
        <div className="athql-results-toolbar">
          <Typography.Text type="secondary">
            Scanned: {formatBytes(status.data_scanned_bytes)} ·{" "}
            {status.execution_time_ms != null ? `${(status.execution_time_ms / 1000).toFixed(2)}s` : "—"} ·{" "}
            {status.cost_usd != null ? `$${status.cost_usd.toFixed(4)}` : "—"}
          </Typography.Text>
          {(executionId || outputLocation) && (
            <Button size="small" icon={<DownloadOutlined />} onClick={handleDownload}>
              Download full CSV
            </Button>
          )}
        </div>
      )}

      <div ref={tableWrapRef} className="athql-results-table-wrap">
        <Table
          size="small"
          loading={isLoading}
          columns={columns}
          dataSource={processed?.dataSource ?? []}
          rowKey="__rowKey"
          pagination={false}
          scroll={{ x: "max-content", y: scrollY }}
          tableLayout="fixed"
        />
      </div>

      <RowJsonModal
        open={jsonRow != null}
        row={jsonRow?.row ?? null}
        rowIndex={jsonRow?.index}
        onClose={() => setJsonRow(null)}
      />
    </div>
  );
}

export const ResultsGrid = memo(ResultsGridInner);
