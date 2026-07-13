import { useCallback, useRef, useState } from "react";

import type { SqlCompletionContext } from "../types";
import { updateSqlCompletionState } from "../utils/sqlCompletionProvider";

const EMPTY: SqlCompletionContext = { tables: [], columns: [], columnsByTable: {} };
const BUMP_DEBOUNCE_MS = 300;

export function useSqlCompletions() {
  const tablesRef = useRef(new Set<string>());
  const columnsByTableRef = useRef<Record<string, string[]>>({});
  const [snapshot, setSnapshot] = useState<SqlCompletionContext>(EMPTY);
  const bumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bump = useCallback(() => {
    if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current);
    bumpTimerRef.current = setTimeout(() => {
      bumpTimerRef.current = null;
      const next: SqlCompletionContext = {
        tables: Array.from(tablesRef.current).sort(),
        columns: [],
        columnsByTable: { ...columnsByTableRef.current },
      };
      setSnapshot(next);
      updateSqlCompletionState(next);
    }, BUMP_DEBOUNCE_MS);
  }, []);

  const addTables = useCallback(
    (database: string, names: string[]) => {
      let changed = false;
      for (const name of names) {
        for (const candidate of [name, `${database}.${name}`]) {
          if (!tablesRef.current.has(candidate)) {
            tablesRef.current.add(candidate);
            changed = true;
          }
        }
      }
      if (changed) bump();
    },
    [bump],
  );

  const addColumns = useCallback(
    (database: string, table: string, names: string[]) => {
      let changed = false;

      const registerKey = (key: string, columnName: string) => {
        if (!columnsByTableRef.current[key]) {
          columnsByTableRef.current[key] = [];
        }
        if (!columnsByTableRef.current[key].includes(columnName)) {
          columnsByTableRef.current[key].push(columnName);
          changed = true;
        }
      };

      for (const name of names) {
        registerKey(table, name);
        registerKey(table.toLowerCase(), name);
        registerKey(`${database}.${table}`, name);
        registerKey(`${database}.${table}`.toLowerCase(), name);
      }

      if (changed) bump();
    },
    [bump],
  );

  return { completions: snapshot, addTables, addColumns };
}
