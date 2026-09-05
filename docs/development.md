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

## Before a pull request

- Keep service-specific code in its backend folder.
- Add or update the relevant document in `docs` when a contract changes.
- Do not commit `.env` files, API tokens, generated database files, or large build output.
- Validate Compose with `docker compose config --quiet`.
- Test case-scoped RAG so a question cannot retrieve another case's documents.
- Treat graph findings as evidence-backed observations, not criminality predictions.
