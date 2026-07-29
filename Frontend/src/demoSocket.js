/**
 * Cross-device demo transport using Trystero (WebRTC peer-to-peer).
 *
 * GitHub Pages has no Flask server, so rooms sync directly between browsers
 * via public signaling (BitTorrent trackers). Same invite link (?room=…)
 * works across phones, laptops, and networks.
 *
 * Mirrors the Socket.IO event surface used by App / Editor.
 */

import { joinRoom } from "trystero";

const APP_ID = "code-interview-platform-wajm1";

const DEFAULT_CODE =
  "# Shared room — open the invite link on another device to collaborate.\n";

/**
 * Minimal Socket.IO-like client for demo / Pages mode.
 * Supports: on/off/emit, connected, connect/disconnect events.
 */
export function createDemoSocket() {
  const handlers = new Map();
  let room = null;
  let sync = null;
  let roomId = "default";
  let myName = null;
  let joinedAt = 0;
  let connected = false;
  let localCode = DEFAULT_CODE;
  let localChat = [];
  let localLang = "python";
  /** @type {Map<string, string>} peerId -> display name */
  const peerNames = new Map();

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

  function members() {
    const names = new Set();
    if (myName) names.add(myName);
    for (const name of peerNames.values()) {
      if (name) names.add(name);
    }
    return [...names].sort();
  }

  function emitPresence(extra = {}) {
    fire("room:presence", { roomId, members: members(), ...extra });
  }

  function snapshot() {
    return {
      t: "state",
      joinedAt,
      name: myName,
      code: localCode,
      chat: localChat.slice(-50),
      language: localLang,
    };
  }

  function applyRemoteState(msg) {
    if (typeof msg.code === "string") {
      localCode = msg.code;
      fire("code:apply", { roomId, code: msg.code });
    }
    if (Array.isArray(msg.chat)) {
      localChat = msg.chat;
    }
    if (msg.language) {
      localLang = msg.language;
      fire("lang:apply", { roomId, language: msg.language });
    }
    fire("room:state", {
      roomId,
      code: localCode,
      chat: localChat,
      members: members(),
      language: localLang,
      you: myName,
    });
  }

  function handleEmit(event, data) {
    if (event === "join") {
      roomId = data?.roomId || "default";
      myName = data?.name || `User-${Math.random().toString(36).slice(2, 7)}`;
      joinedAt = Date.now();
      localCode = DEFAULT_CODE;
      localChat = [];
      localLang = "python";
      peerNames.clear();

      if (room) {
        try {
          room.leave();
        } catch {
          /* ignore */
        }
      }

      room = joinRoom({ appId: APP_ID }, `cip:${roomId}`, {
        onJoinError: ({ error, peerId }) => {
          console.warn("[cip] peer join issue", peerId, error);
        },
      });
      sync = room.makeAction("sync");

      room.onPeerJoin = (peerId) => {
        // Announce ourselves; existing peers answer with full state if older.
        sync.send({ t: "hello", name: myName, joinedAt }, { target: peerId });
      };

      room.onPeerLeave = (peerId) => {
        const left = peerNames.get(peerId);
        peerNames.delete(peerId);
        emitPresence(left ? { left } : {});
      };

      sync.onMessage = (msg, { peerId }) => {
        if (!msg || typeof msg !== "object") return;

        if (msg.t === "hello") {
          if (msg.name) peerNames.set(peerId, msg.name);
          emitPresence({ joined: msg.name });
          // Share our snapshot so late joiners catch up.
          sync.send(snapshot(), { target: peerId });
          return;
        }

        if (msg.t === "state") {
          if (msg.name) peerNames.set(peerId, msg.name);
          // Prefer state from peers who joined the room earlier than we did.
          if (typeof msg.joinedAt === "number" && msg.joinedAt <= joinedAt) {
            applyRemoteState(msg);
          }
          emitPresence();
          return;
        }

        if (msg.t === "code") {
          localCode = msg.code ?? "";
          fire("code:apply", { roomId, code: localCode });
          return;
        }

        if (msg.t === "chat") {
          if (!msg.entry) return;
          localChat = [...localChat, msg.entry].slice(-100);
          fire("chat:recv", msg.entry);
          return;
        }

        if (msg.t === "lang") {
          if (!msg.language) return;
          localLang = msg.language;
          fire("lang:apply", { roomId, language: localLang });
          return;
        }

        if (msg.t === "rename") {
          if (msg.name) peerNames.set(peerId, msg.name);
          emitPresence(
            msg.from
              ? { renamed: { from: msg.from, to: msg.name } }
              : undefined,
          );
        }
      };

      fire("room:state", {
        roomId,
        code: localCode,
        chat: localChat,
        members: members(),
        language: localLang,
        you: myName,
      });
      emitPresence({ joined: myName });
      return;
    }

    if (event === "name:update") {
      const next = (data?.name || "").trim();
      if (!next || !myName) return;
      const old = myName;
      myName = next;
      fire("you:renamed", { name: myName });
      emitPresence({ renamed: { from: old, to: myName } });
      sync?.send({ t: "rename", from: old, name: myName });
      return;
    }

    if (event === "chat:send") {
      const text = (data?.text || "").trim();
      if (!text || !myName) return;
      const entry = { name: myName, text, ts: Date.now() / 1000 };
      localChat = [...localChat, entry].slice(-100);
      sync?.send({ t: "chat", entry });
      return;
    }

    if (event === "code:update") {
      localCode = data?.code ?? "";
      sync?.send({ t: "code", code: localCode });
      return;
    }

    if (event === "lang:update") {
      const language = data?.language;
      if (!language) return;
      localLang = language;
      fire("lang:apply", { roomId, language });
      sync?.send({ t: "lang", language });
    }
  }

  function cleanup() {
    try {
      room?.leave();
    } catch {
      /* ignore */
    }
    room = null;
    sync = null;
    peerNames.clear();
    connected = false;
    fire("disconnect");
  }

  queueMicrotask(() => {
    connected = true;
    fire("connect");
    fire("server:hello", { msg: "p2p-demo" });
  });

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", cleanup);
  }

  return api;
}

/** True when the build (or URL) asks for offline / Pages demo mode. */
export function shouldUseDemoMode() {
  if (import.meta.env.VITE_DEMO === "true") return true;
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") return true;
  }
  return false;
}
