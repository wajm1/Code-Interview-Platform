/**
 * Collaborative Monaco editor for a single interview room.
 *
 * Creates the editor once per room, syncs local edits to the server
 * (throttled), and applies remote patches without echo loops.
 * Language changes only update syntax highlighting — the buffer is kept.
 */

import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";

/**
 * @param {object} props
 * @param {string} props.roomId
 * @param {import("socket.io-client").Socket} props.socket
 * @param {"python"|"javascript"|"cpp"|"java"} [props.language]
 * @param {(code: string) => void} [props.onChange]
 */
export default function Editor({ roomId, socket, language = "python", onChange }) {
  const editorElRef = useRef(null);
  const editorRef = useRef(null);
  /** Last code applied from the server — used to skip re-broadcasting echoes. */
  const inboundRef = useRef("");
  /** Debounce timer for outbound code:update events. */
  const throttleRef = useRef(null);

  // Create the editor once per room (do not depend on language or onChange).
  useEffect(() => {
    const el = editorElRef.current;
    if (!el) return;

    const editor = monaco.editor.create(el, {
      value:
        "# Start coding together!\n# Text persists across Run and language changes.\n",
      language,
      automaticLayout: true,
      fontSize: 14,
      minimap: { enabled: false },
      theme: "vs-dark",
    });
    editorRef.current = editor;

    try {
      if (typeof onChange === "function") onChange(editor.getValue());
    } catch {
      /* ignore */
    }

    const onLocalChange = () => {
      const code = editor.getValue();
      if (typeof onChange === "function") onChange(code);
      if (code === inboundRef.current) return;

      clearTimeout(throttleRef.current);
      throttleRef.current = setTimeout(() => {
        if (socket?.connected) {
          socket.emit("code:update", { roomId, code });
        }
      }, 120);
    };
    const disposable = editor.onDidChangeModelContent(onLocalChange);

    const onApply = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      const current = editor.getValue();
      if (payload.code !== current) {
        inboundRef.current = payload.code;
        editor.setValue(payload.code);
        if (typeof onChange === "function") onChange(payload.code);
      }
    };

    socket?.on("code:apply", onApply);

    return () => {
      disposable?.dispose();
      socket?.off("code:apply", onApply);
      clearTimeout(throttleRef.current);
      try {
        editor.dispose();
      } catch {
        /* ignore */
      }
      editorRef.current = null;
    };
    // Intentionally omit language / onChange so the editor is not recreated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, socket]);

  // Update syntax highlighting without destroying the editor instance.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel?.();
    if (!model) return;
    monaco.editor.setModelLanguage(model, language);
  }, [language]);

  return <div ref={editorElRef} style={{ width: "100%", height: "100%" }} />;
}
