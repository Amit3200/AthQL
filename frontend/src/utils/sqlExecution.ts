import type * as MonacoEditor from "monaco-editor";

/** Returns highlighted SQL when present, otherwise the full editor contents. */
export function getExecutableSql(editor: MonacoEditor.editor.IStandaloneCodeEditor): string {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) {
    return editor.getValue();
  }

  const selectedText = model.getValueInRange(selection);
  if (selectedText.trim()) {
    return selectedText.trim();
  }

  return editor.getValue();
}
