import Editor, { type Monaco } from "@monaco-editor/react";
import { useCallback, useEffect, useRef } from "react";

import { api } from "../api/client";
import { useTheme } from "../context/ThemeContext";
import { useNotify } from "../hooks/useNotify";
import type { SqlCompletionContext } from "../types";
import { ensureSqlCompletionProvider, updateSqlCompletionState } from "../utils/sqlCompletionProvider";
import { getExecutableSql } from "../utils/sqlExecution";
import { defineSqlThemes } from "../utils/sqlThemes";

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  completions?: SqlCompletionContext;
  database?: string;
  isActive?: boolean;
  onRun?: (sql: string) => void;
  onFormatRef?: React.MutableRefObject<(() => void) | null>;
  onRunRef?: React.MutableRefObject<(() => void) | null>;
}

export function SqlEditor({
  value,
  onChange,
  completions,
  database,
  isActive = true,
  onRun,
  onFormatRef,
  onRunRef,
}: SqlEditorProps) {
  const { message } = useNotify();
  const { editorTheme } = useTheme();
  const editorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const onRunCallbackRef = useRef(onRun);
  onRunCallbackRef.current = onRun;

  useEffect(() => {
    if (!isActive) return;
    updateSqlCompletionState(completions ?? { tables: [], columns: [], columnsByTable: {} }, database);
  }, [isActive, completions, database]);

  useEffect(() => {
    if (!monacoRef.current) return;
    monacoRef.current.editor.setTheme(editorTheme);
  }, [editorTheme]);

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
        onChange(editor.getValue());
      } else {
        onChange(result.sql);
      }
      message.success("SQL formatted");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Format failed");
    }
  }, [onChange, message]);

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

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    monacoRef.current = monaco;
    ensureSqlCompletionProvider(monaco);
    defineSqlThemes(monaco);
    monaco.editor.setTheme(editorTheme);
  }, [editorTheme]);

  const handleMount = useCallback(
    (editor: import("monaco-editor").editor.IStandaloneCodeEditor, monaco: typeof import("monaco-editor")) => {
      editorRef.current = editor;
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
        void formatSql();
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        runFromEditor();
      });
    },
    [formatSql, runFromEditor],
  );

  const handleChange = useCallback(
    (nextValue: string | undefined) => {
      onChange(nextValue ?? "");
    },
    [onChange],
  );

  return (
    <div style={{ height: "100%", padding: "4px 0" }}>
      <Editor
        height="100%"
        defaultLanguage="sql"
        theme={editorTheme}
        value={value}
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
          smoothScrolling: true,
          cursorBlinking: "solid",
          cursorSmoothCaretAnimation: "off",
          formatOnType: false,
          formatOnPaste: false,
        }}
      />
    </div>
  );
}
