import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USERNAME")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

if not all([NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD]):
    raise RuntimeError("Missing NEO4J_URI, NEO4J_USERNAME or NEO4J_PASSWORD in .env")

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

app = FastAPI(title="Trace — Criminal Network Intelligence API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
def shutdown():
    driver.close()


@app.get("/api/graph")
def get_graph(limit: int = 150):
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


@app.get("/api/findings")
def get_findings(
    importance: str | None = None,
    finding_type: str | None = None,
    limit: int = 50,
):
    conditions = []
    params = {"limit": limit}

    if importance:
        conditions.append("f.importance = $importance")
        params["importance"] = importance
    if finding_type:
        conditions.append("f.finding_type = $finding_type")
        params["finding_type"] = finding_type

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    query = f"""
    MATCH (f:Finding)
    OPTIONAL MATCH (f)-[:ABOUT]->(p:Person)
    OPTIONAL MATCH (c:Case)-[:HAS_FINDING]->(f)
    OPTIONAL MATCH (f)-[:SUPPORTED_BY]->(ev:Evidence)
    {where}
    WITH f,
        collect(DISTINCT p)[0] AS p,
        count(DISTINCT c) AS case_count,
        count(DISTINCT ev) AS evidence_count
    RETURN f.id AS id,
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
        f.title
    LIMIT $limit
    """

    with driver.session() as session:
        return [dict(r) for r in session.run(query, **params)]


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
    RETURN ev.id AS id,
           ev.evidence_type AS evidence_type,
           ev.timestamp AS timestamp,
           ev.description AS description,
           ev.source_record_id AS source_record_id
    ORDER BY ev.timestamp DESC
    """
    with driver.session() as session:
        return [dict(r) for r in session.run(query, finding_id=finding_id)]


@app.get("/api/cases")
def get_cases():
    query = """
    MATCH (c:Case)
    OPTIONAL MATCH (c)-[:ASSOCIATED_WITH]->(p:Person)
    OPTIONAL MATCH (c)-[:HAS_FINDING]->(f:Finding)
    RETURN c.id AS id,
           c.name AS name,
           c.description AS description,
           count(DISTINCT p) AS person_count,
           count(DISTINCT f) AS finding_count
    ORDER BY c.name
    """
    with driver.session() as session:
        return [dict(r) for r in session.run(query)]


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
    RETURN DISTINCT
           ev.id AS id,
           ev.evidence_type AS evidence_type,
           ev.timestamp AS timestamp,
           ev.description AS description,
           ev.source_record_id AS source_record_id,
           collect(DISTINCT f.title)[0] AS finding_title
    ORDER BY ev.timestamp DESC
    LIMIT $limit
    """
    with driver.session() as session:
        return [dict(r) for r in session.run(query, person_id=person_id, limit=limit)]


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
