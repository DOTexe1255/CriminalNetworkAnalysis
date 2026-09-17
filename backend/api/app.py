import os
import json
import io
import uuid
from pathlib import Path
from typing import Any
from fastapi import File, FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from neo4j import GraphDatabase
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pypdf import PdfReader
import psycopg
from psycopg.types.json import Jsonb
try:
    from services.rag_service import RagService
    from services.vector_store import VectorStore
    from services.object_storage import storage
except ImportError:
    from .services.rag_service import RagService
    from .services.vector_store import VectorStore
    from .services.object_storage import storage

load_dotenv()

NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USERNAME")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

if not all([NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD]):
    raise RuntimeError("Missing NEO4J_URI, NEO4J_USERNAME or NEO4J_PASSWORD in .env")

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
CASE_STORE = Path(__file__).resolve().parent.parent / "mock_cases.json"
MEDIA_ROOT = Path(__file__).resolve().parent.parent / "uploads"
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
vector_store = VectorStore()
rag_service = RagService(vector_store)


class CaseCreate(BaseModel):
    name: str = Field(min_length=2)
    description: str = ""
    status: str = "Active"
    priority: str = "Medium"
    lead: str = ""
    documents: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    narratives: list[dict[str, Any]] = []
    lead_details: list[dict[str, Any]] = []


class CaseUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    lead: str | None = None
    narratives: list[dict[str, Any]] | None = None
    lead_details: list[dict[str, Any]] | None = None
    evidence: list[dict[str, Any]] | None = None
    documents: list[dict[str, Any]] | None = None


class RagQuery(BaseModel):
    case_id: str = Field(min_length=1)
    question: str = Field(min_length=3, max_length=2000)


