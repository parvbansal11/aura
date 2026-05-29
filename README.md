# A.U.R.A — Web Frontend (PWA)

Offline-first Progressive Web App for Anganwadi frontline workers. Voice-first,
no password, works in tribal dialects, updates 17 ICDS registers from one
sentence. This folder is the complete installable frontend; the backend lives
in `../db` and `../ml_pipeline`.

## Files

| File | Purpose |
|---|---|
| `index.html` | The full UI — all 13 screens, Hindi/English toggle, navigation, loading states |
| `aura-api.js` | **The only file you edit to wire the backend.** All API sockets + local DB + mock data |
| `sw.js` | Service worker — offline cache, background sync stub, push-notification stub |
| `manifest.json` | PWA manifest (installable, standalone, app shortcuts) |
| `icon.svg` | App icon |
| `API_CONTRACT.md` | Maps every frontend socket to the real backend function |

## Run locally

It is a PWA, so it must be served over http(s), not opened as a file (service
workers and the manifest will not load from `file://`).

```bash
cd web
npx serve .          # or:  python3 -m http.server 8080
```

Open the served URL on your phone or desktop. It works fully offline after the
first load, and Chrome will offer to install it.

## Wire the backend

Open `aura-api.js`. Every function has a comment naming the exact backend
function, file, and integration style. Replace each mock return with the real
call. See `API_CONTRACT.md` for the full table and the recommended order.

Three engines already run client-side (`vision_engine`, `clinical_engine`,
`ml_inference`). The `db/` and `education_engine` calls need a small Node
endpoint — the service worker already lets `/api/*` bypass the cache and
`aura-api.js` is pre-shaped for `fetch('/api/...')`.

## Status

UI: complete and verified. Backend sockets: mocked, mapped, ready to connect.
Not yet built: ASR, SARR routing, language detection, Aadhaar OCR, Poshan
Tracker sync (screens and sockets exist and are waiting).
