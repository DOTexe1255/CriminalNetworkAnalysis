# Development Workflow

## Backend

```powershell
$files = Get-ChildItem backend -Recurse -Filter *.py | ForEach-Object { $_.FullName }
python -m py_compile $files
```

## Frontend

```powershell
npm --prefix frontend install
npm --prefix frontend run build
npm --prefix frontend run lint
```

Run the frontend on the local network while using the Docker API:

```powershell
$env:VITE_DEV_API_TARGET="http://localhost:9000"
npm --prefix frontend run dev -- --host 0.0.0.0
```

The app keeps `VITE_API_BASE_URL=/api`; Vite proxies that path to `VITE_DEV_API_TARGET`, which avoids exposing a machine-specific localhost URL to LAN browsers.

## Before a pull request

- Keep service-specific code in its backend folder.
- Add or update the relevant document in `docs` when a contract changes.
- Do not commit `.env` files, API tokens, generated database files, or large build output.
- Validate Compose with `docker compose config --quiet`.
- Test the app from another LAN device using `http://<HOST-IP>:5173`.
- Test case-scoped RAG so a question cannot retrieve another case's documents.
- Test upload, metadata, and download through `/api/cases/{case_id}/documents` and `/api/cases/{case_id}/files/{file_path}`.
- Treat graph findings as evidence-backed observations, not criminality predictions.
