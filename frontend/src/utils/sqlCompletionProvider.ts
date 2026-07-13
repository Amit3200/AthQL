import type { Monaco } from "@monaco-editor/react";
import type * as MonacoEditor from "monaco-editor";

import type { SqlCompletionContext } from "../types";
import {
  collectColumnsForTables,
  extractTableAliasMap,
  getSqlWordAtPosition,
  getTablesForDatabaseQualifier,
  isDatabaseQualifier,
  parseDotContext,
  resolveTableColumns,
  resolveTableRef,
} from "./sqlContext";

const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "JOIN",
  "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "OUTER JOIN", "ON", "AS", "AND", "OR",
  "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "IS", "NULL", "DISTINCT", "COUNT",
  "SUM", "AVG", "MIN", "MAX", "CASE", "WHEN", "THEN", "ELSE", "END", "WITH",
  "UNION", "ALL", "CAST", "DATE", "TIMESTAMP", "INTERVAL", "OVER", "PARTITION BY",
];

const MAX_SUGGESTIONS = 50;
const LARGE_SQL_CHARS = 8_000;

let providerRegistered = false;

const completionState: {
  context: SqlCompletionContext;
  database?: string;
} = {
  context: { tables: [], columns: [], columnsByTable: {} },
  database: undefined,
};

let sqlContextCache: {
  versionId: number;
  aliasMap: Map<string, string>;
  tablesInQuery: string[];
} | null = null;

export function updateSqlCompletionState(context: SqlCompletionContext, database?: string) {
  completionState.context = context;
  if (database !== undefined) {
    completionState.database = database;
  }
  sqlContextCache = null;
}

function shouldSuggestColumn(label: string, prefix: string): boolean {
  const normalizedPrefix = prefix.toLowerCase();
  const normalizedLabel = label.toLowerCase();

  if (!normalizedLabel.startsWith(normalizedPrefix)) {
    return false;
  }

  if (label.startsWith("__") && !normalizedPrefix.startsWith("__")) {
    return false;
  }

  return true;
}

function limitSuggestions<T extends { sortText?: string; label: string | { label: string } }>(
  items: T[],
): T[] {
  if (items.length <= MAX_SUGGESTIONS) {
    return items.sort((a, b) => {
      const aSort = a.sortText ?? (typeof a.label === "string" ? a.label : a.label.label);
      const bSort = b.sortText ?? (typeof b.label === "string" ? b.label : b.label.label);
      return aSort.localeCompare(bSort);
    });
  }

  return items
    .sort((a, b) => {
      const aSort = a.sortText ?? (typeof a.label === "string" ? a.label : a.label.label);
      const bSort = b.sortText ?? (typeof b.label === "string" ? b.label : b.label.label);
      return aSort.localeCompare(bSort);
    })
    .slice(0, MAX_SUGGESTIONS);
}

function getSqlContext(model: MonacoEditor.editor.ITextModel) {
  const versionId = model.getVersionId();
  if (sqlContextCache?.versionId === versionId) {
    return sqlContextCache;
  }

  const sql = model.getValue();
  const aliasMap = extractTableAliasMap(sql);
  sqlContextCache = {
    versionId,
    aliasMap,
    tablesInQuery: [...new Set(aliasMap.values())],
  };
  return sqlContextCache;
}

function buildKeywordSuggestions(
  monaco: Monaco,
  prefix: string,
  range: MonacoEditor.IRange,
) {
  const normalizedPrefix = prefix.toLowerCase();
  const results = [];
  for (const label of SQL_KEYWORDS) {
    if (!label.toLowerCase().startsWith(normalizedPrefix)) continue;
    results.push({
      label,
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: label,
      range,
      sortText: `3_${label}`,
    });
    if (results.length >= MAX_SUGGESTIONS) break;
  }
  return results;
}

function buildTableSuggestions(
  monaco: Monaco,
  tables: string[],
  prefix: string,
  range: MonacoEditor.IRange,
) {
  const normalizedPrefix = prefix.toLowerCase();
  const results = [];
  for (const label of tables) {
    if (!label.toLowerCase().startsWith(normalizedPrefix)) continue;
    results.push({
      label,
      kind: monaco.languages.CompletionItemKind.Class,
      insertText: label,
      range,
      sortText: `2_${label}`,
    });
    if (results.length >= MAX_SUGGESTIONS) break;
  }
  return results;
}

