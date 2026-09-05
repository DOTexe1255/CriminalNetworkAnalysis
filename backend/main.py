import os
import json
from pathlib import Path
from typing import Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase
from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()

NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USERNAME")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

if not all([NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD]):
    raise RuntimeError("Missing NEO4J_URI, NEO4J_USERNAME or NEO4J_PASSWORD in .env")

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
CASE_STORE = Path(__file__).with_name("mock_cases.json")


class CaseCreate(BaseModel):
    name: str = Field(min_length=2)
    description: str = ""
    status: str = "Active"
    priority: str = "Medium"
    lead: str = ""
    documents: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []


def read_mock_cases() -> list[dict[str, Any]]:
    try:
        return json.loads(CASE_STORE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def write_mock_cases(cases: list[dict[str, Any]]) -> None:
    CASE_STORE.write_text(json.dumps(cases, indent=2), encoding="utf-8")

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
    cases = read_mock_cases()
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
        known = {case["id"] for case in cases}
        cases.extend(case for case in neo4j_cases if case.get("id") not in known)
    except Exception:
        pass
    return cases


@app.post("/api/cases")
def create_case(payload: CaseCreate):
    cases = read_mock_cases()
    case = {
        "id": f"case_{len(cases):05d}",
        **payload.model_dump(),
        "created_at": __import__("datetime").date.today().isoformat(),
        "person_count": 0,
        "finding_count": 0,
    }
    cases.insert(0, case)
    write_mock_cases(cases)
    return case


@app.get("/api/case/{case_id}")
def get_case(case_id: str):
    case = next((item for item in read_mock_cases() if item.get("id") == case_id), None)
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
