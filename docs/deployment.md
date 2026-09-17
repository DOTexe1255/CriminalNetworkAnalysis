# Deployment

## Docker Compose

From the repository root:

```powershell
docker compose up -d --build
docker compose ps
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
- `trace_storage_data`

Uploaded case files are stored in the shared storage volume and downloaded through `/api/cases/{case_id}/files/{file_path}`. This simple local storage service is intended for development; replace it with managed object storage for production.

The frontend is served by Nginx on port `5173`; the API is exposed on host port `9000` and container port `8000`; Neo4j Browser and Bolt use `7474` and `7687`. Local case storage uses host port `9002`.

### LAN access

Docker publishes the frontend and API on all host interfaces. Find the host address with `ipconfig`, then use:

```text
http://<HOST-IP>:5173       # investigator console
http://<HOST-IP>:9000/docs  # API documentation
```

Allow inbound TCP ports `5173` and `9000` in Windows Firewall when another LAN device cannot connect. The frontend uses the same-origin `/api` proxy, so no machine-specific localhost URL is sent to browsers.

### Local frontend development

Vite is configured with `host: 0.0.0.0` and a configurable `/api` proxy:

```powershell
$env:VITE_DEV_API_TARGET="http://localhost:9000"
npm --prefix frontend run dev -- --host 0.0.0.0
```

For a backend started directly with Uvicorn on port `8000`, set `VITE_DEV_API_TARGET=http://localhost:8000` instead.

## Secrets

Use `backend/.env` locally. Do not commit it. The Hugging Face token is read by the API container and never embedded into the frontend bundle.

## Health checks

PostgreSQL uses `pg_isready`, Neo4j uses its HTTP endpoint, and the storage container uses an HTTP health check. The seed service waits for PostgreSQL, Neo4j, and storage before the API starts.
