from __future__ import annotations

"""Rebuild Trace's pgvector evidence index from the existing Neo4j graph.

This script is intentionally NON-DESTRUCTIVE to Neo4j and the PostgreSQL
`cases` table. It only rebuilds rows in `case_documents`.

Run from the backend container:
    python -m seed.reindex_rag

Or from the project root:
    docker compose run --rm seed python -m seed.reindex_rag
"""

import os
import time
from typing import Any

import psycopg
from neo4j import GraphDatabase

from services.vector_store import VectorStore


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://trace:trace@postgres:5432/trace",
)
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USER = os.getenv("NEO4J_USERNAME", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "tracepassword")


def wait_for_services() -> None:
    for attempt in range(30):
        try:
            with psycopg.connect(DATABASE_URL):
                break
        except psycopg.OperationalError:
            if attempt == 29:
                raise
            time.sleep(2)

    for attempt in range(30):
        driver = GraphDatabase.driver(
            NEO4J_URI,
            auth=(NEO4J_USER, NEO4J_PASSWORD),
        )
        try:
            driver.verify_connectivity()
            return
        except Exception:
            if attempt == 29:
                raise
            time.sleep(2)
        finally:
            driver.close()


def fetch_case_evidence() -> dict[str, list[dict[str, Any]]]:
    """Read the existing evidence graph and build rich searchable documents."""
    driver = GraphDatabase.driver(
        NEO4J_URI,
        auth=(NEO4J_USER, NEO4J_PASSWORD),
    )

    try:
        with driver.session() as session:
            rows = session.run(
                """
                MATCH (c:Case)-[:HAS_EVIDENCE]->(ev:Evidence)
                OPTIONAL MATCH (ev)-[:INVOLVES]->(p:Person)
                WITH c, ev,
                     collect(DISTINCT {
                         id: p.id,
                         name: coalesce(p.full_name, p.name, p.id)
                     }) AS people
                RETURN
                    c.id AS case_id,
                    c.name AS case_name,
                    c.title AS case_title,
                    c.case_number AS case_number,
                    ev.id AS evidence_id,
                    ev.evidence_type AS evidence_type,
                    ev.source_record_id AS source_record_id,
                    toString(ev.timestamp) AS timestamp,
                    ev.description AS description,
                    people
                ORDER BY c.id, ev.timestamp
                """
            )

            grouped: dict[str, list[dict[str, Any]]] = {}

            for row in rows:
                record = dict(row)
                people = [
                    person
                    for person in (record.get("people") or [])
                    if person.get("id")
                ]

                names = ", ".join(
                    f"{person.get('name')} ({person.get('id')})"
                    for person in people
                )

                evidence_type = record.get("evidence_type") or "Evidence"
                date = (record.get("timestamp") or "")[:10] or "Undated"
                description = (record.get("description") or "").strip()

                # This is the text the embedding model actually sees.
                # Include structured context, not just the original description.
                content_parts = [
                    f"Evidence type: {evidence_type}",
                    f"Recorded date: {date}",
                    f"Source record: {record.get('source_record_id') or 'Unknown'}",
                ]

                if record.get("case_name") or record.get("case_title"):
                    content_parts.append(
                        f"Investigation: {record.get('case_name') or record.get('case_title')}"
                    )

                if names:
                    content_parts.append(f"Involved people: {names}")

                if description:
                    content_parts.append(f"Recorded fact: {description}")

                content = "\n".join(content_parts)

                grouped.setdefault(record["case_id"], []).append(
                    {
                        "title": evidence_type,
                        "content": content,
                        "event_date": date,
                        "source_type": "evidence",
                        "metadata": {
                            "evidence_id": record.get("evidence_id"),
                            "evidence_type": evidence_type,
                            "source_record_id": record.get("source_record_id"),
                            "case_id": record.get("case_id"),
                            "case_name": record.get("case_name")
                            or record.get("case_title"),
                            "case_number": record.get("case_number"),
                            "people": people,
                        },
                    }
                )

            return grouped
    finally:
        driver.close()


def fetch_case_documents() -> dict[str, dict[str, Any]]:
    """Read case metadata so each case gets one searchable overview document."""
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            """
            SELECT id, name, case_number, description, status, priority, lead,
                   event_date
            FROM cases
            ORDER BY id
            """
        ).fetchall()

    return {
        row[0]: {
            "title": row[1],
            "case_number": row[2],
            "description": row[3],
            "status": row[4],
            "priority": row[5],
            "lead": row[6],
            "event_date": row[7].isoformat() if row[7] else None,
        }
        for row in rows
    }


def main() -> None:
    print("=== TRACE RAG REINDEX ===")
    print("This will rebuild pgvector documents only.")
    print("Neo4j graph and PostgreSQL cases will NOT be modified.\n")

    wait_for_services()

    vector_store = VectorStore()
    vector_store.initialize()

    cases = fetch_case_documents()
    evidence_by_case = fetch_case_evidence()

    if not cases:
        raise RuntimeError("No rows found in PostgreSQL `cases`.")

    if not evidence_by_case:
        raise RuntimeError("No Case -> Evidence records found in Neo4j.")

    # Remove only the stale searchable corpus.
    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("DELETE FROM case_documents")
        connection.commit()

    total = 0

    for case_id, case in cases.items():
        documents: list[dict[str, Any]] = [
            {
                "title": f"{case['title']} — Case Overview",
                "content": (
                    f"Investigation: {case['title']}\n"
                    f"Case number: {case['case_number']}\n"
                    f"Status: {case['status']}\n"
                    f"Priority: {case['priority']}\n"
                    f"Lead: {case['lead']}\n"
                    f"Recorded case date: {case['event_date'] or 'Undated'}\n"
                    f"Description: {case['description']}"
                ),
                "event_date": case["event_date"],
                "source_type": "case-overview",
            }
        ]

        documents.extend(evidence_by_case.get(case_id, []))

        indexed = vector_store.add_documents(case_id, documents)
        total += indexed

        print(
            f"  {case_id}: indexed {indexed} documents "
            f"({len(evidence_by_case.get(case_id, []))} evidence records)"
        )

    print("\n=== REINDEX COMPLETE ===")
    print(f"Cases indexed: {len(cases)}")
    print(f"Documents indexed: {total}")
    print("Neo4j was not modified.")


if __name__ == "__main__":
    main()
