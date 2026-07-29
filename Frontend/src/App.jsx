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
import "./Workspace.css";

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

function createRoomId() {
  // Short, shareable room codes (e.g. "k7f2qm")
  return Math.random().toString(36).slice(2, 8);
}

/** Use ?room= from the URL, or mint a new room for this session. */
function resolveRoomId() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("room")?.trim();
  if (fromUrl) return fromUrl;
  return createRoomId();
}

/**
 * Invite URL for this room only.
 * Always includes ?room=<id> so invitees join the same session.
 */
function buildInviteLink(roomId) {
  const url = new URL(window.location.href);
  url.hash = "";
  // Clear existing query, then set only the room (drop personal name, etc.)
  url.search = "";
  url.searchParams.set("room", roomId);
  return url.toString();
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
  const roomId = useMemo(() => resolveRoomId(), []);
  const [connected, setConnected] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  // Put ?room=<id> in the address bar immediately so the page URL is shareable.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.hash = "";
    url.search = "";
    url.searchParams.set("room", roomId);
    window.history.replaceState({}, "", url);
  }, [roomId]);

  const copyInviteLink = async () => {
    const link = buildInviteLink(roomId);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt("Copy this invite link:", link);
      return;
    }
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 2000);
  };

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

  // Resizable terminal (editor ↔ console split)
  const [consoleHeight, setConsoleHeight] = useState(220);
  const [draggingConsole, setDraggingConsole] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  useEffect(() => {
    if (!draggingConsole) return;
    const onMove = (event) => {
      const dy = event.clientY - dragStartY.current;
      // Dragging the handle down shrinks the console; up grows it.
      const next = Math.max(120, Math.min(480, dragStartHeight.current - dy));
      setConsoleHeight(next);
    };
    const onUp = () => setDraggingConsole(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingConsole]);

  return (
    <div className="ws">
      <div className="ws-topbar">
        <div className="ws-topbar-left">
          <strong>Code Interview Platform</strong>
          <span className="ws-muted">
            Room: <code>{roomId}</code>
          </span>
          <span className="ws-muted">
            {DEMO_MODE
              ? connected
                ? "multi-device"
                : "connecting…"
              : connected
                ? "connected"
                : "offline"}
          </span>
        </div>
        <div className="ws-topbar-right">
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
          <button type="button" onClick={copyInviteLink}>
            {inviteCopied ? "Copied!" : "Copy Invite Link"}
          </button>
          <button type="button" onClick={rename}>
            Rename
          </button>
        </div>
      </div>

      <div className="ws-main">
        <div className="ws-editor">
          <Editor
            roomId={roomId}
            socket={socket}
            language={language}
            onChange={handleEditorChange}
          />
        </div>

        <div
          className="ws-split-y"
          title="Drag to resize terminal"
          onMouseDown={(e) => {
            e.preventDefault();
            setDraggingConsole(true);
            dragStartY.current = e.clientY;
            dragStartHeight.current = consoleHeight;
          }}
        />

        <div className="ws-console" style={{ height: consoleHeight }}>
          <div className="ws-console-toolbar">
            <button type="button" onClick={runCode}>
              Run ({language})
            </button>
            <span className="ws-muted">Output</span>
          </div>
          <textarea
            className="ws-console-out"
            value={runOutput}
            readOnly
            placeholder="Program output will appear here…"
          />
        </div>
      </div>

      <aside className="ws-sidebar">
        <div className="ws-presence">
          <div style={{ marginBottom: 6, fontWeight: 600 }}>
            You: <code>{name || "—"}</code>
          </div>
          <div style={{ fontWeight: 600 }}>In room:</div>
          <ul>
            {members.map((member) => (
              <li key={member}>{member}</li>
            ))}
          </ul>
        </div>

        <div className="ws-chat">
          <div style={{ fontWeight: 600 }}>Chat</div>
          <div className="ws-chat-log">
            {messages.map((msg, index) => (
              <div key={`${msg.ts}-${index}`}>
                <b>{msg.name || "User"}</b>: {msg.text}
              </div>
            ))}
          </div>
          <div className="ws-chat-compose">
            <input
              ref={chatInputRef}
              placeholder="Type a message"
              onKeyDown={(e) => {
                if (e.key === "Enter") sendChat();
              }}
            />
            <button type="button" onClick={sendChat}>
              Send
            </button>
          </div>
        </div>
      </aside>

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
