# Trace: Criminal Network Intelligence

Trace is an investigation workspace for exploring case-linked entities, relationships, evidence, graph findings, and dated case material. It combines a React frontend, FastAPI API, Neo4j graph data, PostgreSQL with pgvector, and LangChain RAG over Hugging Face.

## Start the full stack

1. Copy `backend/.env.example` to `backend/.env` and configure the local secrets.
2. Start the services:

```powershell
docker compose up --build
```

3. Open the application at `http://localhost:5173`.

Useful endpoints:

- Frontend: `http://localhost:5173`
- API docs: `http://localhost:8000/docs`
- Neo4j Browser: `http://localhost:7474`

The `seed` service inserts 100 synthetic cases into PostgreSQL and Neo4j before the API starts. The seed is repeatable and preserves existing records.

## Repository layout

- `backend/api`: FastAPI application and legacy API entrypoint.
- `backend/services`: vector storage and LangChain RAG services.
- `backend/seed`: 100-case synthetic data generator and database seed process.
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
