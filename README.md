# Trace: Criminal Network Intelligence

Trace is an investigation workspace for exploring case-linked entities, relationships, evidence, graph findings, and dated case material. It combines a React frontend, FastAPI API, Neo4j graph data, PostgreSQL with pgvector, and LangChain RAG over Hugging Face.

## Start the full stack on Docker and LAN

1. Copy `backend/.env.example` to `backend/.env` and configure the local secrets.
2. Start the services:

```powershell
docker compose up -d --build
docker compose ps
```

3. Open the application at `http://localhost:5173`. From another device on the same LAN, use `http://<HOST-IP>:5173` where `<HOST-IP>` comes from `ipconfig`.

Useful endpoints:

- Frontend: `http://localhost:5173`
- API docs: `http://localhost:9000/docs`
- Neo4j Browser: `http://localhost:7474`
- Local case storage: `http://localhost:9002`

The `seed` service generates synthetic cases in PostgreSQL and Neo4j before the API starts. Case uploads persist in the `trace_storage_data` Docker volume; a few synthetic demo files are seeded for `case_00000`.

## Frontend development on LAN

With the Docker API and databases running:

```powershell
npm --prefix frontend install
$env:VITE_DEV_API_TARGET="http://localhost:9000"
npm --prefix frontend run dev -- --host 0.0.0.0
```

Vite listens on all interfaces and proxies `/api` to the backend. Keep `VITE_API_BASE_URL=/api` so LAN browsers use the same-origin proxy.

## Repository layout

- `backend/api`: FastAPI application and legacy API entrypoint.
- `backend/services`: vector storage, RAG, and local object-storage services.
- `backend/seed`: synthetic data generator and database seed process.
- `backend/data_pipeline`: CSV generation, Neo4j loading, analytics, and profile enrichment.
- `frontend`: React investigation console.
- `docs`: architecture, API, data model, RAG, deployment, and development documentation.

## Documentation

- [Backend README](backend/README.md)
- [Frontend README](frontend/README.md)
- [Architecture](docs/architecture.md)
- [API contract](docs/api.md)
- [Data model](docs/data-model.md)
- [RAG and vector search](docs/rag.md)
- [Deployment](docs/deployment.md)
- [Development workflow](docs/development.md)

Synthetic records are for development and demonstrations only. Investigation findings are structural observations and must not be treated as conclusions of guilt.
