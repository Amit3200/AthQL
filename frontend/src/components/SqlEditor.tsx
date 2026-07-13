import Editor, { type Monaco } from "@monaco-editor/react";
import { memo, useCallback, useEffect, useRef } from "react";

import { api } from "../api/client";
import { useTheme } from "../context/ThemeContext";
import { useNotify } from "../hooks/useNotify";
import type { SqlCompletionContext } from "../types";
import { ensureSqlCompletionProvider, updateSqlCompletionState } from "../utils/sqlCompletionProvider";
import { getExecutableSql } from "../utils/sqlExecution";
import { defineSqlThemes } from "../utils/sqlThemes";

const SYNC_DEBOUNCE_MS = 500;
const LARGE_DOC_CHARS = 8_000;
const LARGE_DOC_LINES = 120;

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  completions?: SqlCompletionContext;
  database?: string;
  isActive?: boolean;
  onRun?: (sql: string) => void;
  onFormatRef?: React.MutableRefObject<(() => void) | null>;
  onRunRef?: React.MutableRefObject<(() => void) | null>;
  onGetSqlRef?: React.MutableRefObject<(() => string) | null>;
}

function isLargeDocument(lineCount: number, charCount: number): boolean {
  return lineCount > LARGE_DOC_LINES || charCount > LARGE_DOC_CHARS;
}

