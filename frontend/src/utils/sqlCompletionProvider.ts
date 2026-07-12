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
const MIN_PREFIX_FOR_GLOBAL_COLUMNS = 2;

let providerRegistered = false;

const completionState: {
  context: SqlCompletionContext;
  database?: string;
} = {
  context: { tables: [], columns: [], columnsByTable: {} },
  database: undefined,
};

export function updateSqlCompletionState(context: SqlCompletionContext, database?: string) {
  completionState.context = context;
  completionState.database = database;
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
  return items
    .sort((a, b) => {
      const aSort = a.sortText ?? (typeof a.label === "string" ? a.label : a.label.label);
      const bSort = b.sortText ?? (typeof b.label === "string" ? b.label : b.label.label);
      return aSort.localeCompare(bSort);
    })
    .slice(0, MAX_SUGGESTIONS);
}

function buildKeywordSuggestions(
  monaco: Monaco,
  prefix: string,
  range: MonacoEditor.IRange,
) {
  const normalizedPrefix = prefix.toLowerCase();
  return SQL_KEYWORDS.filter((kw) => kw.toLowerCase().startsWith(normalizedPrefix)).map((label) => ({
    label,
    kind: monaco.languages.CompletionItemKind.Keyword,
    insertText: label,
    range,
    sortText: `3_${label}`,
  }));
}

function buildTableSuggestions(
  monaco: Monaco,
  tables: string[],
  prefix: string,
  range: MonacoEditor.IRange,
) {
  const normalizedPrefix = prefix.toLowerCase();
  return tables
    .filter((t) => t.toLowerCase().startsWith(normalizedPrefix))
    .map((label) => ({
      label,
      kind: monaco.languages.CompletionItemKind.Class,
      insertText: label,
      range,
      sortText: `2_${label}`,
    }));
}

function buildColumnSuggestions(
  monaco: Monaco,
  columns: string[],
  prefix: string,
  range: MonacoEditor.IRange,
  sortPrefix: string,
) {
  return columns
    .filter((col) => shouldSuggestColumn(col, prefix))
    .map((label) => ({
      label,
      kind: monaco.languages.CompletionItemKind.Field,
      insertText: label,
      range,
      sortText: `${sortPrefix}_${label}`,
    }));
}

function buildGlobalColumnSuggestions(
  monaco: Monaco,
  columns: string[],
  prefix: string,
  range: MonacoEditor.IRange,
) {
  if (prefix.length < MIN_PREFIX_FOR_GLOBAL_COLUMNS) {
    return [];
  }

  return buildColumnSuggestions(monaco, columns, prefix, range, "1");
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
      const sql = model.getValue();
      const aliasMap = extractTableAliasMap(sql);
      const tablesInQuery = [...new Set(aliasMap.values())];
      const scopedColumns = collectColumnsForTables(tablesInQuery, database, ctx.columnsByTable);

      const lineText = model.getLineContent(position.lineNumber);
      const dotContext = parseDotContext(lineText, position.column);
      const isManual = context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke;

      if (dotContext) {
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
            aliasMap,
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
          : resolveTableRef(dotContext.tableRef, aliasMap);
        const columns = resolveTableColumns(columnLookupRef, database, ctx.columnsByTable);

        const suggestions = limitSuggestions(
          buildColumnSuggestions(monaco, columns, prefix, range, "0"),
        );

        return { suggestions };
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

      const scopedColumnItems =
        tablesInQuery.length > 0
          ? buildColumnSuggestions(monaco, scopedColumns, prefix, range, "0")
          : [];

      const tableItems = buildTableSuggestions(monaco, ctx.tables, prefix, range);
      const globalColumnItems = buildGlobalColumnSuggestions(monaco, ctx.columns, prefix, range);
      const keywordItems = buildKeywordSuggestions(monaco, prefix, range);

      if (isManual && !prefix) {
        const manualTables = buildTableSuggestions(monaco, ctx.tables, "", range);
        const manualScoped =
          tablesInQuery.length > 0
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
        suggestions: limitSuggestions([
          ...scopedColumnItems,
          ...tableItems,
          ...globalColumnItems,
          ...keywordItems,
        ]),
      };
    },
  });
}
