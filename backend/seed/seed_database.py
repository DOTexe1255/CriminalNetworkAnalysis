from __future__ import annotations

import os
import time

import psycopg
from psycopg.types.json import Jsonb
from neo4j import GraphDatabase

from services.vector_store import VectorStore
from seed.sample_cases import build_sample_cases


CASES = build_sample_cases(100)


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


def seed_postgres(database_url: str) -> None:
    vector_store = VectorStore()
    vector_store.initialize()
    with psycopg.connect(database_url) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS cases (
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
        for column in ("narratives", "lead_details", "evidence", "documents"):
            connection.execute(f"ALTER TABLE cases ADD COLUMN IF NOT EXISTS {column} JSONB NOT NULL DEFAULT '[]'::jsonb")
        for case in CASES:
            connection.execute(
                """
                INSERT INTO cases (id, name, case_number, description, status, priority, lead, created_at, event_date, narratives, lead_details, evidence, documents)
                VALUES (%(id)s, %(name)s, %(case_number)s, %(description)s, %(status)s, %(priority)s,
                    %(lead)s, %(created_at)s, %(event_date)s, %(narratives)s, %(lead_details)s, %(evidence)s, %(documents)s)
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
                    status = EXCLUDED.status, priority = EXCLUDED.priority, lead = EXCLUDED.lead,
                    event_date = EXCLUDED.event_date, narratives = EXCLUDED.narratives,
                    lead_details = EXCLUDED.lead_details, evidence = EXCLUDED.evidence, documents = EXCLUDED.documents
                """,
                {**case, "narratives": Jsonb(case["narratives"]), "lead_details": Jsonb(case["lead_details"]), "evidence": Jsonb(case["evidence"]), "documents": Jsonb(case["documents"])},
            )
        connection.commit()

    for case in CASES:
        vector_store.delete_case_documents(case["id"])
        vector_store.add_documents(case["id"], [
            {"title": case["name"], "content": case["document"], "event_date": case["event_date"], "source_type": "synthetic-case"},
            *[{"title": item["title"], "content": item["text"], "event_date": item["date"], "source_type": "narrative"} for item in case["narratives"]],
            *[{"title": item["type"], "content": item["description"], "event_date": item["date"], "source_type": "evidence"} for item in case["evidence"]],
        ])


def seed_neo4j(uri: str, user: str, password: str) -> None:
    driver = GraphDatabase.driver(uri, auth=(user, password))
    try:
        with driver.session() as session:
            session.run("CREATE CONSTRAINT case_id IF NOT EXISTS FOR (c:Case) REQUIRE c.id IS UNIQUE")
            session.run("CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE")
            session.run("CREATE CONSTRAINT evidence_id IF NOT EXISTS FOR (e:Evidence) REQUIRE e.id IS UNIQUE")
            for index, case in enumerate(CASES):
                people = [
                    "person_00001" if index % 4 == 0 else f"person_{(index * 6) + 1:05d}",
                    "person_00002" if index % 5 == 0 else f"person_{(index * 6) + 2:05d}",
                    *[f"person_{(index * 6) + offset:05d}" for offset in range(3, 7)],
                ]
                session.run(
                    """
                    MERGE (c:Case {id: $case_id})
                    SET c.name = $name, c.title = $name, c.case_number = $case_number,
                        c.description = $description, c.status = $status, c.priority = $priority,
                        c.created_at = datetime($created_at), c.event_date = date($event_date)
                    WITH c
                    UNWIND $people AS person_id
                    MERGE (p:Person {id: person_id})
                    ON CREATE SET p.full_name = replace(person_id, '_', ' '),
                                  p.degree_centrality = 0.1, p.betweenness_centrality = 0.1,
                                  p.community_id = 1
                    MERGE (c)-[:ASSOCIATED_WITH]->(p)
                    """,
                    case_id=case["id"], name=case["name"], case_number=case["case_number"],
                    description=case["description"], status=case["status"], priority=case["priority"],
                    created_at=f"{case['created_at']}T00:00:00Z", event_date=case["event_date"], people=people,
                )
                session.run(
                    """
                    MATCH (a:Person {id: $person_a}), (b:Person {id: $person_b})
                    MERGE (phone_a:Phone {id: $phone_a})
                    MERGE (phone_b:Phone {id: $phone_b})
                    SET phone_a.number = $phone_a, phone_b.number = $phone_b
                    MERGE (a)-[:OWNS]->(phone_a)
                    MERGE (b)-[:OWNS]->(phone_b)
                    MERGE (phone_a)-[:COMMUNICATED {timestamp: datetime($event_date), duration: 120}]->(phone_b)
                    """,
                    person_a=people[0], person_b=people[1], phone_a=f"phone_{index * 3 + 1:05d}",
                    phone_b=f"phone_{index * 3 + 2:05d}", event_date=f"{case['event_date']}T00:00:00Z",
                )
                for person_a, person_b in zip(people[1:], people[2:]):
                    session.run(
                        """
                        MATCH (a:Person {id: $person_a}), (b:Person {id: $person_b})
                        MERGE (phone_a:Phone {id: $phone_a})
                        MERGE (phone_b:Phone {id: $phone_b})
                        MERGE (a)-[:OWNS]->(phone_a)
                        MERGE (b)-[:OWNS]->(phone_b)
                        MERGE (phone_a)-[:COMMUNICATED {timestamp: datetime($event_date), duration: 240}]->(phone_b)
                        """,
                        person_a=person_a, person_b=person_b,
                        phone_a=f"phone_{index * 10 + len(person_a):05d}", phone_b=f"phone_{index * 10 + len(person_b):05d}",
                        event_date=f"{case['event_date']}T00:00:00Z",
                    )
                session.run(
                    """
                    MERGE (e:Evidence {id: $evidence_id})
                    SET e.evidence_type = 'Synthetic case record', e.timestamp = datetime($event_date),
                        e.description = $description, e.source_record_id = $case_id
                    WITH e
                    MATCH (c:Case {id: $case_id})
                    MERGE (c)-[:HAS_EVIDENCE]->(e)
                    """,
                    evidence_id=f"evidence_{index + 1:05d}", case_id=case["id"],
                    event_date=f"{case['event_date']}T00:00:00Z", description=case["document"],
                )
    finally:
        driver.close()


def main() -> None:
    database_url = os.getenv("DATABASE_URL", "postgresql://trace:trace@postgres:5432/trace")
    neo4j_uri = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
    neo4j_user = os.getenv("NEO4J_USERNAME", "neo4j")
    neo4j_password = os.getenv("NEO4J_PASSWORD", "tracepassword")
    wait_for_postgres(database_url)
    wait_for_neo4j(neo4j_uri, neo4j_user, neo4j_password)
    seed_postgres(database_url)
    seed_neo4j(neo4j_uri, neo4j_user, neo4j_password)
    print(f"Seeded {len(CASES)} synthetic cases into PostgreSQL and Neo4j")


if __name__ == "__main__":
    main()
