# Deployment

## Docker Compose

From the repository root:

```powershell
docker compose up --build
```

Stop services without deleting persistent data:

```powershell
docker compose down
```

Delete development database volumes only when a full reseed is intended:

```powershell
docker compose down -v
```

Persistent volumes:

- `trace_postgres_data`
- `trace_neo4j_data`
- `trace_neo4j_logs`

The frontend is served by Nginx on port `5173`; the API is exposed on `8000`; Neo4j Browser and Bolt use `7474` and `7687`.

## Secrets

Use `backend/.env` locally. Do not commit it. The Hugging Face token is read by the API container and never embedded into the frontend bundle.

## Health checks

PostgreSQL uses `pg_isready`. Neo4j uses its HTTP endpoint. The seed service blocks until both are reachable, which prevents the API from starting against an empty database.
