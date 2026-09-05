# Trace Frontend

The frontend is a React 19 and TypeScript investigation console built with Vite. It provides the case register, network graph, entity profiles, findings, evidence timeline, map view, and case-scoped RAG query controls.

## Local development

```powershell
npm install
npm run dev
```

The local API is configured in `frontend/.env` with `http://localhost:8000`. Copy `frontend/.env.example` when setting up a fresh checkout. For Docker, Vite is built with `/api`; the frontend normalizes that proxy prefix and Nginx forwards requests to the API container.

## Validation

```powershell
npm run build
npm run lint
```

See the root [README.md](../README.md) and [docs/architecture.md](../docs/architecture.md) for the UI structure and integration contract.
