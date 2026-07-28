/**
 * Root application for the multi-user Code Interview Platform.
 *
 * Responsibilities:
 *  - Connect to the Flask-SocketIO backend
 *  - Prompt for a display name, then join a room
 *  - Sync presence, chat, language, and editor state
 *  - Run code (Python via Pyodide in-browser; other langs via /api/run)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { getApiBase } from "./config.js";
import { createDemoSocket, shouldUseDemoMode } from "./demoSocket.js";
import Editor from "./Editor.jsx";

const API_BASE = getApiBase();
const DEMO_MODE = shouldUseDemoMode();

/** One shared connection per tab (real Socket.IO or in-browser demo). */
const socket = DEMO_MODE
  ? createDemoSocket()
  : io(API_BASE, {
      transports: ["websocket", "polling"],
      withCredentials: true,
      autoConnect: true,
    });

// ---------------------------------------------------------------------------
// Pyodide (client-side Python)
// ---------------------------------------------------------------------------

let pyodideReady;

async function ensurePyodide() {
  if (!window.loadPyodide) throw new Error("Pyodide script not loaded");
  if (!pyodideReady) pyodideReady = window.loadPyodide();
  return pyodideReady;
}

async function runPythonLocal(code) {
  const py = await ensurePyodide();
  const safe = code.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
  const wrapped = `
import sys, io
buf_out, buf_err = io.StringIO(), io.StringIO()
__o, __e = sys.stdout, sys.stderr
sys.stdout, sys.stderr = buf_out, buf_err
try:
    exec("""${safe}""", {})
finally:
    sys.stdout, sys.stderr = __o, __e
__out, __err = buf_out.getvalue(), buf_err.getvalue()
`;
  await py.runPythonAsync(wrapped);
  const out = String(py.globals.get("__out") || "");
  const err = String(py.globals.get("__err") || "");
  try {
    py.globals.delete("__out");
    py.globals.delete("__err");
  } catch {
    /* ignore */
  }
  return { out, err };
}

/** Run JavaScript in a constrained Function scope and capture console.log. */
function runJavaScriptLocal(code) {
  const logs = [];
  const fakeConsole = {
    log: (...args) => logs.push(args.map(String).join(" ")),
    error: (...args) => logs.push(args.map(String).join(" ")),
    warn: (...args) => logs.push(args.map(String).join(" ")),
    info: (...args) => logs.push(args.map(String).join(" ")),
  };
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("console", code);
    const result = fn(fakeConsole);
    if (result !== undefined) logs.push(String(result));
    return { out: logs.join("\n"), err: "" };
  } catch (exc) {
    return { out: logs.join("\n"), err: String(exc) };
  }
}

/**
 * Execute code for the selected language.
 * Python → Pyodide; JavaScript → browser; others → Flask/Piston when available.
 */
