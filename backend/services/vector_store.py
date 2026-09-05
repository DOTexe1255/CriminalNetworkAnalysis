"""PostgreSQL + pgvector storage for case documents and evidence."""

from __future__ import annotations

import hashlib
import math
import os
from datetime import date, datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb


class VectorStore:
    def __init__(self) -> None:
        self.database_url = os.getenv("DATABASE_URL", "postgresql://trace:trace@postgres:5432/trace")
        self.embedding_model_name = os.getenv(
            "EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
        )
        self._embeddings = None

    def _get_embeddings(self):
        if self._embeddings is None:
            try:
                from langchain_huggingface import HuggingFaceEndpointEmbeddings

                token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN")
                self._embeddings = (
                    HuggingFaceEndpointEmbeddings(
                        model=self.embedding_model_name,
                        huggingfacehub_api_token=token,
                    )
                    if token and os.getenv("USE_HF_EMBEDDINGS", "false").lower() == "true"
                    else None
                )
            except (ImportError, RuntimeError):
                self._embeddings = None
        return self._embeddings

    @staticmethod
    def _fallback_embedding(text: str) -> list[float]:
        values = [0.0] * 384
        for token in text.lower().split():
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % 384
            values[index] += 1.0 if digest[4] % 2 else -1.0
        norm = math.sqrt(sum(value * value for value in values)) or 1.0
        return [value / norm for value in values]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        embeddings = self._get_embeddings()
        if embeddings is not None:
            try:
                return embeddings.embed_documents(texts)
            except Exception as error:
                print(f"HF embeddings unavailable, using local fallback: {error}")
        return [self._fallback_embedding(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        embeddings = self._get_embeddings()
        if embeddings is not None:
            try:
                return embeddings.embed_query(text)
            except Exception as error:
                print(f"HF query embedding unavailable, using local fallback: {error}")
        return self._fallback_embedding(text)

    def initialize(self) -> None:
        with psycopg.connect(self.database_url) as connection:
            connection.execute("CREATE EXTENSION IF NOT EXISTS vector")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS case_documents (
                    id BIGSERIAL PRIMARY KEY,
                    case_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    source_type TEXT NOT NULL DEFAULT 'case-note',
                    event_date DATE,
                    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                    embedding vector(384),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS case_documents_case_id_idx ON case_documents(case_id)"
            )
            connection.commit()

    def add_documents(self, case_id: str, documents: list[dict[str, Any]]) -> int:
        if not documents:
            return 0
        texts = [str(item.get("content") or item.get("description") or "").strip() for item in documents]
        valid = [(item, text) for item, text in zip(documents, texts) if text]
        if not valid:
            return 0
        vectors = self.embed_documents([text for _, text in valid])
        with psycopg.connect(self.database_url) as connection:
            for (item, text), vector in zip(valid, vectors):
                event_date = item.get("event_date") or item.get("date")
                if isinstance(event_date, datetime):
                    event_date = event_date.date()
                if isinstance(event_date, str):
                    try:
                        event_date = date.fromisoformat(event_date[:10])
                    except ValueError:
                        event_date = None
                connection.execute(
                    """
                    INSERT INTO case_documents
                        (case_id, title, content, source_type, event_date, metadata, embedding)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::vector)
                    """,
                    (
                        case_id,
                        str(item.get("title") or item.get("name") or "Case evidence"),
                        text,
                        str(item.get("source_type") or item.get("type") or "case-note"),
                        event_date,
                        Jsonb(item),
                        "[" + ",".join(str(value) for value in vector) + "]",
                    ),
                )
            connection.commit()
        return len(valid)

    def delete_case_documents(self, case_id: str) -> None:
        with psycopg.connect(self.database_url) as connection:
            connection.execute("DELETE FROM case_documents WHERE case_id = %s", (case_id,))
            connection.commit()

    def similarity_search(self, case_id: str, query: str, limit: int = 5) -> list[dict[str, Any]]:
        vector = self.embed_query(query)
        with psycopg.connect(self.database_url) as connection:
            rows = connection.execute(
                """
                SELECT title, content, source_type, event_date, metadata,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM case_documents
                WHERE case_id = %s AND embedding IS NOT NULL
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                ("[" + ",".join(str(value) for value in vector) + "]", case_id,
                 "[" + ",".join(str(value) for value in vector) + "]", limit),
            ).fetchall()
        return [
            {
                "title": row[0], "content": row[1], "source_type": row[2],
                "event_date": row[3].isoformat() if row[3] else None,
                "metadata": row[4], "similarity": float(row[5] or 0),
            }
            for row in rows
        ]
