import {
  DatabaseOutlined,
  FolderOutlined,
  FormatPainterOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  MenuFoldOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SaveOutlined,
  SettingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Layout, Select, Tabs, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api/client";
import { Logo } from "./components/Logo";
import { QueryTabLabel } from "./components/QueryTabLabel";
import { ResultsGrid } from "./components/ResultsGrid";
import { SaveQueryModal } from "./components/SaveQueryModal";
import { Sidebar } from "./components/Sidebar";
import { SqlEditor } from "./components/SqlEditor";
import { ThemeToggle } from "./components/ThemeToggle";
import { useTheme } from "./context/ThemeContext";
import { useNotify } from "./hooks/useNotify";
import { usePrefetchCompletions } from "./hooks/usePrefetchCompletions";
import { useQueryExecution } from "./hooks/useQueryExecution";
import { useSqlCompletions } from "./hooks/useSqlCompletions";
import type { CatalogContext, LoadedQuery, QueryTab } from "./types";
import { SQL_THEMES } from "./utils/sqlThemes";
import { loadWorkspacePrefs, saveWorkspacePrefs } from "./utils/workspaceStorage";

const { Sider, Content } = Layout;

function newTab(num: number, prefs = loadWorkspacePrefs()): QueryTab {
  return {
    key: `tab-${Date.now()}-${num}`,
    label: `q${num}`,
    sql: "-- Write your Athena SQL here\nSELECT 1",
    database: prefs.database,
    catalog: prefs.catalog,
  };
}

function persistDatabaseContext(database?: string, catalog?: string) {
  saveWorkspacePrefs({ database, catalog });
}

function QueryPanel({
  tab,
  isActive,
  onUpdate,
  onSave,
  onExecuted,
  completions,
  addTables,
  addColumns,
}: {
  tab: QueryTab;
  isActive: boolean;
  onUpdate: (patch: Partial<QueryTab>) => void;
  onSave: (sql: string) => void;
  onExecuted?: () => void;
  completions: ReturnType<typeof useSqlCompletions>["completions"];
  addTables: ReturnType<typeof useSqlCompletions>["addTables"];
  addColumns: ReturnType<typeof useSqlCompletions>["addColumns"];
}) {
  const { message } = useNotify();
  const queryClient = useQueryClient();
  const formatRef = useRef<(() => void) | null>(null);
  const runRef = useRef<(() => void) | null>(null);
  const getSqlRef = useRef<(() => string) | null>(null);
  const { editorTheme, setEditorTheme } = useTheme();
  const { status, isPolling, processed, isLoadingStatus, isLoadingResults, error } = useQueryExecution(tab.executionId, {
    outputLocation: tab.outputLocation,
    restoredStatus: tab.restoredStatus,
  });
  const [resultsHeight, setResultsHeight] = useState(42);
  const [isDragging, setIsDragging] = useState(false);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const panel = document.querySelector(".athql-panel");
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const percentage = 100 - (relativeY / rect.height) * 100;
      if (percentage >= 15 && percentage <= 80) {
        setResultsHeight(percentage);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (status?.status === "SUCCEEDED" && tab.updateSavedQueryId) {
      queryClient.invalidateQueries({ queryKey: ["saved-queries"] });
    }
  }, [status?.status, tab.updateSavedQueryId, queryClient]);

  const catalogsQuery = useQuery({
    queryKey: ["catalogs"],
    queryFn: api.catalogs,
  });

  const activeCatalog = tab.catalog ?? catalogsQuery.data?.[0]?.name;

  const databasesQuery = useQuery({
    queryKey: ["databases", activeCatalog],
    queryFn: () => api.databases(activeCatalog!),
    enabled: !!activeCatalog,
  });

  const runQuery = useCallback(async (sqlToRun?: string) => {
    if (isPolling) return;
    const sql = (sqlToRun ?? tab.sql).trim();
    if (!sql) return;

    try {
      const { execution_id } = await api.execute(
        sql,
        tab.database,
        tab.catalog,
        tab.updateSavedQueryId,
      );
      if (tab.executionId) {
        queryClient.removeQueries({ queryKey: ["query-status", tab.executionId] });
        queryClient.removeQueries({ queryKey: ["query-results", tab.executionId] });
      }
      onUpdate({
        executionId: execution_id,
        outputLocation: undefined,
        restoredStatus: undefined,
      });
      onExecuted?.();
      message.success("Query submitted");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Execution failed");
    }
  }, [isPolling, tab.sql, tab.database, tab.catalog, tab.updateSavedQueryId, tab.executionId, onUpdate, onExecuted, message, queryClient]);

  const cancelQuery = async () => {
    if (!tab.executionId) return;
    try {
      await api.cancel(tab.executionId);
      message.info("Cancellation requested");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  usePrefetchCompletions(activeCatalog, tab.database, tab.sql, isActive, addTables, addColumns);

  return (
    <div className="athql-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="athql-toolbar">
        <div className="athql-toolbar-left">
          <Select
            allowClear
            showSearch
            placeholder="Database"
            value={tab.database}
            onChange={(database) =>
              onUpdate({
                database: database || undefined,
                catalog: activeCatalog,
              })
            }
            loading={databasesQuery.isLoading}
            options={(databasesQuery.data ?? []).map((db) => ({ label: db.name, value: db.name }))}
            className="athql-toolbar-select"
            size="small"
          />
          <div className="athql-toolbar-actions">
            <Button
              type="primary"
              size="small"
              className="athql-btn-run"
              icon={<PlayCircleOutlined />}
              onClick={() => runRef.current?.()}
              loading={isPolling}
            >
              Run
            </Button>
            <div className="athql-btn-group">
              <Button
                size="small"
                type="text"
                icon={<StopOutlined />}
                onClick={cancelQuery}
                disabled={!tab.executionId || !isPolling}
              >
                Cancel
              </Button>
              <Button size="small" type="text" icon={<SaveOutlined />} onClick={() => onSave(getSqlRef.current?.() ?? tab.sql)}>
                Save
              </Button>
              <Button
                size="small"
                type="text"
                icon={<FormatPainterOutlined />}
                onClick={() => formatRef.current?.()}
              >
                Format
              </Button>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Typography.Text type="secondary" className="athql-toolbar-hint" style={{ margin: 0 }}>
            Cmd/Ctrl+Enter to run selection or all · Cmd/Ctrl+Shift+F to format · Ctrl+Space for suggestions
          </Typography.Text>
          <Select
            size="small"
            style={{ width: 160 }}
            value={editorTheme}
            onChange={setEditorTheme}
            options={SQL_THEMES}
          />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <SqlEditor
          value={tab.sql}
          onChange={(sql) => onUpdate({ sql })}
          completions={completions}
          database={tab.database}
          isActive={isActive}
          onRun={runQuery}
          onFormatRef={formatRef}
          onRunRef={runRef}
          onGetSqlRef={isActive ? getSqlRef : undefined}
        />
      </div>
      <div
        className={`athql-pane-splitter ${isDragging ? "athql-pane-splitter--dragging" : ""}`}
        onMouseDown={startDrag}
      />
      <div className="athql-results-pane" style={{ height: `${resultsHeight}%`, minHeight: 0 }}>
        <ResultsGrid
          status={status}
          processed={processed}
          isLoading={isLoadingResults}
          isLoadingStatus={isLoadingStatus}
          error={error}
          executionId={tab.executionId}
          outputLocation={tab.outputLocation}
        />
      </div>
    </div>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const { message } = useNotify();
  const { completions, addTables, addColumns } = useSqlCompletions();
  const [tabs, setTabs] = useState<QueryTab[]>(() => [newTab(1)]);
  const [activeKey, setActiveKey] = useState(() => tabs[0].key);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveModalSql, setSaveModalSql] = useState<string | undefined>();
  const [activeSidebarTab, setActiveSidebarTab] = useState("catalog");
  const [collapsed, setCollapsed] = useState(false);
  const nextTabNum = useRef(2);

  const activeTab = tabs.find((t) => t.key === activeKey);

  const updateTab = useCallback((key: string, patch: Partial<QueryTab>) => {
    setTabs((prev) => {
      const next = prev.map((t) => (t.key === key ? { ...t, ...patch } : t));
      if ("database" in patch || "catalog" in patch) {
        const updated = next.find((t) => t.key === key);
        if (updated) {
          persistDatabaseContext(updated.database, updated.catalog);
        }
      }
      return next;
    });
  }, []);

  const addTab = () => {
    const tab = newTab(nextTabNum.current++);
    setTabs((prev) => [...prev, tab]);
    setActiveKey(tab.key);
  };

  const applyContextToActive = useCallback(
    (context: CatalogContext) => {
      updateTab(activeKey, { database: context.database, catalog: context.catalog });
    },
    [activeKey, updateTab],
  );

  const insertIntoActive = (text: string) => {
    const tab = tabs.find((t) => t.key === activeKey);
    if (!tab) return;
    updateTab(activeKey, { sql: `${tab.sql}\n${text}` });
  };

  const loadQueryIntoActive = (query: LoadedQuery) => {
    updateTab(activeKey, {
      sql: query.sql,
      name: query.title,
      label: query.title ?? tabs.find((t) => t.key === activeKey)?.label ?? "q1",
      database: query.database,
      catalog: query.catalog,
      updateSavedQueryId: query.savedQueryId,
      executionId: query.executionId,
      outputLocation: query.outputLocation,
      restoredStatus: query.restoredStatus,
    });
    message.success(query.restoredStatus?.status === "SUCCEEDED" ? "Query and last results loaded" : "Query loaded");
  };

  const openSaveModal = (sql: string) => {
    if (!activeTab) return;
    setSaveModalSql(sql);
    updateTab(activeKey, { sql });
    setSaveModalOpen(true);
  };

  return (
    <Layout style={{ height: "100vh" }}>
      <Sider
        width={300}
        collapsedWidth={64}
        collapsible
        collapsed={collapsed}
        trigger={null}
        className="athql-sider"
      >
        {collapsed ? (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div className="athql-header" style={{ padding: "14px 0", justifyContent: "center" }}>
              <div
                onClick={() => setCollapsed(false)}
                style={{ cursor: "pointer", display: "flex", alignItems: "center" }}
                title="Expand Sidebar"
              >
                <Logo size={28} />
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <div className="athql-collapsed-strip">
                <button
                  className={`athql-collapsed-item ${activeSidebarTab === "catalog" ? "athql-collapsed-item--active" : ""}`}
                  onClick={() => {
                    setActiveSidebarTab("catalog");
                    setCollapsed(false);
                  }}
                  title="Catalog"
                >
                  <DatabaseOutlined />
                </button>
                <button
                  className={`athql-collapsed-item ${activeSidebarTab === "saved" ? "athql-collapsed-item--active" : ""}`}
                  onClick={() => {
                    setActiveSidebarTab("saved");
                    setCollapsed(false);
                  }}
                  title="Saved Queries"
                >
                  <FolderOutlined />
                </button>
                <button
                  className={`athql-collapsed-item ${activeSidebarTab === "history" ? "athql-collapsed-item--active" : ""}`}
                  onClick={() => {
                    setActiveSidebarTab("history");
                    setCollapsed(false);
                  }}
                  title="Query History"
                >
                  <HistoryOutlined />
                </button>
                <button
                  className={`athql-collapsed-item ${activeSidebarTab === "settings" ? "athql-collapsed-item--active" : ""}`}
                  onClick={() => {
                    setActiveSidebarTab("settings");
                    setCollapsed(false);
                  }}
                  title="Settings"
                >
                  <SettingOutlined />
                </button>
                <button
                  className={`athql-collapsed-item ${activeSidebarTab === "about" ? "athql-collapsed-item--active" : ""}`}
                  onClick={() => {
                    setActiveSidebarTab("about");
                    setCollapsed(false);
                  }}
                  title="About AthQL"
                >
                  <InfoCircleOutlined />
                </button>
              </div>
            </div>
            <div className="athql-sidebar-footer" style={{ padding: "12px 0", justifyContent: "center" }}>
              <a
                href="https://github.com/amit3200"
                target="_blank"
                rel="noopener noreferrer"
                className="athql-footer-link"
                style={{ padding: "4px 8px", fontSize: "10px" }}
              >
                @A
              </a>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div className="athql-header">
              <div className="athql-header-main">
                <Logo size={32} />
                <div>
                  <Typography.Title level={5} className="athql-header-title">
                    AthQL
                  </Typography.Title>
                  <div className="athql-header-subtitle">Athena Query Manager</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ThemeToggle />
                <Button
                  type="text"
                  size="small"
                  icon={<MenuFoldOutlined />}
                  onClick={() => setCollapsed(true)}
                  style={{ color: "var(--athql-text-muted)" }}
                />
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <Sidebar
                activeKey={activeSidebarTab}
                onChange={setActiveSidebarTab}
                onInsertText={insertIntoActive}
                onContextChange={applyContextToActive}
                onLoadQuery={loadQueryIntoActive}
                onTablesLoaded={addTables}
                onColumnsLoaded={addColumns}
              />
            </div>
            <div className="athql-sidebar-footer">
              CRAFTED BY{" "}
              <a
                href="https://github.com/amit3200"
                target="_blank"
                rel="noopener noreferrer"
                className="athql-footer-link"
              >
                @amit3200
              </a>
            </div>
          </div>
        )}
      </Sider>
      <Content className="athql-content" style={{ padding: 12 }}>
        <Tabs
          type="editable-card"
          activeKey={activeKey}
          onChange={setActiveKey}
          onEdit={(targetKey, action) => {
            if (action === "add") {
              addTab();
              return;
            }
            if (action === "remove" && typeof targetKey === "string" && tabs.length > 1) {
              const next = tabs.filter((t) => t.key !== targetKey);
              setTabs(next);
              if (activeKey === targetKey) setActiveKey(next[0].key);
            }
          }}
          addIcon={<PlusOutlined />}
          items={tabs.map((tab) => ({
            key: tab.key,
            label: (
              <QueryTabLabel
                label={tab.label}
                onRename={(label) => updateTab(tab.key, { label })}
              />
            ),
            children: (
              <QueryPanel
                tab={tab}
                isActive={tab.key === activeKey}
                onUpdate={(patch) => updateTab(tab.key, patch)}
                onSave={openSaveModal}
                onExecuted={() => queryClient.invalidateQueries({ queryKey: ["query-history"] })}
                completions={completions}
                addTables={addTables}
                addColumns={addColumns}
              />
            ),
          }))}
          style={{ height: "100%" }}
          tabBarStyle={{ margin: 0 }}
        />
      </Content>

      {activeTab && (
        <SaveQueryModal
          open={saveModalOpen}
          onClose={() => setSaveModalOpen(false)}
          initialName={activeTab.name ?? activeTab.label}
          sql={saveModalSql ?? activeTab.sql}
          database={activeTab.database}
          catalog={activeTab.catalog}
          updateSavedQueryId={activeTab.updateSavedQueryId}
          onSaved={(saved) =>
            updateTab(activeKey, {
              name: saved.name,
              label: saved.name,
              updateSavedQueryId: saved.id === activeTab.updateSavedQueryId ? saved.id : undefined,
            })
          }
        />
      )}
    </Layout>
  );
}
