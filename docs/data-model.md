# Data Model

## Neo4j graph

Primary labels include `Person`, `Phone`, `BankAccount`, `Vehicle`, `Device`, `Organization`, `Location`, `Event`, `Case`, `Evidence`, and `Finding`.

Important relationships:

- `Person-[:OWNS]->Phone|Vehicle`
- `Person-[:HOLDS]->BankAccount`
- `Person-[:USES]->Device`
- `Person-[:WORKS_AT]->Organization`
- `Person-[:PARTICIPATED_IN]->Event-[:OCCURS_AT]->Location`
- `Phone-[:COMMUNICATED]->Phone`
- `BankAccount-[:TRANSACTED]->BankAccount`
- `Case-[:ASSOCIATED_WITH]->Person`
- `Case-[:HAS_EVIDENCE]->Evidence-[:INVOLVES]->Person`
- `Finding-[:ABOUT]->Person`
- `Finding-[:SUPPORTED_BY]->Evidence`
- `Case-[:HAS_FINDING]->Finding`

## PostgreSQL

The seed creates a `cases` table for the case catalog and the vector service creates `case_documents`:

- `case_id`, `title`, `content`, and `source_type` identify searchable material.
- `event_date` preserves dates for retrieval and display.
- `metadata` stores source-specific JSONB data.
- `embedding vector(384)` supports cosine similarity search.

The seed is safe to rerun: case rows use conflict handling and document rows are replaced per case before indexing.
