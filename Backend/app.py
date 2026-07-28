"""
Code Interview Platform — Flask + Socket.IO backend.

Provides:
  - Real-time collaborative editing, chat, and presence via WebSockets
  - Multi-language code execution via the public Piston API
  - Static serving of the built React frontend in production
"""

from __future__ import annotations

import os
import time
from collections import defaultdict
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

# Built frontend lives at Frontend/dist (created by `npm run build`).
STATIC_DIR = Path(__file__).resolve().parent.parent / "Frontend" / "dist"

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# ---------------------------------------------------------------------------
# In-memory room state (fine for demos; not durable across restarts)
# ---------------------------------------------------------------------------

ROOM_CODE: dict[str, str] = {}  # room -> latest shared editor text
ROOM_CHAT: dict[str, list] = defaultdict(list)  # room -> chat messages
ROOM_MEMBERS: dict[str, set] = defaultdict(set)  # room -> display names
ROOM_LANG: dict[str, str] = {}  # room -> language id
SID_TO_NAME: dict[str, str] = {}  # socket id -> display name
SID_TO_ROOM: dict[str, str] = {}  # socket id -> room id

# ---------------------------------------------------------------------------
# Piston (remote code execution)
# ---------------------------------------------------------------------------

PISTON_BASE = "https://emkc.org/api/v2/piston"
RUNTIMES_CACHE: dict = {"ts": 0.0, "data": []}
RUNTIMES_TTL = 600  # seconds

FILENAMES = {
    "javascript": "main.js",
    "python": "main.py",
    "cpp": "main.cpp",
    "java": "Main.java",
    "c": "main.c",
    "cs": "Main.cs",
    "go": "main.go",
    "ruby": "main.rb",
    "rust": "main.rs",
    "php": "main.php",
    "kotlin": "Main.kt",
    "swift": "main.swift",
}


def fetch_runtimes():
    """Return Piston runtimes, caching the result briefly."""
    now = time.time()
    if now - RUNTIMES_CACHE["ts"] < RUNTIMES_TTL and RUNTIMES_CACHE["data"]:
        return RUNTIMES_CACHE["data"]
    response = requests.get(f"{PISTON_BASE}/runtimes", timeout=10)
    response.raise_for_status()
    RUNTIMES_CACHE["data"] = response.json()
    RUNTIMES_CACHE["ts"] = now
    return RUNTIMES_CACHE["data"]


def resolve_lang_version(lang_name: str):
    """Map a language name/alias to a (language, version) Piston pair."""
    wanted = (lang_name or "").strip().lower()
    if not wanted:
        return None

    runtimes = fetch_runtimes()
    for runtime in runtimes:
        if runtime.get("language", "").lower() == wanted:
            return runtime["language"], runtime["version"]

    for runtime in runtimes:
        aliases = [a.lower() for a in runtime.get("aliases", [])]
        if wanted in aliases:
            return runtime["language"], runtime["version"]

    fallback = {"js": "javascript", "node": "javascript", "py": "python", "c++": "cpp"}
    if wanted in fallback:
        return resolve_lang_version(fallback[wanted])
    return None


# ---------------------------------------------------------------------------
# HTTP routes
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "backend", "version": 1})


@app.post("/api/run")
def api_run():
    """Execute code remotely through Piston and return stdout/stderr."""
    try:
        body = request.get_json(force=True, silent=True) or {}
        language = (body.get("language") or "").strip().lower()
        code = body.get("code", "")
        stdin = body.get("stdin", "")

        resolved = resolve_lang_version(language)
        if not resolved:
            return jsonify({"out": "", "err": f"Unsupported language: {language}"}), 400

        lang, version = resolved
        payload = {
            "language": lang,
            "version": version,
            "files": [{"name": FILENAMES.get(lang, "main.txt"), "content": code}],
            "stdin": stdin or "",
        }

        response = requests.post(f"{PISTON_BASE}/execute", json=payload, timeout=25)
        response.raise_for_status()
        data = response.json() if response.content else {}

        run = data.get("run") or {}
        compile_info = data.get("compile") or {}
        stdout = run.get("stdout") or ""
        stderr = run.get("stderr") or ""
        compile_err = compile_info.get("stderr") or ""
        err = (compile_err + ("\n" if compile_err and stderr else "") + stderr).strip()
        return jsonify({"out": stdout, "err": err})

    except requests.exceptions.HTTPError as exc:
        try:
            msg = exc.response.json().get("message")
        except Exception:
            msg = str(exc)
        return jsonify({"out": "", "err": f"Execution service error: {msg}"}), 502
    except requests.exceptions.RequestException as exc:
        return jsonify({"out": "", "err": f"Execution service network error: {exc}"}), 502
    except Exception as exc:
        return jsonify({"out": "", "err": f"Server error: {exc}"}), 500


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def unique_name_for_room(room: str, base: str) -> str:
    """Ensure display names are unique within a room (Alice, Alice (2), …)."""
    if base not in ROOM_MEMBERS[room]:
        return base
    index = 2
    while f"{base} ({index})" in ROOM_MEMBERS[room]:
        index += 1
    return f"{base} ({index})"