def read_mock_cases() -> list[dict[str, Any]]:
    try:
        return json.loads(CASE_STORE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def write_mock_cases(cases: list[dict[str, Any]]) -> None:
    CASE_STORE.write_text(json.dumps(cases, indent=2), encoding="utf-8")


def read_database_cases() -> list[dict[str, Any]]:
    try:
        with psycopg.connect(vector_store.database_url) as connection:
            rows = connection.execute(
                """
                  SELECT id, name, description, status, priority, lead,
                      created_at::text, event_date::text, narratives, lead_details, evidence, documents
                  FROM cases ORDER BY created_at DESC, id
                """
            ).fetchall()
        return [
            {
                "id": row[0], "name": row[1], "description": row[2], "status": row[3],
                "priority": row[4], "lead": row[5], "created_at": row[6], "event_date": row[7],
                "narratives": row[8] or [], "lead_details": row[9] or [], "evidence": row[10] or [], "documents": row[11] or [],
            }
            for row in rows
        ]
    except (psycopg.Error, OSError):
        return []

app = FastAPI(title="Trace — Criminal Network Intelligence API")
app.mount("/media", StaticFiles(directory=MEDIA_ROOT), name="media")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    try:
        storage.ensure_bucket()
        seed_demo_storage()
    except Exception as error:
        print(f"Object storage is not ready yet: {error}")
    try:
        vector_store.initialize()
    except Exception as error:
        # Graph browsing remains available when Postgres is still starting.
        print(f"Vector store is not ready yet: {error}")

@app.on_event("shutdown")
def shutdown():
    driver.close()


def seed_demo_storage() -> None:
    """Keep a few synthetic files available for a fresh investigator demo."""
    demo_files = [
        ("case_00000/demo/intake-brief.txt", b"TRACE DEMO CASE BRIEF\nOperation Godavari Link\nSynthetic training material for investigator review.\n", "text/plain", "case_00000-intake-brief.txt", "Case brief"),
        ("case_00000/demo/contact-timeline.csv", b"date,record_type,summary\n2026-08-18,Call Record,Repeated contact window flagged for review\n2026-08-25,Location Event,Device observed near a transport hub\n", "text/csv", "case_00000-contact-timeline.csv", "Timeline export"),
        ("case_00000/demo/location-map.svg", b"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"900\" height=\"420\"><rect width=\"900\" height=\"420\" fill=\"#10151c\"/><circle cx=\"450\" cy=\"210\" r=\"82\" fill=\"#d9a441\"/><text x=\"450\" y=\"216\" fill=\"#11161c\" text-anchor=\"middle\" font-family=\"Arial\" font-size=\"24\">SYNTHETIC LOCATION MAP</text></svg>", "image/svg+xml", "case_00000-location-map.svg", "Evidence image"),
    ]
    cases = read_mock_cases()
    case = next((item for item in cases if item.get("id") == "case_00000"), None)
    documents = case.setdefault("documents", []) if case else []
    for key, content, content_type, name, category in demo_files:
        storage.put_bytes(key, content, content_type)
        if not any(item.get("name") == name for item in documents):
            documents.append({"name": name, "type": content_type, "size": len(content), "category": category, "description": "Synthetic demo file stored in local object storage.", "url": f"/api/cases/case_00000/files/{key.split('/', 1)[1]}"})
    if case:
        write_mock_cases(cases)
    try:
        with psycopg.connect(vector_store.database_url) as connection:
            row = connection.execute("SELECT documents FROM cases WHERE id = %s", ("case_00000",)).fetchone()
            if row is not None:
                database_documents = row[0] or []
                merged = [*database_documents]
                for document in documents:
                    if not any(item.get("name") == document.get("name") for item in merged):
                        merged.append(document)
                connection.execute("UPDATE cases SET documents = %s WHERE id = %s", (Jsonb(merged), "case_00000"))
                connection.commit()
    except psycopg.Error as error:
        print(f"Could not sync demo file metadata to PostgreSQL: {error}")


@app.get("/api/graph")
def get_graph(
    limit: int = 300,
    case_id: str | None = None,
):
    query = """
    MATCH (p:Person)
    WHERE p.betweenness_centrality IS NOT NULL
    WITH p ORDER BY p.betweenness_centrality DESC LIMIT $limit
    WITH collect(p) AS people
    UNWIND people AS p1
    UNWIND people AS p2
    MATCH (p1)-[:OWNS]->(:Phone)-[:COMMUNICATED]-(:Phone)<-[:OWNS]-(p2)
    WHERE p1.id < p2.id
    RETURN DISTINCT
        [pp IN people | {
            id: pp.id,
            name: pp.full_name,
            degree: pp.degree_centrality,
            betweenness: pp.betweenness_centrality,
            community: pp.community_id
        }] AS nodes,
        collect(DISTINCT {
            source: p1.id,
            target: p2.id
        }) AS edges
    """
    with driver.session() as session:
        result = session.run(query, limit=limit).single()

    if result is None:
        return {"elements": []}

    elements = [{"data": n} for n in result["nodes"]]
    elements += [
        {"data": {
            "id": f"{e['source']}-{e['target']}",
            "source": e["source"],
            "target": e["target"]
        }}
        for e in result["edges"]
    ]
    return {"elements": elements}


@app.get("/api/person/{person_id}")
def get_person(person_id: str):
    query = """
    MATCH (p:Person {id: $person_id})
    OPTIONAL MATCH (p)-[:OWNS]->(ph:Phone)
    OPTIONAL MATCH (p)-[:HOLDS]->(acc:BankAccount)
    OPTIONAL MATCH (p)-[:WORKS_AT]->(org:Organization)
    OPTIONAL MATCH (p)-[:OWNS]->(v:Vehicle)
    OPTIONAL MATCH (p)-[:USES]->(d:Device)
    RETURN p.id AS id,
           p.full_name AS name,
           p.national_id AS national_id,
           p.date_of_birth AS date_of_birth,
           p.occupation AS occupation,
           p.address AS address,
           p.city AS city,
           p.aliases AS aliases,
           p.bio AS bio,
           p.degree_centrality AS degree_centrality,
           p.betweenness_centrality AS betweenness_centrality,
           p.community_id AS community_id,
           collect(DISTINCT ph.number) AS phone_numbers,
           collect(DISTINCT acc.account_no) AS bank_accounts,
           collect(DISTINCT org.name) AS organizations,
           collect(DISTINCT CASE WHEN v.id IS NOT NULL THEN {id: v.id, plate_no: v.plate_no, model: v.model} END) AS vehicles,
           collect(DISTINCT CASE WHEN d.id IS NOT NULL THEN {id: d.id, imei: d.imei, device_type: d.device_type} END) AS devices
    """
    with driver.session() as session:
        record = session.run(query, person_id=person_id).single()

    if record is None:
        raise HTTPException(404, f"No person found with id {person_id}")

    return dict(record)


@app.get("/api/top-connectors")
def get_top_connectors(by: str = "betweenness", count: int = 10):
    if by not in ("betweenness", "degree"):
        raise HTTPException(400, "'by' must be 'betweenness' or 'degree'")

    field = "betweenness_centrality" if by == "betweenness" else "degree_centrality"
    query = f"""
    MATCH (p:Person)
    WHERE p.{field} IS NOT NULL
    RETURN p.id AS id, p.full_name AS name, p.{field} AS score
    ORDER BY score DESC
    LIMIT $count
    """
    with driver.session() as session:
        return [dict(r) for r in session.run(query, count=count)]


@app.get("/api/case/{case_id}/findings")
def get_case_findings(case_id: str):
    query = """
    MATCH (c:Case {id: $case_id})-[:HAS_FINDING]->(f:Finding)

    OPTIONAL MATCH (f)-[:ABOUT]->(p:Person)

    OPTIONAL MATCH (f)-[:SUPPORTED_BY]->(ev:Evidence)

    OPTIONAL MATCH (other_case:Case)-[:HAS_FINDING]->(f)

    WITH
        f,
        collect(DISTINCT p)[0] AS p,
        count(DISTINCT ev) AS evidence_count,
        count(DISTINCT other_case) AS case_count

    RETURN
        f.id AS id,
        f.finding_type AS finding_type,
        f.title AS title,
        f.description AS description,
        f.importance AS importance,
        p.id AS person_id,
        p.full_name AS person_name,
        evidence_count,
        case_count

    ORDER BY
        CASE f.importance
            WHEN 'High' THEN 0
            WHEN 'Medium' THEN 1
            ELSE 2
        END,
        f.finding_type,
        f.title
    """

    with driver.session() as session:
        return [
            dict(r)
            for r in session.run(
                query,
                case_id=case_id
            )
        ]

@app.get("/api/finding/{finding_id}")
def get_finding(finding_id: str):
    query = """
    MATCH (f:Finding {id: $finding_id})
    OPTIONAL MATCH (f)-[:ABOUT]->(p:Person)
    OPTIONAL MATCH (c:Case)-[:HAS_FINDING]->(f)
    RETURN f.id AS id,
           f.finding_type AS finding_type,
           f.title AS title,
           f.description AS description,
           f.importance AS importance,
           p.id AS person_id,
           p.full_name AS person_name,
           collect(DISTINCT c.id) AS case_ids
    """
    with driver.session() as session:
        record = session.run(query, finding_id=finding_id).single()

    if record is None:
        raise HTTPException(404, "Finding not found")

    return dict(record)


@app.get("/api/finding/{finding_id}/evidence")
def get_finding_evidence(finding_id: str):
    query = """
    MATCH (f:Finding {id: $finding_id})-[:SUPPORTED_BY]->(ev:Evidence)
    OPTIONAL MATCH (ev)-[:INVOLVES]->(person:Person)
    WITH ev, collect(DISTINCT {
        id: person.id,
        name: coalesce(person.full_name, person.id)
    }) AS people
    RETURN ev.id AS id,
           ev.evidence_type AS evidence_type,
           ev.timestamp AS timestamp,
           ev.description AS description,
           ev.source_record_id AS source_record_id,
           [person IN people WHERE person.id IS NOT NULL] AS related_people
    ORDER BY ev.timestamp DESC
    """
    with driver.session() as session:
        records = []
        for row in session.run(query, finding_id=finding_id):
            item = dict(row)
            people = item.get("related_people") or []
            description = item.get("description") or ""
            for person in people:
                if person.get("id") and person.get("name"):
                    description = description.replace(person["id"], person["name"])
            item["description"] = description
            records.append(item)
        return records


@app.get("/api/cases")
def get_cases(search: str = "", sort: str = "date_desc"):
    cases = read_database_cases() or read_mock_cases()
    if search.strip():
        needle = search.casefold()
        cases = [case for case in cases if needle in " ".join(str(case.get(key, "")) for key in ("id", "name", "description", "lead", "case_number")).casefold()]
    try:
        query = """
        MATCH (c:Case)
        OPTIONAL MATCH (c)-[:ASSOCIATED_WITH]->(p:Person)
        OPTIONAL MATCH (c)-[:HAS_FINDING]->(f:Finding)
        RETURN c.id AS id, c.name AS name, c.description AS description,
               count(DISTINCT p) AS person_count, count(DISTINCT f) AS finding_count
        ORDER BY c.name
        """
        with driver.session() as session:
            neo4j_cases = [dict(r) for r in session.run(query)]
            by_id = {case["id"]: case for case in cases}
            for neo4j_case in neo4j_cases:
                if neo4j_case.get("id") in by_id:
                    by_id[neo4j_case["id"]].update(
                        person_count=neo4j_case.get("person_count", 0),
                        finding_count=neo4j_case.get("finding_count", 0),
                    )
                elif not search.strip():
                    cases.append(neo4j_case)
    except Exception:
        pass
    priority_rank = {"High": 0, "Medium": 1, "Low": 2}
    if sort == "priority":
        cases.sort(key=lambda case: (priority_rank.get(case.get("priority", "Low"), 3), case.get("created_at", "")), reverse=False)
    elif sort == "date_asc":
        cases.sort(key=lambda case: case.get("created_at", ""))
    else:
        cases.sort(key=lambda case: case.get("created_at", ""), reverse=True)
    return cases


@app.post("/api/cases")
def create_case(payload: CaseCreate):
    cases = read_mock_cases()
    case = {
        "id": f"case_{uuid.uuid4().hex[:10]}",
        **payload.model_dump(),
        "created_at": __import__("datetime").date.today().isoformat(),
        "person_count": 0,
        "finding_count": 0,
    }
    cases.insert(0, case)
    write_mock_cases(cases)
    try:
        with psycopg.connect(vector_store.database_url) as connection:
            connection.execute(
                """
                INSERT INTO cases (id, name, case_number, description, status, priority, lead, created_at, event_date, narratives, lead_details, evidence, documents)
                VALUES (%s, %s, %s, %s, %s, %s, %s, CURRENT_DATE, CURRENT_DATE, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (case["id"], payload.name, case["id"], payload.description, payload.status, payload.priority, payload.lead,
                 Jsonb(payload.narratives), Jsonb(payload.lead_details), Jsonb(payload.evidence), Jsonb(payload.documents)),
            )
            connection.commit()
    except psycopg.Error:
        pass
    try:
        vector_store.add_documents(
            case["id"],
            [
                *[
                    {**document, "source_type": document.get("type", "document")}
                    for document in payload.documents
                ],
                *[
                    {**evidence, "content": evidence.get("description", ""), "source_type": "evidence"}
                    for evidence in payload.evidence
                ],
            ],
        )
    except Exception as error:
        print(f"Could not index initial case material: {error}")
    return case


@app.patch("/api/cases/{case_id}")
def update_case(case_id: str, payload: CaseUpdate):
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(400, "No case changes supplied")
    allowed = {"name", "description", "status", "priority", "lead", "narratives", "lead_details", "evidence", "documents"}
    updates = {key: value for key, value in updates.items() if key in allowed}
    assignments = []
    values: list[Any] = []
    for key, value in updates.items():
        assignments.append(f"{key} = %s")
        values.append(Jsonb(value) if key in {"narratives", "lead_details", "evidence", "documents"} else value)
    values.append(case_id)
    try:
        with psycopg.connect(vector_store.database_url) as connection:
            row = connection.execute(f"UPDATE cases SET {', '.join(assignments)} WHERE id = %s RETURNING id", values).fetchone()
            connection.commit()
        if not row:
            raise HTTPException(404, "Case not found")
    except psycopg.Error as error:
        raise HTTPException(500, f"Case update failed: {error}") from error
    text_items = []
    for key in ("description", "narratives", "evidence"):
        value = updates.get(key)
        if value:
            text_items.append({"title": key.title(), "content": value if isinstance(value, str) else json.dumps(value), "source_type": key})
    if text_items:
        try:
            vector_store.delete_case_documents(case_id)
            vector_store.add_documents(case_id, text_items)
        except Exception as error:
            print(f"Could not refresh case search index: {error}")
    return next(case for case in read_database_cases() if case["id"] == case_id)


@app.post("/api/rag/query")
def query_case(payload: RagQuery):
    try:
        return rag_service.answer(payload.case_id, payload.question)
    except RuntimeError as error:
        raise HTTPException(503, str(error)) from error
    except Exception as error:
        raise HTTPException(500, f"Case query failed: {error}") from error


@app.get("/api/case/{case_id}/summary")
def summarize_case(case_id: str):
    try:
        return rag_service.summarize_case(case_id)
    except RuntimeError as error:
        raise HTTPException(503, str(error)) from error
    except Exception as error:
        raise HTTPException(500, f"Case summary failed: {error}") from error


@app.post("/api/cases/{case_id}/documents")
def upload_case_documents(
    case_id: str,
    files: list[UploadFile] = File(...),
    file_metadata: str = Form("[]"),
):
    try:
        metadata = json.loads(file_metadata)
    except json.JSONDecodeError as error:
        raise HTTPException(400, "Invalid file metadata") from error

    documents: list[dict[str, Any]] = []
    saved_documents: list[dict[str, Any]] = []
    for index, upload in enumerate(files):
        original_name = upload.filename or f"evidence-{index + 1}"
        safe_name = f"{uuid.uuid4().hex[:10]}_{Path(original_name).name}"
        content = upload.file.read()
        storage_key = f"{case_id}/{safe_name}"
        storage.put_bytes(storage_key, content, upload.content_type or "application/octet-stream")
        details = metadata[index] if index < len(metadata) and isinstance(metadata[index], dict) else {}
        record = {
            "name": original_name,
            "type": upload.content_type or "application/octet-stream",
            "size": len(content),
            "category": details.get("category", "Case file"),
            "description": details.get("description", ""),
            "person_name": details.get("person_name", ""),
            "url": f"/api/cases/{case_id}/files/{safe_name}",
        }
        saved_documents.append(record)
        if upload.content_type == "application/pdf":
            pdf_text = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(content)).pages).strip()
            if pdf_text:
                documents.append({"title": original_name, "content": pdf_text, "source_type": "pdf"})

    cases = read_mock_cases()
    case = next((item for item in cases if item.get("id") == case_id), None)
    if case is not None:
        existing = [item for item in (case.get("documents") or []) if item.get("name") not in {doc["name"] for doc in saved_documents}]
        case["documents"] = [*existing, *saved_documents]
        write_mock_cases(cases)
    try:
        indexed = vector_store.add_documents(case_id, documents)
    except Exception as error:
        raise HTTPException(500, f"Document indexing failed: {error}") from error
    return {"case_id": case_id, "indexed_documents": indexed, "documents": saved_documents}


@app.get("/api/cases/{case_id}/files/{file_path:path}")
def download_case_file(case_id: str, file_path: str):
    clean_path = "/".join(part for part in file_path.split("/") if part not in {"", ".", ".."})
    key = f"{case_id}/{clean_path}"
    try:
        stored = storage.get_object(key)
    except KeyError as error:
        raise HTTPException(404, "Case file not found") from error
    return StreamingResponse(
        stored["Body"],
        media_type=stored.get("ContentType", "application/octet-stream"),
        headers={"Content-Disposition": f'inline; filename="{Path(clean_path).name}"'},
    )


@app.get("/api/case/{case_id}")
def get_case(case_id: str):
    case = next((item for item in read_database_cases() if item.get("id") == case_id), None)
    case = case or next((item for item in read_mock_cases() if item.get("id") == case_id), None)
    if case is None:
        raise HTTPException(404, "Case not found")
    return case


@app.get("/api/case/{case_id}/findings")
def get_case_findings(case_id: str):
    query = """
    MATCH (c:Case {id: $case_id})-[:HAS_FINDING]->(f:Finding)
    OPTIONAL MATCH (f)-[:ABOUT]->(p:Person)
    RETURN f.id AS id,
           f.finding_type AS finding_type,
           f.title AS title,
           f.description AS description,
           f.importance AS importance,
           p.id AS person_id,
           p.full_name AS person_name
    ORDER BY
        CASE f.importance WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
        f.title
    """
    with driver.session() as session:
        return [dict(r) for r in session.run(query, case_id=case_id)]


@app.get("/api/person/{person_id}/evidence")
def get_person_evidence(person_id: str, limit: int = 30):
    query = """
    MATCH (p:Person {id: $person_id})<-[:INVOLVES]-(ev:Evidence)
    OPTIONAL MATCH (f:Finding)-[:SUPPORTED_BY]->(ev)
    OPTIONAL MATCH (ev)-[:INVOLVES]->(related:Person)
    RETURN DISTINCT
           ev.id AS id,
           ev.evidence_type AS evidence_type,
           ev.timestamp AS timestamp,
           ev.description AS description,
           ev.source_record_id AS source_record_id,
           collect(DISTINCT f.title)[0] AS finding_title,
           collect(DISTINCT {id: related.id, name: related.full_name}) AS people
    ORDER BY ev.timestamp DESC
    LIMIT $limit
    """
    with driver.session() as session:
        records = []
        for row in session.run(query, person_id=person_id, limit=limit):
            item = dict(row)
            people = [person for person in (item.pop("people", []) or []) if person and person.get("id")]
            description = item.get("description") or ""
            for person in people:
                if person.get("name"):
                    description = description.replace(person["id"], person["name"])
            item["description"] = description
            item["people"] = [person["name"] for person in people if person.get("name")]
            records.append(item)
        return records


@app.get("/api/person/{person_id}/activity")
def get_person_activity(person_id: str, limit: int = 100):
    query = """
    MATCH (p:Person {id: $person_id})-[:OWNS]->(ph:Phone)
    MATCH (ph)-[r:COMMUNICATED]-(other:Phone)<-[:OWNS]-(other_person:Person)
    RETURN 'Communication' AS activity_type,
           r.timestamp AS timestamp,
           r.duration AS value,
           other_person.id AS related_person_id,
           other_person.full_name AS related_person_name
    UNION ALL
    MATCH (p:Person {id: $person_id})-[:HOLDS]->(acc:BankAccount)
    MATCH (acc)-[r:TRANSFERRED]-(other_acc:BankAccount)<-[:HOLDS]-(other_person:Person)
    RETURN 'Transaction' AS activity_type,
           r.timestamp AS timestamp,
           r.amount AS value,
           other_person.id AS related_person_id,
           other_person.full_name AS related_person_name
    ORDER BY timestamp DESC
    LIMIT $limit
    """
    with driver.session() as session:
        return [dict(r) for r in session.run(query, person_id=person_id, limit=limit)]


@app.get("/api/person/{person_id}/connections")
def get_person_connections(person_id: str):
    query = """
    MATCH (p:Person {id: $person_id})-[:OWNS]->(:Phone)-[:COMMUNICATED]-(:Phone)<-[:OWNS]-(other:Person)
    RETURN DISTINCT other.id AS id,
           other.full_name AS name,
           other.degree_centrality AS degree_centrality,
           other.betweenness_centrality AS betweenness_centrality,
           other.community_id AS community_id
    ORDER BY betweenness_centrality DESC
    """
    with driver.session() as session:
        return [dict(r) for r in session.run(query, person_id=person_id)]
# ============================================================
# ENTITY DETAIL GRAPH
# ============================================================
# Returns a focused entity-relationship graph around one person.
#
# Used by the React GraphView when the investigator switches
# from NETWORK mode -> ENTITY DETAIL mode.
#
# Example:
#   /api/entity-graph?person_id=person_00196&hop=1
#   /api/entity-graph?person_id=person_00196&hop=2
#
# Supported entities:
#   Person
#   Phone
#   BankAccount
#   Vehicle
#   Device
#   Organization
#   Event
#   Location
#   Case (if Case nodes exist)
#
# This endpoint DOES NOT create or modify anything in Neo4j.
# ============================================================

@app.get("/api/entity-graph")
def get_entity_graph(
    person_id: str,
    hop: int = 1,
    case_id: str | None = None,
):
    """
    Return an investigator-focused entity graph around one Person.

    hop=1:
        Person + directly connected entities

    hop=2:
        Person + direct entities + second-hop entities

    case_id:
        Optional case filter. If supplied, Case relationships are
        included and events/entities relevant to that case can be
        surfaced where the database model supports it.
    """

    # Keep the graph controlled. We don't want a 5,000-node graph
    # accidentally dumped into Cytoscape.
    hop = max(1, min(hop, 2))

    query = """
    MATCH (root:Person {id: $person_id})

    // --------------------------------------------------------
    // Direct entity relationships
    // --------------------------------------------------------

    OPTIONAL MATCH (root)-[r_phone:OWNS]->(phone:Phone)

    OPTIONAL MATCH (root)-[r_account:HOLDS]->(account:BankAccount)

    OPTIONAL MATCH (root)-[r_vehicle:OWNS]->(vehicle:Vehicle)

    OPTIONAL MATCH (root)-[r_device:USES]->(device:Device)

    OPTIONAL MATCH (root)-[r_org:WORKS_AT]->(org:Organization)

    OPTIONAL MATCH (root)-[r_event:PARTICIPATED_IN]->(event:Event)

    OPTIONAL MATCH (event)-[r_location:OCCURS_AT]->(location:Location)

    // --------------------------------------------------------
    // Cases
    //
    // Case nodes may not exist in every version of the dataset.
    // OPTIONAL MATCH keeps the endpoint safe if they don't.
    // --------------------------------------------------------

    OPTIONAL MATCH (caseNode:Case)-[r_case_person]-(root)

    // --------------------------------------------------------
    // Second-hop entities
    //
    // These are deliberately limited to useful entity types.
    // --------------------------------------------------------

    OPTIONAL MATCH (root)-[:OWNS|HOLDS|USES|WORKS_AT|PARTICIPATED_IN]-
                   (direct)
                   -[:OWNS|HOLDS|USES|WORKS_AT|PARTICIPATED_IN]-
                   (second)

    RETURN
        root,

        collect(DISTINCT {
            node: phone,
            rel: type(r_phone),
            type: "Phone"
        }) AS phones,

        collect(DISTINCT {
            node: account,
            rel: type(r_account),
            type: "BankAccount"
        }) AS accounts,

        collect(DISTINCT {
            node: vehicle,
            rel: type(r_vehicle),
            type: "Vehicle"
        }) AS vehicles,

        collect(DISTINCT {
            node: device,
            rel: type(r_device),
            type: "Device"
        }) AS devices,

        collect(DISTINCT {
            node: org,
            rel: type(r_org),
            type: "Organization"
        }) AS organizations,

        collect(DISTINCT {
            node: event,
            rel: type(r_event),
            type: "Event"
        }) AS events,

        collect(DISTINCT {
            node: location,
            rel: type(r_location),
            type: "Location"
        }) AS locations,

        collect(DISTINCT {
            node: caseNode,
            rel: type(r_case_person),
            type: "Case"
        }) AS cases,

        collect(DISTINCT {
            node: second,
            type: labels(second)[0]
        }) AS second_hop
    """

    with driver.session() as session:
        result = session.run(
            query,
            person_id=person_id,
        ).single()

    if result is None:
        return {
            "elements": [],
            "root_id": person_id,
            "hop": hop,
        }

    elements = []

    # --------------------------------------------------------
    # Helper: safely convert Neo4j node -> Cytoscape node
    # --------------------------------------------------------

    def add_node(node, entity_type=None, root=False):
        if node is None:
            return None

        labels = list(node.labels)

        # Prefer explicit type passed by the query.
        node_type = entity_type or (
            labels[0] if labels else "Entity"
        )

        node_id = node.get("id")

        if not node_id:
            return None

        # ----------------------------------------------------
        # Human-readable label
        # ----------------------------------------------------

        if node_type == "Person":
            label = (
                node.get("full_name")
                or node.get("name")
                or node_id
            )

        elif node_type == "Phone":
            label = (
                node.get("number")
                or node_id
            )

        elif node_type == "BankAccount":
            label = (
                node.get("account_no")
                or node_id
            )

        elif node_type == "Vehicle":
            label = (
                node.get("plate_no")
                or node.get("model")
                or node_id
            )

        elif node_type == "Device":
            label = (
                node.get("device_type")
                or node.get("imei")
                or node_id
            )

        elif node_type == "Organization":
            label = (
                node.get("name")
                or node_id
            )

        elif node_type == "Location":
            label = (
                node.get("label")
                or node_id
            )

        elif node_type == "Event":
            label = (
                node.get("event_type")
                or node_id
            )

        elif node_type == "Case":
            label = (
                node.get("name")
                or node.get("title")
                or node.get("case_name")
                or node_id
            )

        else:
            label = (
                node.get("name")
                or node.get("label")
                or node_id
            )

        # Avoid duplicate nodes.
        existing_ids = {
            element["data"]["id"]
            for element in elements
            if element.get("data", {}).get("id")
            and "source" not in element["data"]
        }

        if node_id not in existing_ids:
            elements.append({
                "data": {
                    "id": node_id,
                    "name": str(label),
                    "label": str(label),
                    "entityType": node_type,
                    "type": node_type,
                    "root": root,

                    # Useful properties for the frontend
                    "phone": node.get("number"),
                    "account_no": node.get("account_no"),
                    "plate_no": node.get("plate_no"),
                    "model": node.get("model"),
                    "imei": node.get("imei"),
                    "device_type": node.get("device_type"),
                    "org_type": node.get("org_type"),
                    "event_type": node.get("event_type"),
                    "timestamp": (
                        str(node.get("occurred_at"))
                        if node.get("occurred_at") is not None
                        else None
                    ),
                    "lat": node.get("lat"),
                    "lng": node.get("lng"),
                }
            })

        return node_id

    # --------------------------------------------------------
    # Root Person
    # --------------------------------------------------------

    root = result["root"]

    root_id = add_node(
        root,
        "Person",
        root=True,
    )

    # --------------------------------------------------------
    # Helper for relationship edges
    # --------------------------------------------------------

    edge_ids = set()

    def add_edge(source, target, relationship):
        if not source or not target:
            return

        edge_key = f"{source}::{relationship}::{target}"

        if edge_key in edge_ids:
            return

        edge_ids.add(edge_key)

        elements.append({
            "data": {
                "id": edge_key,
                "source": source,
                "target": target,
                "relationship": relationship,
                "label": relationship.replace("_", " "),
            }
        })

    # --------------------------------------------------------
    # Direct entities
    # --------------------------------------------------------

    groups = [
        ("phones", "Phone"),
        ("accounts", "BankAccount"),
        ("vehicles", "Vehicle"),
        ("devices", "Device"),
        ("organizations", "Organization"),
        ("events", "Event"),
        ("locations", "Location"),
        ("cases", "Case"),
    ]

    for group_name, entity_type in groups:
        for item in result[group_name]:
            node = item["node"]

            if node is None:
                continue

            node_id = add_node(
                node,
                entity_type,
            )

            if node_id:
                relationship = item["rel"]

                if relationship:
                    add_edge(
                        root_id,
                        node_id,
                        relationship,
                    )

    # --------------------------------------------------------
    # Event -> Location relationships
    # --------------------------------------------------------

    for event_item in result["events"]:
        event_node = event_item["node"]

        if event_node is None:
            continue

        event_id = event_node.get("id")

        if not event_id:
            continue

        for location_item in result["locations"]:
            location_node = location_item["node"]

            if location_node is None:
                continue

            location_id = location_node.get("id")

            if not location_id:
                continue

            # Only connect locations actually related to the event.
            # Verify relationship directly instead of assuming.
            with driver.session() as session:
                rel_result = session.run(
                    """
                    MATCH (e:Event {id: $event_id})
                          -[r:OCCURS_AT]->
                          (l:Location {id: $location_id})
                    RETURN type(r) AS relationship
                    LIMIT 1
                    """,
                    event_id=event_id,
                    location_id=location_id,
                ).single()

            if rel_result:
                add_node(
                    location_node,
                    "Location",
                )

                add_edge(
                    event_id,
                    location_id,
                    "OCCURS_AT",
                )

    # --------------------------------------------------------
    # Optional second-hop expansion
    # --------------------------------------------------------

    if hop >= 2:

        for item in result["second_hop"]:

            node = item["node"]

            if node is None:
                continue

            labels = list(node.labels)

            if not labels:
                continue

            entity_type = labels[0]

            # Only expose supported entity types.
            supported = {
                "Person",
                "Phone",
                "BankAccount",
                "Vehicle",
                "Device",
                "Organization",
                "Event",
                "Location",
                "Case",
            }

            if entity_type not in supported:
                continue

            node_id = add_node(
                node,
                entity_type,
            )

            if not node_id:
                continue

            # Find the actual relationship from root's direct
            # neighborhood to this second-hop node.
            with driver.session() as session:
                rel_result = session.run(
                    """
                    MATCH (root:Person {id: $person_id})
                    MATCH (root)-[r1]-(middle)-[r2]-(target)
                    WHERE target.id = $target_id
                    RETURN
                        middle.id AS middle_id,
                        type(r2) AS relationship
                    LIMIT 1
                    """,
                    person_id=person_id,
                    target_id=node_id,
                ).single()

            if rel_result:
                middle_id = rel_result["middle_id"]
                relationship = rel_result["relationship"]

                if middle_id and relationship:
                    add_edge(
                        middle_id,
                        node_id,
                        relationship,
                    )

    return {
        "elements": elements,
        "root_id": root_id,
        "hop": hop,
        "entity_count": len([
            e for e in elements
            if "source" not in e["data"]
        ]),
        "relationship_count": len([
            e for e in elements
            if "source" in e["data"]
        ]),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


# Add this endpoint to your existing backend/main.py.
# It does NOT replace /api/graph. It adds a separate entity-detail graph.

from fastapi import HTTPException


@app.get("/api/entity-graph")
def get_entity_graph(person_id: str, hop: int = 1, case_id: str | None = None):
    """Return a compact, investigator-friendly entity graph around one person."""
    hop = 2 if hop >= 2 else 1

    direct_query = """
    MATCH (root:Person {id: $person_id})

    OPTIONAL MATCH (root)-[:OWNS]->(ph:Phone)
    OPTIONAL MATCH (root)-[:HOLDS]->(acc:BankAccount)
    OPTIONAL MATCH (root)-[:OWNS]->(veh:Vehicle)
    OPTIONAL MATCH (root)-[:USES]->(dev:Device)
    OPTIONAL MATCH (root)-[:WORKS_AT]->(org:Organization)
    OPTIONAL MATCH (root)-[:PARTICIPATED_IN]->(ev:Event)
    OPTIONAL MATCH (ev)-[:OCCURS_AT]->(loc:Location)
    OPTIONAL MATCH (c:Case)-[:ASSOCIATED_WITH]->(root)

    WITH root,
         collect(DISTINCT ph) AS phones,
         collect(DISTINCT acc) AS accounts,
         collect(DISTINCT veh) AS vehicles,
         collect(DISTINCT dev) AS devices,
         collect(DISTINCT org) AS orgs,
         collect(DISTINCT ev) AS events,
         collect(DISTINCT loc) AS locations,
         collect(DISTINCT CASE WHEN $case_id IS NULL OR c.id = $case_id THEN c ELSE NULL END) AS cases

    RETURN root, phones, accounts, vehicles, devices, orgs, events, locations, cases
    """

    interaction_query = """
    MATCH (root:Person {id: $person_id})
    OPTIONAL MATCH (root)-[:OWNS]->(:Phone)-[:COMMUNICATED]-(:Phone)<-[:OWNS]-(other_call:Person)
    OPTIONAL MATCH (root)-[:HOLDS]->(:BankAccount)-[:TRANSACTED]-(:BankAccount)<-[:HOLDS]-(other_tx:Person)

    WITH root,
         collect(DISTINCT other_call) + collect(DISTINCT other_tx) AS raw_people
    UNWIND raw_people AS other
    WITH root, other
    WHERE other IS NOT NULL
      AND other.id <> root.id

    OPTIONAL MATCH (c:Case)-[:ASSOCIATED_WITH]->(other)
    WITH root, other,
         CASE
           WHEN $case_id IS NULL THEN true
           ELSE any(x IN collect(DISTINCT c.id) WHERE x = $case_id)
         END AS in_case
    WHERE in_case

    RETURN collect(DISTINCT other) AS people
    """

    with driver.session() as session:
        record = session.run(
            direct_query,
            person_id=person_id,
            case_id=case_id,
        ).single()

        if record is None:
            raise HTTPException(status_code=404, detail=f"No person found with id {person_id}")

        interaction_record = session.run(
            interaction_query,
            person_id=person_id,
            case_id=case_id,
        ).single()

    root = record["root"]
    phones = [x for x in record["phones"] if x is not None]
    accounts = [x for x in record["accounts"] if x is not None]
    vehicles = [x for x in record["vehicles"] if x is not None]
    devices = [x for x in record["devices"] if x is not None]
    orgs = [x for x in record["orgs"] if x is not None]
    events = [x for x in record["events"] if x is not None]
    locations = [x for x in record["locations"] if x is not None]
    cases = [x for x in record["cases"] if x is not None]
    related_people = [x for x in ((interaction_record["people"] if interaction_record else []) or []) if x is not None]

    nodes = {}
    edges = {}

    def add_node(node, entity_type, label, size, person_id_value=None, extra=None):
        if node is None or node.get("id") is None:
            return
        data = {
            "id": node["id"],
            "entityType": entity_type,
            "label": label,
            "name": label if entity_type == "Person" else None,
            "personId": person_id_value,
            "size": size,
        }
        if extra:
            data.update(extra)
        nodes[node["id"]] = data

    def add_edge(source, target, label, kind):
        if not source or not target or source == target:
            return
        key = f"{source}::{target}::{label}"
        edges[key] = {
            "source": source,
            "target": target,
            "label": label,
            "kind": kind,
        }

    add_node(
        root,
        "Person",
        root.get("full_name") or root.get("id"),
        54,
        root.get("id"),
        {
            "degree": root.get("degree_centrality"),
            "betweenness": root.get("betweenness_centrality"),
            "community": root.get("community_id"),
        },
    )

    for ph in phones:
        add_node(ph, "Phone", ph.get("number") or ph.get("id"), 34)
        add_edge(root["id"], ph["id"], "OWNS", "ownership")

    for acc in accounts:
        add_node(acc, "Account", acc.get("account_no") or acc.get("id"), 34)
        add_edge(root["id"], acc["id"], "HOLDS", "ownership")

    for veh in vehicles:
        add_node(veh, "Vehicle", veh.get("plate_no") or veh.get("model") or veh.get("id"), 34)
        add_edge(root["id"], veh["id"], "OWNS", "ownership")

    for dev in devices:
        add_node(dev, "Device", dev.get("device_type") or dev.get("imei") or dev.get("id"), 32)
        add_edge(root["id"], dev["id"], "USES", "usage")

    for org in orgs:
        add_node(org, "Organization", org.get("name") or org.get("id"), 38)
        add_edge(root["id"], org["id"], "WORKS AT", "organization")

    for ev in events:
        add_node(ev, "Event", ev.get("event_type") or ev.get("id"), 30)
        add_edge(root["id"], ev["id"], "PARTICIPATED IN", "event")

    for loc in locations:
        add_node(
            loc,
            "Location",
            loc.get("label") or loc.get("id"),
            36,
            extra={"lat": loc.get("lat"), "lng": loc.get("lng")},
        )

    for ev in events:
        # The current data model has one OCCURS_AT location per Event.
        # Query it separately so we never invent a location association.
        pass

    for c in cases:
        add_node(c, "Case", c.get("title") or c.get("case_number") or c.get("id"), 40)
        add_edge(c["id"], root["id"], "ASSOCIATED WITH", "case")

    # Add the event -> location links exactly as stored in Neo4j.
    with driver.session() as session:
        event_locations = list(session.run(
            """
            MATCH (e:Event)-[:OCCURS_AT]->(l:Location)
            WHERE e.id IN $event_ids
            RETURN e.id AS event_id, l.id AS location_id
            """,
            event_ids=[e["id"] for e in events],
        ))

        interaction_details = list(session.run(
            """
            MATCH (root:Person {id: $person_id})
            OPTIONAL MATCH (root)-[:OWNS]->(:Phone)-[call:COMMUNICATED]-(:Phone)<-[:OWNS]-(other_call:Person)
            OPTIONAL MATCH (root)-[:HOLDS]->(:BankAccount)-[tx:TRANSACTED]-(:BankAccount)<-[:HOLDS]-(other_tx:Person)
            RETURN collect(DISTINCT {
                person_id: other_call.id,
                label: 'COMMUNICATED',
                kind: 'communication'
            }) + collect(DISTINCT {
                person_id: other_tx.id,
                label: 'TRANSACTED',
                kind: 'transaction'
            }) AS links
            """,
            person_id=person_id,
        ))

    for row in event_locations:
        add_edge(row["event_id"], row["location_id"], "OCCURS AT", "location")

    for row in (interaction_details[0]["links"] if interaction_details else []) or []:
        if not row or not row.get("person_id"):
            continue
        other = next((p for p in related_people if p.get("id") == row["person_id"]), None)
        if other is not None:
            add_node(
                other,
                "Person",
                other.get("full_name") or other.get("id"),
                44,
                other.get("id"),
                {
                    "degree": other.get("degree_centrality"),
                    "betweenness": other.get("betweenness_centrality"),
                    "community": other.get("community_id"),
                },
            )
            add_edge(root["id"], other["id"], row["label"], row["kind"])

    # Optional second hop: add the most useful entities of connected people.
    if hop == 2 and related_people:
        second_hop_query = """
        UNWIND $person_ids AS pid
        MATCH (p:Person {id: pid})
        OPTIONAL MATCH (p)-[:OWNS]->(ph:Phone)
        OPTIONAL MATCH (p)-[:HOLDS]->(acc:BankAccount)
        OPTIONAL MATCH (p)-[:OWNS]->(veh:Vehicle)
        OPTIONAL MATCH (p)-[:USES]->(dev:Device)
        OPTIONAL MATCH (p)-[:WORKS_AT]->(org:Organization)
        RETURN p.id AS person_id,
               collect(DISTINCT ph)[..3] AS phones,
               collect(DISTINCT acc)[..3] AS accounts,
               collect(DISTINCT veh)[..2] AS vehicles,
               collect(DISTINCT dev)[..2] AS devices,
               collect(DISTINCT org)[..2] AS orgs
        """
        with driver.session() as session:
            second_rows = list(session.run(
                second_hop_query,
                person_ids=[p["id"] for p in related_people],
            ))

        for row in second_rows:
            pid = row["person_id"]
            for ph in [x for x in row["phones"] if x is not None]:
                add_node(ph, "Phone", ph.get("number") or ph.get("id"), 28)
                add_edge(pid, ph["id"], "OWNS", "ownership")
            for acc in [x for x in row["accounts"] if x is not None]:
                add_node(acc, "Account", acc.get("account_no") or acc.get("id"), 28)
                add_edge(pid, acc["id"], "HOLDS", "ownership")
            for veh in [x for x in row["vehicles"] if x is not None]:
                add_node(veh, "Vehicle", veh.get("plate_no") or veh.get("model") or veh.get("id"), 28)
                add_edge(pid, veh["id"], "OWNS", "ownership")
            for dev in [x for x in row["devices"] if x is not None]:
                add_node(dev, "Device", dev.get("device_type") or dev.get("imei") or dev.get("id"), 26)
                add_edge(pid, dev["id"], "USES", "usage")
            for org in [x for x in row["orgs"] if x is not None]:
                add_node(org, "Organization", org.get("name") or org.get("id"), 30)
                add_edge(pid, org["id"], "WORKS AT", "organization")

    elements = [{"data": node} for node in nodes.values()]
    elements += [
        {
            "data": {
                "id": f"edge::{i}",
                "source": edge["source"],
                "target": edge["target"],
                "label": edge["label"],
                "kind": edge["kind"],
            }
        }
        for i, edge in enumerate(edges.values())
    ]

    return {"elements": elements}
