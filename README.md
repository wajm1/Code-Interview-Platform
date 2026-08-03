# Code Interview Platform

Real-time, multi-user web app for mock technical interviews: shared Monaco editor, live chat, presence, and multi-language code execution.

**[Live site](https://wajm1.github.io/Code-Interview-Platform/)** — landing page for your resume; use **Try the live demo**, then **Copy Invite Link** and open it on another phone/laptop to collaborate.


## Features

- Real-time collaborative code editor (Monaco)
- Live chat and room presence
- Room-based sessions with invite links (`?room=my-room`)
- Display names with live rename
- Run Python in-browser (Pyodide) and JavaScript in-browser; C++ / Java via a configured execution backend when available
- GitHub Pages multi-device demo (WebRTC peer sync via Trystero); full Socket.IO stack for local / Docker deploys
## Tech stack

| Layer | Tools |
| --- | --- |
| Frontend | React, Vite, Monaco Editor, Socket.IO client |
| Backend | Python, Flask, Flask-SocketIO, eventlet |
| Execution | Pyodide (Python), Piston API (other languages) |

## Quick start (local)

### Requirements

- Python 3.10+
- Node.js 20+
- npm

### 1. Backend

```bash
cd Backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Backend listens on [http://127.0.0.1:5050](http://127.0.0.1:5050).

### 2. Frontend

```bash
cd Frontend
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Optional query params: `?room=interview-1&name=Waj`.

### Production-style (one process)

```bash
cd Frontend && npm install && VITE_BASE=/ npm run build && cd ..
cd Backend && source .venv/bin/activate && python app.py
```

Then open [http://127.0.0.1:5050](http://127.0.0.1:5050) — Flask serves the built UI and WebSockets on the same origin.

## Live demo on GitHub

Pushing to `main` runs [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml), which builds the frontend in **demo mode** and deploys it to **GitHub Pages**.

1. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. Push to `main` (or run the workflow manually)
3. Visit `https://<user>.github.io/Code-Interview-Platform/`

Demo mode syncs editor, chat, and presence across tabs in the same browser (no backend). Use a full-stack host for true multi-device sessions.

### Optional: full-stack host (Render)

[`render.yaml`](render.yaml) + [`Dockerfile`](Dockerfile) deploy the Flask app with the built UI:

1. [Render](https://render.com) → New → Blueprint → select this repo
2. After deploy, set repo variable `VITE_API_URL` to your Render URL and `VITE_DEMO` behavior by clearing demo (workflow sets `VITE_DEMO=false` when `VITE_API_URL` is set)
3. Re-run the Pages workflow so the GitHub demo talks to your live backend

## Project layout

```
Backend/app.py          # Flask + Socket.IO + Piston proxy + static hosting
Frontend/src/App.jsx    # Shell UI: presence, chat, run console
Frontend/src/Editor.jsx # Monaco + code sync
Frontend/src/demoSocket.js  # Offline demo transport for GitHub Pages
Frontend/src/config.js  # API base URL helper
```

## Socket events (summary)

| Event | Direction | Purpose |
| --- | --- | --- |
| `join` | client → server | Enter a room with a display name |
| `room:state` | server → joiner | Hydrate code, chat, members, language |
| `room:presence` | server → room | Member join / leave / rename |
| `code:update` / `code:apply` | both | Sync editor text |
| `chat:send` / `chat:recv` | both | Chat messages |
| `lang:update` / `lang:apply` | both | Shared language |
| `name:update` / `you:renamed` | both | Rename flow |

## License

MIT