def normalize_language(lang: str):
    """Normalize language aliases to canonical ids used by the editor."""
    aliases = {
        "py": "python",
        "python": "python",
        "js": "javascript",
        "javascript": "javascript",
        "c++": "cpp",
        "cpp": "cpp",
        "java": "java",
    }
    return aliases.get((lang or "").strip().lower())


def close_room_if_empty(room: str) -> bool:
    """Drop all in-memory state for a room once the last member leaves."""
    if ROOM_MEMBERS.get(room):
        return False
    ROOM_MEMBERS.pop(room, None)
    ROOM_CODE.pop(room, None)
    ROOM_CHAT.pop(room, None)
    ROOM_LANG.pop(room, None)
    return True


# ---------------------------------------------------------------------------
# Socket.IO events
# ---------------------------------------------------------------------------


@socketio.on("connect")
def on_connect():
    emit("server:hello", {"msg": "connected"})


@socketio.on("join")
def on_join(data):
    """Join (or create) a room and hydrate the new client with room state."""
    room = (data or {}).get("roomId") or "default"
    base = (data or {}).get("name") or f"User-{request.sid[:5]}"
    name = unique_name_for_room(room, base)

    SID_TO_NAME[request.sid] = name
    SID_TO_ROOM[request.sid] = room
    ROOM_MEMBERS[room].add(name)
    ROOM_LANG.setdefault(room, "python")

    join_room(room)

    # Full snapshot for the joining client only
    emit(
        "room:state",
        {
            "roomId": room,
            "code": ROOM_CODE.get(room, ""),
            "chat": ROOM_CHAT.get(room, [])[-50:],
            "members": sorted(ROOM_MEMBERS[room]),
            "language": ROOM_LANG.get(room, "python"),
            "you": name,
        },
    )
    # Presence update for everyone in the room
    emit(
        "room:presence",
        {
            "roomId": room,
            "members": sorted(ROOM_MEMBERS[room]),
            "joined": name,
        },
        to=room,
    )


@socketio.on("name:update")
def on_name_update(data):
    """Rename the current user; server remains the source of truth."""
    new_base = (data or {}).get("name", "").strip()
    if not new_base:
        return

    sid = request.sid
    room = SID_TO_ROOM.get(sid)
    old = SID_TO_NAME.get(sid)
    if not room or not old:
        return

    ROOM_MEMBERS[room].discard(old)
    new_name = unique_name_for_room(room, new_base)
    ROOM_MEMBERS[room].add(new_name)
    SID_TO_NAME[sid] = new_name

    emit("you:renamed", {"name": new_name}, to=sid)
    emit(
        "room:presence",
        {
            "roomId": room,
            "members": sorted(ROOM_MEMBERS[room]),
            "renamed": {"from": old, "to": new_name},
        },
        to=room,
    )


@socketio.on("chat:send")
def on_chat_send(data):
    """Broadcast a chat message to everyone else in the room."""
    room = (data or {}).get("roomId") or SID_TO_ROOM.get(request.sid) or "default"
    raw_text = (data or {}).get("text", "")
    text = raw_text.strip() if isinstance(raw_text, str) else ""
    if not text:
        return

    name = SID_TO_NAME.get(request.sid, f"User-{request.sid[:5]}")
    entry = {"name": name, "text": text, "ts": time.time()}
    ROOM_CHAT[room].append(entry)
    emit("chat:recv", entry, to=room, include_self=False)


@socketio.on("code:update")
def code_update(data):
    """Persist and fan out editor changes."""
    room = (data or {}).get("roomId") or SID_TO_ROOM.get(request.sid) or "default"
    code = (data or {}).get("code", "")
    ROOM_CODE[room] = code
    emit("code:apply", {"code": code, "roomId": room}, to=room, include_self=False)


@socketio.on("lang:update")
def lang_update(data):
    """Update and broadcast the room's programming language."""
    room = (data or {}).get("roomId") or SID_TO_ROOM.get(request.sid) or "default"
    norm = normalize_language((data or {}).get("language", ""))
    if not norm:
        return
    ROOM_LANG[room] = norm
    emit("lang:apply", {"roomId": room, "language": norm}, to=room)


@socketio.on("disconnect")
def on_disconnect():
    """Remove the user from room presence when their socket drops."""
    sid = request.sid
    name = SID_TO_NAME.pop(sid, None)
    room = SID_TO_ROOM.pop(sid, None)
    if not room or not name:
        return

    ROOM_MEMBERS[room].discard(name)
    closed = close_room_if_empty(room)
    emit(
        "room:presence",
        {
            "roomId": room,
            "members": [] if closed else sorted(ROOM_MEMBERS[room]),
            "left": name,
            "closed": closed,
        },
        to=room,
    )


# ---------------------------------------------------------------------------
# Serve the React SPA in production (same origin as Socket.IO)
# ---------------------------------------------------------------------------


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path: str):
    """Serve built assets, falling back to index.html for client-side routes."""
    if not STATIC_DIR.is_dir():
        return (
            "Backend is running. Build the frontend (`cd Frontend && npm run build`) "
            "to serve the UI from this process, or run the Vite dev server separately.",
            200,
        )

    candidate = STATIC_DIR / path
    if path and candidate.is_file():
        return send_from_directory(STATIC_DIR, path)
    return send_from_directory(STATIC_DIR, "index.html")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    socketio.run(app, host="0.0.0.0", port=port, debug=True, use_reloader=False)
