# API Contract

Base URL in Docker and Vite development: `/api` through the frontend proxy. The Docker API is also published directly at `http://localhost:9000/api`; a directly started Uvicorn server uses `http://localhost:8000/api`.

## Case routes

- `GET /cases`: returns the PostgreSQL case catalog enriched with Neo4j person and finding counts.
- `POST /cases`: creates a case in the fallback store and PostgreSQL.
- `GET /case/{case_id}`: returns one case.
- `POST /cases/{case_id}/documents`: stores multiple uploaded files in persistent local case storage, returns file metadata/URLs, and indexes uploaded PDF text.
- `GET /cases/{case_id}/files/{file_path}`: downloads a stored case file.
- `GET /case/{case_id}/summary`: generates a dated case summary through RAG.
- `POST /rag/query`: accepts `{ "case_id": "...", "question": "..." }` and returns an answer plus retrieved sources.

## Graph and entity routes

- `GET /graph?limit=150&case_id=...`
- `GET /entity-graph?person_id=...&hop=1|2&case_id=...`
- `GET /person/{person_id}`
- `GET /person/{person_id}/evidence`
- `GET /person/{person_id}/activity`
- `GET /person/{person_id}/connections`
- `GET /top-connectors?by=betweenness|degree&count=10`

## Findings and evidence routes

- `GET /case/{case_id}/findings`
- `GET /finding/{finding_id}`
- `GET /finding/{finding_id}/evidence`

Interactive OpenAPI documentation is available at `/docs`.
