from __future__ import annotations

"""Seed Trace with the original SIH criminal-network dataset.

This replaces the newer toy `build_sample_cases(100)` seed with the original
258-person graph, while preserving the current PostgreSQL/RAG infrastructure.

Flow:
    generate_mock_data -> load_to_neo4j -> run_analytics
                         -> PostgreSQL case/document seed
"""

import csv
import os
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb
from neo4j import GraphDatabase

from services.vector_store import VectorStore

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "output_v2"


def wait_for_postgres(url: str) -> None:
    for attempt in range(30):
        try:
            with psycopg.connect(url):
                return
        except psycopg.OperationalError:
            if attempt == 29:
                raise
            time.sleep(2)


def wait_for_neo4j(uri: str, user: str, password: str) -> None:
    for attempt in range(30):
        try:
            driver = GraphDatabase.driver(uri, auth=(user, password))
            driver.verify_connectivity()
            driver.close()
            return
        except Exception:
            if attempt == 29:
                raise
            time.sleep(2)


def clear_neo4j(uri: str, user: str, password: str) -> None:
    """Remove the previous toy/demo graph before restoring the real dataset."""
    driver = GraphDatabase.driver(uri, auth=(user, password))
    try:
        with driver.session() as session:
            session.run("MATCH (n) DETACH DELETE n").consume()
    finally:
        driver.close()


def generate_dataset() -> None:
    """Generate the deterministic original CSV dataset into /app/output_v2."""
    if DATA_DIR.exists():
        shutil.rmtree(DATA_DIR)

    # The generator intentionally executes its generation at module level.
    module_path = ROOT / "data_pipeline" / "generate_mock_data.py"
    namespace = {"__name__": "__main__"}
    exec(compile(module_path.read_text(encoding="utf-8"), str(module_path), "exec"), namespace)


def load_neo4j() -> None:
    from data_pipeline import load_to_neo4j

    load_to_neo4j.main()


def run_analytics() -> None:
    from data_pipeline import run_analytics

    run_analytics.main()


def read_csv(name: str) -> list[dict[str, str]]:
    with (DATA_DIR / name).open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def seed_postgres(database_url: str) -> None:
    cases = read_csv("cases.csv")
    evidence = read_csv("evidence.csv")

    evidence_by_case: dict[str, list[dict[str, str]]] = {}
    for item in evidence:
        evidence_by_case.setdefault(item["case_id"], []).append(item)

    vector_store = VectorStore()
    vector_store.initialize()

    with psycopg.connect(database_url) as connection:
        # The current app expects this richer case table.
        connection.execute("DROP TABLE IF EXISTS cases CASCADE")
        connection.execute(
            """
            CREATE TABLE cases (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                case_number TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL,
                status TEXT NOT NULL,
                priority TEXT NOT NULL,
                lead TEXT NOT NULL,
                created_at DATE NOT NULL,
                event_date DATE NOT NULL,
                narratives JSONB NOT NULL DEFAULT '[]'::jsonb,
                lead_details JSONB NOT NULL DEFAULT '[]'::jsonb,
                evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
                documents JSONB NOT NULL DEFAULT '[]'::jsonb
            )
            """
        )

        for case in cases:
            case_evidence = evidence_by_case.get(case["id"], [])
            timestamps = [item["timestamp"][:10] for item in case_evidence if item.get("timestamp")]
            event_date = min(timestamps) if timestamps else case["created_at"][:10]

            # Keep the Postgres case representation compact; the full evidence
            # remains in Neo4j and is fetched through the evidence endpoints.
            evidence_preview = [
                {
                    "id": item["id"],
                    "type": item["evidence_type"],
                    "date": item["timestamp"][:10],
                    "description": item["description"],
                    "source_record_id": item["source_record_id"],
                }
                for item in case_evidence[:50]
            ]

            narrative = {
                "title": "Synthetic investigation dataset",
                "date": event_date,
                "text": (
                    f"{case['title']} is a synthetic criminal-network investigation "
                    "containing linked people, communications, transactions, events, "
                    "and evidence for investigator analysis."
                ),
            }

            lead = "District Intelligence Unit"
            priority = "High" if case["id"] == "case_00000" else "Medium"
            document = (
                f"{case['title']} ({case['case_number']}) — {case['case_type']}. "
                f"Agency: {case['agency']}. Status: {case['status']}. "
                "This is synthetic demonstration data for the Trace investigation platform."
            )

            connection.execute(
                """
                INSERT INTO cases
                    (id, name, case_number, description, status, priority, lead,
                     created_at, event_date, narratives, lead_details, evidence, documents)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    case["id"],
                    case["title"],
                    case["case_number"],
                    f"{case['case_type']} investigation handled by {case['agency']}.",
                    case["status"],
                    priority,
                    lead,
                    case["created_at"][:10],
                    event_date,
                    Jsonb([narrative]),
                    Jsonb([{"name": lead, "unit": case["agency"], "role": "Case Lead"}]),
                    Jsonb(evidence_preview),
                    Jsonb([]),
                ),
            )
        connection.commit()

    # Replace stale vector documents from the toy dataset.
    with psycopg.connect(database_url) as connection:
        connection.execute("DELETE FROM case_documents")
        connection.commit()

    # Add a compact, useful RAG corpus: case summary + evidence records.
    # Full evidence remains in Neo4j, so RAG does not need to duplicate all 7k+
    # records into the case JSON stored by PostgreSQL.
    for case in cases:
        case_id = case["id"]
        case_evidence = evidence_by_case.get(case_id, [])
        docs = [
            {
                "title": case["title"],
                "content": (
                    f"Case {case['case_number']}: {case['title']}. "
                    f"Agency: {case['agency']}. Type: {case['case_type']}. "
                    f"Status: {case['status']}. Synthetic investigation dataset."
                ),
                "event_date": case["created_at"][:10],
                "source_type": "synthetic-case",
            }
        ]
        docs.extend(
            {
                "title": item["evidence_type"],
                "content": item["description"],
                "event_date": item["timestamp"][:10],
                "source_type": "evidence",
            }
            for item in case_evidence
        )
        vector_store.add_documents(case_id, docs)


def main() -> None:
    database_url = os.getenv("DATABASE_URL", "postgresql://trace:trace@postgres:5432/trace")
    neo4j_uri = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
    neo4j_user = os.getenv("NEO4J_USERNAME", "neo4j")
    neo4j_password = os.getenv("NEO4J_PASSWORD", "tracepassword")

    wait_for_postgres(database_url)
    wait_for_neo4j(neo4j_uri, neo4j_user, neo4j_password)

    print("\n=== TRACE ORIGINAL DATASET SEED ===")
    print("1/4 Generating original deterministic dataset...")
    generate_dataset()

    print("2/4 Resetting and loading Neo4j graph...")
    clear_neo4j(neo4j_uri, neo4j_user, neo4j_password)
    load_neo4j()

    print("3/4 Running graph analytics...")
    run_analytics()

    print("4/4 Seeding current PostgreSQL/RAG case layer...")
    seed_postgres(database_url)

    print("\n=== SEED COMPLETE ===")
    print("Original dataset restored: 258 people, 3 cases, full graph + analytics.")


if __name__ == "__main__":
    main()
