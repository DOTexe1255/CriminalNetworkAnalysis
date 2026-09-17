# Trace Frontend

The frontend is a React 19 and TypeScript investigation console built with Vite. It provides the case register, network graph, entity profiles, findings, evidence timeline, map view, and case-scoped RAG query controls.

## Local development

```powershell
npm install
$env:VITE_DEV_API_TARGET="http://localhost:9000"
npm run dev -- --host 0.0.0.0
```

Vite listens on all interfaces at port `5173` and proxies `/api` to `VITE_DEV_API_TARGET`. From another device on the same LAN, open `http://<HOST-IP>:5173`. In Docker, Nginx provides the same `/api` proxy and the API is published at `http://localhost:9000`.

## Validation

```powershell
npm run build
npm run lint
```

See the root [README.md](../README.md) and [docs/architecture.md](../docs/architecture.md) for the UI structure and integration contract.
