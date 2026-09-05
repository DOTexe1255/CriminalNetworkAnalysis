# Trace Backend

The backend contains the FastAPI API, Neo4j integration, PostgreSQL/pgvector storage, RAG services, seed process, and graph data pipeline.

## Folders

- `api/app.py`: FastAPI application.
- `api/main.py`: container-facing import entrypoint.
- `services/vector_store.py`: PostgreSQL + pgvector schema, embeddings, and similarity search.
- `services/rag_service.py`: LangChain retrieval and Hugging Face generation.
- `seed/seed_database.py`: waits for databases and inserts 100 synthetic cases.
- `data_pipeline/`: CSV generation, Neo4j loading, analytics, and profile enrichment.
- `mock_cases.json`: fallback case store for local development.

## Environment

Copy `.env.example` to `.env`. The Docker Compose API and seed services load `backend/.env`. Keep credentials and tokens out of Git.

Important variables:

- `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`
- `DATABASE_URL`
- `HF_TOKEN`, `HF_MODEL`
- `USE_HF_EMBEDDINGS` to opt into hosted Hugging Face embeddings; local deterministic vectors are the default for reliable seeding.

## Local API

From the repository root:

```powershell
uvicorn backend.api.app:app --reload --port 8000
```

The API expects Neo4j and PostgreSQL to be available. For the complete environment, use Docker Compose from the root.

## Pipeline commands

```powershell
python backend/data_pipeline/generate_mock_data.py
python backend/data_pipeline/load_to_neo4j.py
python backend/data_pipeline/run_analytics.py
python backend/data_pipeline/enrich_person_profiles.py
```

The pipeline scripts use the environment loaded from `backend/.env` and write generated CSVs to their configured output directory.