function SqlEditorInner({
  value,
  onChange,
  completions,
  database,
  isActive = true,
  onRun,
  onFormatRef,
  onRunRef,
  onGetSqlRef,
}: SqlEditorProps) {
  const { message } = useNotify();
  const { editorTheme } = useTheme();
  const editorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const onRunCallbackRef = useRef(onRun);
  const onChangeRef = useRef(onChange);
  const externalValueRef = useRef(value);
  const isInternalChangeRef = useRef(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const largeDocRef = useRef(false);

  onRunCallbackRef.current = onRun;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!isActive) return;
    updateSqlCompletionState(completions ?? { tables: [], columns: [], columnsByTable: {} }, database);
  }, [isActive, completions, database]);

  useEffect(() => {
    if (!monacoRef.current) return;
    monacoRef.current.editor.setTheme(editorTheme);
  }, [editorTheme]);

  const flushToParent = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextValue = editor.getValue();
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (nextValue !== externalValueRef.current) {
      isInternalChangeRef.current = true;
      externalValueRef.current = nextValue;
      onChangeRef.current(nextValue);
    }
  }, []);

  const applyEditorPerformanceMode = useCallback((editor: import("monaco-editor").editor.IStandaloneCodeEditor) => {
    const model = editor.getModel();
    if (!model) return;

    const large = isLargeDocument(model.getLineCount(), model.getValueLength());
    if (large === largeDocRef.current) return;
    largeDocRef.current = large;

    editor.updateOptions({
      quickSuggestions: large ? false : { other: true, comments: false, strings: false },
      quickSuggestionsDelay: large ? 600 : 300,
      wordWrap: large ? "off" : "on",
      folding: !large,
    });
  }, []);

  useEffect(() => {
    if (isInternalChangeRef.current) {
      isInternalChangeRef.current = false;
      return;
    }

    const editor = editorRef.current;
    if (!editor) {
      externalValueRef.current = value;
      return;
    }

    const model = editor.getModel();
    if (!model || model.getValue() === value) {
      externalValueRef.current = value;
      return;
    }

    const position = editor.getPosition();
    const selection = editor.getSelection();
    const scrollTop = editor.getScrollTop();

    editor.pushUndoStop();
    editor.executeEdits("external-sync", [{ range: model.getFullModelRange(), text: value, forceMoveMarkers: true }]);
    editor.pushUndoStop();

    if (position) editor.setPosition(position);
    if (selection) editor.setSelection(selection);
    editor.setScrollTop(scrollTop);

    externalValueRef.current = value;
    applyEditorPerformanceMode(editor);
  }, [value, applyEditorPerformanceMode]);

  useEffect(
    () => () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    },
    [],
  );

  const runFromEditor = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const sql = getExecutableSql(editor);
    if (sql.trim()) {
      onRunCallbackRef.current?.(sql);
    }
  }, []);

  const formatSql = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;

    const model = editor.getModel();
    const selection = editor.getSelection();
    if (!model || !selection) return;

    const selectedText = model.getValueInRange(selection);
    const sql = selectedText.trim() ? selectedText : editor.getValue();
    if (!sql.trim()) return;

    try {
      const result = await api.format(sql);
      if (selectedText.trim()) {
        editor.executeEdits("format", [
          {
            range: selection,
            text: result.sql,
            forceMoveMarkers: true,
          },
        ]);
        flushToParent();
      } else {
        isInternalChangeRef.current = true;
        externalValueRef.current = result.sql;
        onChangeRef.current(result.sql);
        editor.setValue(result.sql);
      }
      message.success("SQL formatted");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Format failed");
    }
  }, [flushToParent, message]);

  useEffect(() => {
    if (!onFormatRef) return;
    onFormatRef.current = formatSql;
    return () => {
      onFormatRef.current = null;
    };
  }, [formatSql, onFormatRef]);

  useEffect(() => {
    if (!onRunRef) return;
    onRunRef.current = runFromEditor;
    return () => {
      onRunRef.current = null;
    };
  }, [runFromEditor, onRunRef]);

  useEffect(() => {
    if (!onGetSqlRef) return;
    onGetSqlRef.current = () => editorRef.current?.getValue() ?? externalValueRef.current;
    return () => {
      onGetSqlRef.current = null;
    };
  }, [onGetSqlRef]);

  const handleBeforeMount = useCallback(
    (monaco: Monaco) => {
      monacoRef.current = monaco;
      ensureSqlCompletionProvider(monaco);
      defineSqlThemes(monaco);
      monaco.editor.setTheme(editorTheme);
    },
    [editorTheme],
  );

  const handleMount = useCallback(
    (editor: import("monaco-editor").editor.IStandaloneCodeEditor, monaco: typeof import("monaco-editor")) => {
      editorRef.current = editor;
      externalValueRef.current = editor.getValue();
      applyEditorPerformanceMode(editor);

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
        void formatSql();
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        runFromEditor();
      });
    },
    [applyEditorPerformanceMode, formatSql, runFromEditor],
  );

  const handleChange = useCallback(
    (nextValue: string | undefined) => {
      const editor = editorRef.current;
      if (editor) {
        applyEditorPerformanceMode(editor);
      }

      const normalized = nextValue ?? "";
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        syncTimerRef.current = null;
        if (normalized !== externalValueRef.current) {
          isInternalChangeRef.current = true;
          externalValueRef.current = normalized;
          onChangeRef.current(normalized);
        }
      }, SYNC_DEBOUNCE_MS);
    },
    [applyEditorPerformanceMode],
  );

  return (
    <div style={{ height: "100%", padding: "4px 0" }}>
      <Editor
        height="100%"
        defaultLanguage="sql"
        theme={editorTheme}
        defaultValue={value}
        onChange={handleChange}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          suggestOnTriggerCharacters: true,
          quickSuggestions: { other: true, comments: false, strings: false },
          quickSuggestionsDelay: 300,
          tabCompletion: "off",
          acceptSuggestionOnCommitCharacter: false,
          acceptSuggestionOnEnter: "smart",
          wordBasedSuggestions: "off",
          lineNumbersMinChars: 3,
          folding: true,
          renderLineHighlight: "line",
          smoothScrolling: false,
          cursorBlinking: "solid",
          cursorSmoothCaretAnimation: "off",
          formatOnType: false,
          formatOnPaste: false,
          largeFileOptimizations: true,
        }}
      />
    </div>
  );
}

export const SqlEditor = memo(SqlEditorInner);