function buildColumnSuggestions(
  monaco: Monaco,
  columns: string[],
  prefix: string,
  range: MonacoEditor.IRange,
  sortPrefix: string,
) {
  const results = [];
  for (const label of columns) {
    if (!shouldSuggestColumn(label, prefix)) continue;
    results.push({
      label,
      kind: monaco.languages.CompletionItemKind.Field,
      insertText: label,
      range,
      sortText: `${sortPrefix}_${label}`,
    });
    if (results.length >= MAX_SUGGESTIONS) break;
  }
  return results;
}

export function ensureSqlCompletionProvider(monaco: Monaco) {
  if (providerRegistered) return;
  providerRegistered = true;

  monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: ["."],
    provideCompletionItems: (
      model: MonacoEditor.editor.ITextModel,
      position: MonacoEditor.Position,
      context: MonacoEditor.languages.CompletionContext,
    ) => {
      const ctx = completionState.context;
      const database = completionState.database;
      const isManual = context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke;
      const isTrigger = context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter;
      const sqlLength = model.getValueLength();
      const isLargeSql = sqlLength > LARGE_SQL_CHARS;

      if (isLargeSql && !isManual && !isTrigger) {
        return { suggestions: [] };
      }

      const lineText = model.getLineContent(position.lineNumber);
      const dotContext = parseDotContext(lineText, position.column);

      if (dotContext) {
        const sqlCtx = getSqlContext(model);
        const prefix = dotContext.columnPrefix;

        const range: MonacoEditor.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: dotContext.replaceStartColumn,
          endColumn: position.column,
        };

        if (
          isDatabaseQualifier(
            dotContext.tableRef,
            ctx.tables,
            database,
            sqlCtx.aliasMap,
            ctx.columnsByTable,
          )
        ) {
          const tableNames = getTablesForDatabaseQualifier(
            dotContext.tableRef,
            ctx.tables,
            prefix,
            database,
          );

          return {
            suggestions: limitSuggestions(
              tableNames.map((label) => ({
                label,
                kind: monaco.languages.CompletionItemKind.Class,
                insertText: label,
                range,
                sortText: `0_${label}`,
              })),
            ),
          };
        }

        const columnLookupRef = dotContext.tableRef.includes(".")
          ? dotContext.tableRef
          : resolveTableRef(dotContext.tableRef, sqlCtx.aliasMap);
        const columns = resolveTableColumns(columnLookupRef, database, ctx.columnsByTable);

        return {
          suggestions: limitSuggestions(
            buildColumnSuggestions(monaco, columns, prefix, range, "0"),
          ),
        };
      }

      const word = getSqlWordAtPosition(lineText, position.column);
      const range: MonacoEditor.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const prefix = word.word;

      if (!prefix && !isManual) {
        return { suggestions: [] };
      }

      const sqlCtx = isLargeSql ? null : getSqlContext(model);
      const scopedColumns =
        sqlCtx && sqlCtx.tablesInQuery.length > 0
          ? collectColumnsForTables(sqlCtx.tablesInQuery, database, ctx.columnsByTable)
          : [];

      const scopedColumnItems =
        scopedColumns.length > 0
          ? buildColumnSuggestions(monaco, scopedColumns, prefix, range, "0")
          : [];

      const tableItems = buildTableSuggestions(monaco, ctx.tables, prefix, range);
      const keywordItems = buildKeywordSuggestions(monaco, prefix, range);

      if (isManual && !prefix) {
        const manualTables = buildTableSuggestions(monaco, ctx.tables, "", range);
        const manualScoped =
          scopedColumns.length > 0
            ? buildColumnSuggestions(monaco, scopedColumns.slice(0, 30), "", range, "0")
            : [];

        return {
          suggestions: limitSuggestions([
            ...manualScoped,
            ...manualTables,
            ...buildKeywordSuggestions(monaco, "S", range).slice(0, 8),
          ]),
        };
      }

      return {
        suggestions: limitSuggestions([...scopedColumnItems, ...tableItems, ...keywordItems]),
      };
    },
  });
}
