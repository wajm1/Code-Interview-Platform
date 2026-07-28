# Frontend (Vite + React)

Development UI for the Code Interview Platform.

```bash
npm install
npm run dev          # http://127.0.0.1:5173 → backend at :5050
VITE_BASE=/ npm run build   # production assets → dist/ (served by Flask)
```

Useful env vars:

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Backend origin (default `http://localhost:5050` in dev) |
| `VITE_BASE` | Vite public base path (`/` locally; `/RepoName/` on GitHub Pages) |
| `VITE_DEMO` | `true` = offline BroadcastChannel demo (no Flask) |

See the root [README](../README.md) for full-stack setup and deployment.