async function executeCode(language, code, { demoMode, apiBase }) {
  if (language === "python") return runPythonLocal(code);
  if (language === "javascript") return runJavaScriptLocal(code);

  if (demoMode) {
    return {
      out: "",
      err:
        `${language} needs a full-stack backend with a code-execution service.\n` +
        "Python and JavaScript run entirely in your browser in demo mode.",
    };
  }

  const response = await fetch(`${apiBase}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, code }),
  });
  const json = await response.json();
  return { out: json.out || "", err: json.err || "" };
}

// ---------------------------------------------------------------------------
// URL / storage helpers
// ---------------------------------------------------------------------------

function getRoomId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("room") || "default";
}

function getStoredName() {
  const params = new URLSearchParams(window.location.search);
  const fromURL = params.get("name");
  if (fromURL?.trim()) return fromURL.trim();
  const saved = localStorage.getItem("mu_name");
  if (saved?.trim()) return saved.trim();
  return "";
}

// ---------------------------------------------------------------------------
// Name modal
// ---------------------------------------------------------------------------

function NameModal({ initial, onSubmit }) {
  const [val, setVal] = useState(initial || "");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: 360,
          background: "var(--panel)",
          color: "var(--text)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: 18,
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Choose a display name</h3>
        <p style={{ marginTop: 0, color: "var(--muted)" }}>
          This name will be visible to others in the room.
        </p>
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="e.g. Waj"
          style={{ width: "100%", margin: "8px 0 12px" }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit(val.trim() || null);
          }}
          autoFocus
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={() => onSubmit(null)}>
            Cancel
          </button>
          <button type="button" onClick={() => onSubmit(val.trim() || null)}>
            Join
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const roomId = useMemo(() => getRoomId(), []);
  const [connected, setConnected] = useState(false);

  const [needsName, setNeedsName] = useState(true);
  const [name, setName] = useState(getStoredName());
  const hasJoinedRef = useRef(false);

  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const chatInputRef = useRef(null);

  const [language, setLanguage] = useState("python");
  const latestCodeRef = useRef("");
  const [runOutput, setRunOutput] = useState("");

  const handleEditorChange = useCallback((code) => {
    latestCodeRef.current = code;
  }, []);

  // Socket lifecycle — bind once per room; do not depend on `name`.
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onRoomState = (state) => {
      if (state?.you) {
        setName(state.you);
        localStorage.setItem("mu_name", state.you);
      }
      if (Array.isArray(state?.members)) setMembers(state.members);
      if (Array.isArray(state?.chat)) setMessages(state.chat);
      if (state?.language) setLanguage(state.language);
    };

    const onPresence = (payload) => {
      if (Array.isArray(payload?.members)) setMembers(payload.members);
    };

    const onChatRecv = (payload) => {
      if (payload && typeof payload.text === "string" && payload.text.length) {
        setMessages((prev) => [...prev, payload]);
      }
    };

    const onLangApply = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      setLanguage(payload.language);
    };

    const onYouRenamed = (payload) => {
      if (payload?.name) {
        setName(payload.name);
        localStorage.setItem("mu_name", payload.name);
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    socket.on("room:presence", onPresence);
    socket.on("chat:recv", onChatRecv);
    socket.on("lang:apply", onLangApply);
    socket.on("you:renamed", onYouRenamed);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onRoomState);
      socket.off("room:presence", onPresence);
      socket.off("chat:recv", onChatRecv);
      socket.off("lang:apply", onLangApply);
      socket.off("you:renamed", onYouRenamed);
    };
  }, [roomId]);

  // Join only after the user confirms a display name.
  useEffect(() => {
    if (!connected || needsName || !name || hasJoinedRef.current) return;
    hasJoinedRef.current = true;
    socket.emit("join", { roomId, name });
  }, [connected, roomId, name, needsName]);

  const sendChat = () => {
    const text = chatInputRef.current?.value?.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { name, text, ts: Date.now() / 1000 }]);
    socket.emit("chat:send", { roomId, text });
    chatInputRef.current.value = "";
  };

  const rename = () => {
    const next = window.prompt("Choose a new display name:", name || "");
    if (!next) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === name) return;
    socket.emit("name:update", { name: trimmed });
  };

  const runCode = async () => {
    const code = latestCodeRef.current || "";
    let out = "";
    let err = "";
    try {
      const result = await executeCode(language, code, {
        demoMode: DEMO_MODE,
        apiBase: API_BASE,
      });
      out = result.out;
      err = result.err;
    } catch (exc) {
      err = String(exc);
    }
    const full = [
      err ? `Error:\n${err}` : "",
      out ? `Output:\n${out}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    setRunOutput(full || "—");
  };

  // Resizable chat panel
  const [chatHeight, setChatHeight] = useState(260);
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  useEffect(() => {
    const onMove = (event) => {
      if (!dragging) return;
      const dy = event.clientY - dragStartY.current;
      setChatHeight(Math.max(120, Math.min(600, dragStartHeight.current + dy)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "grid",
        gridTemplateColumns: "1fr 360px",
        gridTemplateRows: "auto 1fr auto",
        gridTemplateAreas: `
          "topbar  topbar"
          "editor  sidebar"
          "console sidebar"
        `,
      }}
    >
      <div
        style={{
          gridArea: "topbar",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--line)",
          background: "var(--panel)",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <strong>Code Interview Platform</strong>
          <span style={{ color: "var(--muted)" }}>
            Room: <code>{roomId}</code>
          </span>
          <span style={{ color: "var(--muted)" }}>
            {DEMO_MODE
              ? "demo mode"
              : connected
                ? "connected"
                : "offline"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={language}
            onChange={(e) => {
              const next = e.target.value;
              setLanguage(next);
              socket.emit("lang:update", { roomId, language: next });
            }}
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="cpp">C++</option>
            <option value="java">Java</option>
          </select>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(window.location.href)}
          >
            Copy Invite Link
          </button>
          <button type="button" onClick={rename}>
            Rename
          </button>
        </div>
      </div>

      <div
        style={{
          gridArea: "editor",
          minWidth: 0,
          minHeight: 0,
          borderRight: "1px solid var(--line)",
        }}
      >
        <Editor
          roomId={roomId}
          socket={socket}
          language={language}
          onChange={handleEditorChange}
        />
      </div>

      <div
        style={{
          gridArea: "sidebar",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: "var(--panel)",
          borderLeft: "1px solid var(--line)",
        }}
      >
        <div style={{ padding: 12, borderBottom: "1px solid var(--line)" }}>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>
            You: <code>{name || "—"}</code>
          </div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>In room:</div>
          <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 140, overflowY: "auto" }}>
            {members.map((member) => (
              <li key={member}>{member}</li>
            ))}
          </ul>
        </div>

        <div
          onMouseDown={(e) => {
            setDragging(true);
            dragStartY.current = e.clientY;
            dragStartHeight.current = chatHeight;
          }}
          style={{
            height: 6,
            cursor: "row-resize",
            background: "linear-gradient(90deg, transparent, var(--line), transparent)",
          }}
          title="Drag to resize chat"
        />

        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Chat</div>
          <div
            style={{
              height: chatHeight,
              overflowY: "auto",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: 8,
              background: "#0b0d12",
            }}
          >
            {messages.map((msg, index) => (
              <div key={`${msg.ts}-${index}`} style={{ marginBottom: 6 }}>
                <b>{msg.name || "User"}</b>: {msg.text}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={chatInputRef}
              placeholder="Type a message"
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendChat();
              }}
            />
            <button type="button" onClick={sendChat}>
              Send
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          gridArea: "console",
          borderTop: "1px solid var(--line)",
          background: "var(--panel)",
          padding: 10,
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
        }}
      >
        <button type="button" onClick={runCode}>
          Run ({language})
        </button>
        <div style={{ color: "var(--muted)", paddingTop: 6 }}>Output:</div>
        <textarea
          value={runOutput}
          readOnly
          style={{
            flex: 1,
            minHeight: 60,
            maxHeight: 240,
            height: 100,
            resize: "vertical",
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "#0b0d12",
            color: "var(--text)",
            padding: 8,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            whiteSpace: "pre-wrap",
          }}
          placeholder="Program output will appear here…"
        />
      </div>

      {needsName && (
        <NameModal
          initial={getStoredName()}
          onSubmit={(val) => {
            if (!val) return;
            localStorage.setItem("mu_name", val);
            setName(val);
            setNeedsName(false);
          }}
        />
      )}
    </div>
  );
}
