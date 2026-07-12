const SQL_KEYWORDS = new Set([
  "select", "from", "where", "join", "left", "right", "inner", "outer", "cross", "full",
  "on", "as", "and", "or", "not", "in", "exists", "between", "like", "is", "null",
  "group", "by", "order", "having", "limit", "offset", "union", "all", "distinct",
  "case", "when", "then", "else", "end", "with", "lateral", "unnest", "table",
  "set", "values", "into", "insert", "update", "delete", "create", "drop", "alter",
  "true", "false", "asc", "desc", "over", "partition", "range", "rows", "unbounded",
  "preceding", "following", "current", "row", "cast", "interval", "timestamp", "date",
]);

export function extractTablesFromSql(sql: string): string[] {
  const tables = new Set<string>();
  const pattern = /\b(?:FROM|JOIN)\s+(?:LATERAL\s+)?(?:TABLE\s*\(\s*)?[`"]?([\w.]+)[`"]?/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    const ref = match[1];
    if (!ref || ref.includes("(")) continue;
    const parts = ref.split(".");
    const table = parts[parts.length - 1];
    if (table && !isSqlKeyword(table)) {
      tables.add(table);
    }
  }

  return Array.from(tables);
}

/** Maps alias (or table name) → base table name for everything referenced in FROM/JOIN. */
export function extractTableAliasMap(sql: string): Map<string, string> {
  const aliasToTable = new Map<string, string>();
  const pattern =
    /\b(?:FROM|JOIN)\s+(?:LATERAL\s+)?(?:TABLE\s*\(\s*)?[`"]?([\w.]+)[`"]?(?:\s+(?:AS\s+)?([`"]?)([A-Za-z_]\w*)\2)?/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    const tableRef = match[1];
    if (!tableRef || tableRef.includes("(")) continue;

    const table = tableRef.split(".").pop() ?? tableRef;
    if (isSqlKeyword(table)) continue;

    registerTableAlias(aliasToTable, table, table);

    const alias = match[3];
    if (alias && !isSqlKeyword(alias)) {
      registerTableAlias(aliasToTable, alias, table);
    }
  }

  return aliasToTable;
}

function registerTableAlias(map: Map<string, string>, alias: string, table: string) {
  map.set(alias, table);
  map.set(alias.toLowerCase(), table);
}

export function resolveTableRef(ref: string, aliasMap: Map<string, string>): string {
  const bare = ref.includes(".") ? ref.split(".").pop() ?? ref : ref;
  return (
    aliasMap.get(ref) ??
    aliasMap.get(ref.toLowerCase()) ??
    aliasMap.get(bare) ??
    aliasMap.get(bare.toLowerCase()) ??
    bare
  );
}

export function collectColumnsForTables(
  tables: Iterable<string>,
  database: string | undefined,
  columnsByTable: Record<string, string[]>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const table of tables) {
    for (const column of resolveTableColumns(table, database, columnsByTable)) {
      if (seen.has(column)) continue;
      seen.add(column);
      result.push(column);
    }
  }

  return result;
}

function isSqlKeyword(word: string): boolean {
  return SQL_KEYWORDS.has(word.toLowerCase());
}

export function tableLookupKeys(database: string, table: string): string[] {
  return [table, `${database}.${table}`, table.toLowerCase(), `${database}.${table}`.toLowerCase()];
}

export function resolveTableColumns(
  tableRef: string,
  database: string | undefined,
  columnsByTable: Record<string, string[]>,
): string[] {
  const candidates = new Set<string>([
    tableRef,
    tableRef.toLowerCase(),
    database ? `${database}.${tableRef}` : "",
    database ? `${database}.${tableRef}`.toLowerCase() : "",
  ]);

  for (const key of candidates) {
    if (!key) continue;
    const cols = columnsByTable[key];
    if (cols?.length) return cols;
  }

  return [];
}

export function getTablesForDatabaseQualifier(
  databaseRef: string,
  tables: string[],
  prefix: string,
  currentDatabase?: string,
): string[] {
  const normalizedPrefix = prefix.toLowerCase();
  const qualifiedPrefix = `${databaseRef}.`.toLowerCase();
  const seen = new Set<string>();
  const result: string[] = [];

  for (const table of tables) {
    const lower = table.toLowerCase();
    let candidate: string | null = null;

    if (lower.startsWith(qualifiedPrefix)) {
      candidate = table.slice(databaseRef.length + 1);
    } else if (
      currentDatabase &&
      databaseRef.toLowerCase() === currentDatabase.toLowerCase() &&
      !lower.includes(".")
    ) {
      candidate = table;
    }

    if (!candidate || seen.has(candidate.toLowerCase())) continue;
    if (!candidate.toLowerCase().startsWith(normalizedPrefix)) continue;

    seen.add(candidate.toLowerCase());
    result.push(candidate);
  }

  return result;
}

export function isDatabaseQualifier(
  ref: string,
  tables: string[],
  currentDatabase: string | undefined,
  aliasMap: Map<string, string>,
  columnsByTable: Record<string, string[]>,
): boolean {
  if (ref.includes(".")) {
    return false;
  }

  if (aliasMap.has(ref) || aliasMap.has(ref.toLowerCase())) {
    return false;
  }

  const qualifiedPrefix = `${ref}.`.toLowerCase();
  if (tables.some((table) => table.toLowerCase().startsWith(qualifiedPrefix))) {
    return true;
  }

  if (currentDatabase && ref.toLowerCase() === currentDatabase.toLowerCase()) {
    return true;
  }

  return resolveTableColumns(ref, currentDatabase, columnsByTable).length === 0;
}

export interface DotContext {
  tableRef: string;
  columnPrefix: string;
  replaceStartColumn: number;
}

export function parseDotContext(lineText: string, column: number): DotContext | null {
  const before = lineText.slice(0, column - 1);
  const match = before.match(/(?:^|[\s,(\[+])([`"]?)([\w.]+)\1\.([`]?)([\w]*)$/);
  if (!match) return null;

  const tableRef = match[2];
  const columnPrefix = match[4] ?? "";
  const dotAt = before.lastIndexOf(".");
  const replaceStartColumn = dotAt + 2;

  return { tableRef, columnPrefix, replaceStartColumn };
}

export function getSqlWordAtPosition(
  lineText: string,
  column: number,
): { word: string; startColumn: number; endColumn: number } {
  const index = column - 1;
  const identifier = /[A-Za-z_][\w]*/g;

  let match: RegExpExecArray | null;
  while ((match = identifier.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (index >= start && index <= end) {
      return {
        word: match[0],
        startColumn: start + 1,
        endColumn: end + 1,
      };
    }
    if (start > index) break;
  }

  return { word: "", startColumn: column, endColumn: column };
}
