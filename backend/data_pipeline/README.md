# Data pipeline

Place mock-data generation, Neo4j loading, profile enrichment, and graph analytics scripts in this directory. They share the API container's backend requirements and `.env` configuration.

The current scripts at the repository root are retained during migration so existing local commands keep working; new container-facing code belongs under this service boundary.
