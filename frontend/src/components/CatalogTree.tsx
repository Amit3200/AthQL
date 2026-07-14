import { ReloadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Spin, Tree, Typography } from "antd";
import type { DataNode } from "antd/es/tree";
import { useCallback, useMemo, useState } from "react";

import { api } from "../api/client";
import type { CatalogContext } from "../types";

interface CatalogTreeProps {
  onInsertText: (text: string) => void;
  onContextChange?: (context: CatalogContext) => void;
  onTablesLoaded?: (database: string, tables: string[]) => void;
  onColumnsLoaded?: (database: string, table: string, columns: string[]) => void;
}

export function CatalogTree({ onInsertText, onContextChange, onTablesLoaded, onColumnsLoaded }: CatalogTreeProps) {
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [loadedKeys, setLoadedKeys] = useState<Set<string>>(new Set());
  const [treeData, setTreeData] = useState<DataNode[]>([]);

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: api.profile,
    retry: 1,
  });

  const catalogsQuery = useQuery({
    queryKey: ["catalogs"],
    queryFn: api.catalogs,
  });

  const refresh = useCallback(async () => {
    await api.refreshMetadata();
    setLoadedKeys(new Set());
    setExpandedKeys([]);
    setTreeData([]);
    await catalogsQuery.refetch();
  }, [catalogsQuery]);

  const initialTree = useMemo(() => {
    if (!catalogsQuery.data) return [];
    return catalogsQuery.data.map((catalog) => ({
      title: catalog.label ?? catalog.name,
      key: `catalog:${catalog.name}`,
      isLeaf: false,
    }));
  }, [catalogsQuery.data]);

  const displayTree = treeData.length > 0 ? treeData : initialTree;

  const onLoadData = async (node: DataNode) => {
    const key = String(node.key);
    if (loadedKeys.has(key)) return;

    const parts = key.split(":");
    let children: DataNode[] = [];

    if (parts[0] === "catalog") {
      const catalog = parts[1];
      const dbs = await api.databases(catalog);
      children = dbs.map((db) => ({
        title: db.name,
        key: `database:${catalog}:${db.name}`,
        isLeaf: false,
      }));
    } else if (parts[0] === "database") {
      const [, catalog, database] = parts;
      const tables = await api.tables(catalog, database);
      onTablesLoaded?.(
        database,
        tables.map((t) => t.name),
      );
      children = tables.map((table) => ({
        title: table.name,
        key: `table:${catalog}:${database}:${table.name}`,
        isLeaf: false,
      }));
    } else if (parts[0] === "table") {
      const [, catalog, database, table] = parts;
      const columns = await api.columns(catalog, database, table);
      onColumnsLoaded?.(
        database,
        table,
        columns.map((c) => c.name),
      );
      children = columns.map((col) => ({
        title: `${col.name} (${col.type})`,
        key: `column:${catalog}:${database}:${table}:${col.name}`,
        isLeaf: true,
      }));
    }

    setTreeData((prev) => {
      const base = prev.length > 0 ? prev : initialTree;
      return updateTreeData(base, key, children);
    });
    setLoadedKeys((prev) => new Set(prev).add(key));
  };

  const onSelect = (_: React.Key[], info: { node: DataNode }) => {
    const key = String(info.node.key);
    const parts = key.split(":");
    if (parts[0] === "database") {
      onContextChange?.({ catalog: parts[1], database: parts[2] });
    } else if (parts[0] === "table") {
      const [, catalog, database, table] = parts;
      onContextChange?.({ catalog, database });
      onInsertText(`${database}.${table}`);
    } else if (parts[0] === "column") {
      const [, catalog, database, , column] = parts;
      onContextChange?.({ catalog, database });
      onInsertText(column);
    }
  };

  if (catalogsQuery.isLoading) {
    return <Spin style={{ display: "block", margin: "24px auto" }} />;
  }

  return (
    <div className="athql-sidebar-panel">
      {profileQuery.data?.warnings?.map((warning) => (
        <Alert key={warning} className="athql-sidebar-alert" type="warning" message={warning} showIcon />
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {profileQuery.isError
            ? "AWS profile unavailable (is the API running on :8000?)"
            : profileQuery.data
              ? `${profileQuery.data.profile} · ${profileQuery.data.region}`
              : "Loading profile…"}
        </Typography.Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={refresh} />
      </div>
      <Tree
        showLine
        loadData={onLoadData}
        treeData={displayTree}
        expandedKeys={expandedKeys}
        onExpand={(keys) => setExpandedKeys(keys.map(String))}
        onSelect={onSelect}
        style={{ flex: 1, overflow: "auto" }}
      />
    </div>
  );
}

function updateTreeData(list: DataNode[], key: string, children: DataNode[]): DataNode[] {
  return list.map((node) => {
    if (node.key === key) {
      return { ...node, children };
    }
    if (node.children) {
      return { ...node, children: updateTreeData(node.children, key, children) };
    }
    return node;
  });
}
