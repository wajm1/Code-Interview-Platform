/**
 * In-browser demo backend using BroadcastChannel + localStorage.
 *
 * Lets visitors try collaboration on GitHub Pages with no server:
 * open the same room URL in two tabs to see live code, chat, and presence.
 * Mirrors the Socket.IO event surface used by App / Editor.
 */

const CHANNEL_PREFIX = "cip-demo:";
const STORE_PREFIX = "cip-demo-store:";

function storageKey(roomId) {
  return `${STORE_PREFIX}${roomId}`;
}

function loadRoom(roomId) {
  try {
    const raw = localStorage.getItem(storageKey(roomId));
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {
    code: "# Demo mode — open this URL in another tab to collaborate.\n",
    chat: [],
    members: {},
    language: "python",
  };
}

function saveRoom(roomId, state) {
  localStorage.setItem(storageKey(roomId), JSON.stringify(state));
}

function closeRoom(roomId) {
  localStorage.removeItem(storageKey(roomId));
}

function pruneMembers(members) {
  const now = Date.now();
  const next = {};
  for (const [name, ts] of Object.entries(members || {})) {
    if (now - ts < 15000) next[name] = ts;
  }
  return next;
}

/**
 * Minimal Socket.IO-like client for demo mode.
 * Supports: on/off/emit, connected, connect/disconnect events.
 */
export function createDemoSocket() {
  const handlers = new Map();
  let channel = null;
  let roomId = "default";
  let myName = null;
  let heartbeat = null;
  let connected = false;

  const api = {
    get connected() {
      return connected;
    },
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
      return api;
    },
    off(event, fn) {
      handlers.get(event)?.delete(fn);
      return api;
    },
    emit(event, data) {
      handleEmit(event, data);
      return api;
    },
    disconnect() {
      cleanup();
    },
  };

  function fire(event, payload) {
    handlers.get(event)?.forEach((fn) => {
      try {
        fn(payload);
      } catch {
        /* ignore */
      }
    });
  }

  function broadcast(message) {
    channel?.postMessage(message);
  }

  function publishPresence(extra = {}) {
    const state = loadRoom(roomId);
    state.members = pruneMembers(state.members);
    if (myName) state.members[myName] = Date.now();
    saveRoom(roomId, state);
    const members = Object.keys(state.members).sort();
    fire("room:presence", { roomId, members, ...extra });
    broadcast({ type: "presence", roomId, members, ...extra });
  }

  function handleEmit(event, data) {
    if (event === "join") {
      roomId = data?.roomId || "default";
      myName = data?.name || `User-${Math.random().toString(36).slice(2, 7)}`;
      channel?.close();
      channel = new BroadcastChannel(`${CHANNEL_PREFIX}${roomId}`);
      channel.onmessage = (ev) => onPeerMessage(ev.data);

      const state = loadRoom(roomId);
      state.members = pruneMembers(state.members);
      const base = myName;
      let name = base;
      let i = 2;
      while (state.members[name]) {
        name = `${base} (${i++})`;
      }
      myName = name;
      state.members[myName] = Date.now();
      saveRoom(roomId, state);

      fire("room:state", {
        roomId,
        code: state.code || "",
        chat: (state.chat || []).slice(-50),
        members: Object.keys(state.members).sort(),
        language: state.language || "python",
        you: myName,
      });
      publishPresence({ joined: myName });

      clearInterval(heartbeat);
      heartbeat = setInterval(() => publishPresence(), 4000);
      return;
    }

    if (event === "name:update") {
      const state = loadRoom(roomId);
      const old = myName;
      let next = (data?.name || "").trim();
      if (!next || !old) return;
      delete state.members[old];
      let name = next;
      let i = 2;
      while (state.members[name]) name = `${next} (${i++})`;
      myName = name;
      state.members[myName] = Date.now();
      saveRoom(roomId, state);
      fire("you:renamed", { name: myName });
      publishPresence({ renamed: { from: old, to: myName } });
      return;
    }

    if (event === "chat:send") {
      const text = (data?.text || "").trim();
      if (!text || !myName) return;
      const entry = { name: myName, text, ts: Date.now() / 1000 };
      const state = loadRoom(roomId);
      state.chat = [...(state.chat || []), entry].slice(-100);
      saveRoom(roomId, state);
      // Others receive via channel; sender already optimistically updates UI
      broadcast({ type: "chat", entry });
      return;
    }

    if (event === "code:update") {
      const state = loadRoom(roomId);
      state.code = data?.code ?? "";
      saveRoom(roomId, state);
      broadcast({ type: "code", roomId, code: state.code });
      return;
    }

    if (event === "lang:update") {
      const language = data?.language;
      if (!language) return;
      const state = loadRoom(roomId);
      state.language = language;
      saveRoom(roomId, state);
      fire("lang:apply", { roomId, language });
      broadcast({ type: "lang", roomId, language });
    }
  }

  function onPeerMessage(msg) {
    if (!msg || msg.roomId && msg.roomId !== roomId && msg.type !== "chat") {
      // chat messages don't always include roomId in older shape
    }
    if (msg.type === "code" && msg.roomId === roomId) {
      fire("code:apply", { roomId, code: msg.code });
    } else if (msg.type === "chat") {
      fire("chat:recv", msg.entry);
    } else if (msg.type === "lang" && msg.roomId === roomId) {
      fire("lang:apply", { roomId, language: msg.language });
    } else if (msg.type === "presence" && msg.roomId === roomId) {
      fire("room:presence", msg);
    }
  }

  function cleanup() {
    clearInterval(heartbeat);
    if (myName) {
      const state = loadRoom(roomId);
      delete state.members[myName];
      const remaining = pruneMembers(state.members);
      const closed = Object.keys(remaining).length === 0;
      if (closed) {
        closeRoom(roomId);
      } else {
        state.members = remaining;
        saveRoom(roomId, state);
      }
      broadcast({
        type: "presence",
        roomId,
        members: Object.keys(remaining).sort(),
        left: myName,
        closed,
      });
    }
    channel?.close();
    channel = null;
    connected = false;
    fire("disconnect");
  }

  // Pretend we connected after a tick so App's effects behave normally.
  queueMicrotask(() => {
    connected = true;
    fire("connect");
    fire("server:hello", { msg: "demo" });
  });

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", cleanup);
  }

  return api;
}

/** True when the build (or URL) asks for offline demo mode. */
export function shouldUseDemoMode() {
  if (import.meta.env.VITE_DEMO === "true") return true;
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") return true;
  }
  return false;
}
