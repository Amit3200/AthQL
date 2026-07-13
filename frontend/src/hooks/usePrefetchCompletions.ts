import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import { extractTablesFromSql } from "../utils/sqlContext";

const PREFETCH_DEBOUNCE_MS = 900;
const LARGE_SQL_CHARS = 8_000;

function hashSql(sql: string): string {
  return `${sql.length}:${sql.slice(0, 64)}:${sql.slice(-64)}`;
}

export function usePrefetchCompletions(
  catalog: string | undefined,
  database: string | undefined,
  sql: string,
  enabled: boolean,
  addTables: (database: string, tables: string[]) => void,
  addColumns: (database: string, table: string, columns: string[]) => void,
) {
  const loadedTablesRef = useRef<string | null>(null);
  const loadedColumnsRef = useRef(new Set<string>());
  const knownTablesRef = useRef(new Set<string>());
  const lastSqlHashRef = useRef<string>("");
  const [knownTableCount, setKnownTableCount] = useState(0);

  useEffect(() => {
    if (!enabled || !catalog || !database) return;

    let cancelled = false;
    const cacheKey = `${catalog}:${database}`;

    (async () => {
      if (loadedTablesRef.current === cacheKey) return;

      try {
        const tables = await api.tables(catalog, database);
        if (cancelled) return;
        loadedTablesRef.current = cacheKey;
        knownTablesRef.current = new Set(tables.map((t) => t.name.toLowerCase()));
        setKnownTableCount(tables.length);
        addTables(database, tables.map((t) => t.name));
      } catch {
        // Metadata may be unavailable; completions stay empty for this database.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, catalog, database, addTables]);

  useEffect(() => {
    if (!enabled || !catalog || !database) return;
    if (knownTablesRef.current.size === 0) return;
    if (sql.length > LARGE_SQL_CHARS) return;

    const sqlHash = hashSql(sql);
    if (sqlHash === lastSqlHashRef.current) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      lastSqlHashRef.current = sqlHash;
      const tables = extractTablesFromSql(sql).filter((table) =>
        knownTablesRef.current.has(table.toLowerCase()),
      );
      if (tables.length === 0) return;

      void (async () => {
        for (const table of tables) {
          const key = `${catalog}:${database}:${table}`;
          if (loadedColumnsRef.current.has(key)) continue;

          try {
            const columns = await api.columns(catalog, database, table);
            if (cancelled) return;
            loadedColumnsRef.current.add(key);
            addColumns(
              database,
              table,
              columns.map((c) => c.name),
            );
          } catch {
            loadedColumnsRef.current.add(key);
          }
        }
      })();
    }, PREFETCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, catalog, database, sql, addColumns, knownTableCount]);
}
