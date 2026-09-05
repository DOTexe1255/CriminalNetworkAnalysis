"""
The backend service. This sits between Neo4j (where the data lives) and
your React app (what the investigator actually sees).

WHAT IT DOES (plain English):
Exposes a few web addresses ("endpoints") that the frontend can ask
questions to, like "give me the graph" or "tell me about this person."
Each endpoint asks Neo4j for the answer and hands it back in a format
the frontend can easily draw on screen.

HOW TO RUN:
1. pip install fastapi uvicorn neo4j
2. Fill in your Neo4j connection details below
3. python main.py
4. Open http://localhost:8000/docs in a browser -- FastAPI automatically
   builds a page there where you can test every endpoint by clicking
   buttons, before your frontend is even wired up. Very useful for
   checking things work before blaming the frontend for a bug.
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase

# ============================================================
# CONFIG -- same Neo4j connection details as the earlier scripts
# ============================================================
from dotenv import load_dotenv

load_dotenv()
NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USERNAME")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

app = FastAPI(title="Criminal Network Intelligence API")

# CORS = "Cross-Origin Resource Sharing". Without this, your browser will
# BLOCK your React app (running on one address, e.g. localhost:5173) from
# talking to this backend (running on a different address, localhost:8000)
# -- browsers refuse this by default as a security measure. This line
# tells the browser "it's fine, allow it." For the hackathon we allow
# everything ("*"); for anything beyond a demo you'd list only your
# actual frontend's address here instead.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
def shutdown():
    driver.close()


# ------------------------------------------------------------
# ENDPOINT 1: Give me the graph to draw
# ------------------------------------------------------------
@app.get("/api/graph")
def get_graph(limit: int = 300):
    """
    Returns people and their connections, already formatted the way
    Cytoscape.js (the library drawing the graph) expects to receive them:
    a flat list of "elements", each either a node (a dot) or an edge (a line).

    'limit' controls how many people to return -- keeps the picture from
    becoming an unreadable mess of thousands of dots at once. For a real
    investigation tool you'd normally show a filtered slice (e.g. "just
    this person's 2-hop neighborhood") rather than everything at once --
    we'll build that next.
    """
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
        [pp IN people | {id: pp.id, name: pp.full_name,
                          degree: pp.degree_centrality,
                          betweenness: pp.betweenness_centrality,
                          community: pp.community_id}] AS nodes,
        collect(DISTINCT {source: p1.id, target: p2.id}) AS edges
    """
    with driver.session() as session:
        result = session.run(query, limit=limit).single()

    if result is None:
        return {"elements": []}

    nodes = result["nodes"]
    edges = result["edges"]

    # Cytoscape wants a flat list where every item is wrapped in {"data": {...}}
    elements = [{"data": n} for n in nodes]
    elements += [
        {"data": {"id": f"{e['source']}-{e['target']}", "source": e["source"], "target": e["target"]}}
        for e in edges
    ]
    return {"elements": elements}


# ------------------------------------------------------------
# ENDPOINT 2: Tell me about this one person (for the detail panel)
# ------------------------------------------------------------
@app.get("/api/person/{person_id}")
def get_person(person_id: str):
    """
    Returns the full profile of one person: their own details, plus a
    summary of what they own and how connected they are. This is what
    populates the side panel when an investigator clicks a dot.
    """
    query = """
    MATCH (p:Person {id: $person_id})
    OPTIONAL MATCH (p)-[:OWNS]->(ph:Phone)
    OPTIONAL MATCH (p)-[:HOLDS]->(acc:BankAccount)
    OPTIONAL MATCH (p)-[:WORKS_AT]->(org:Organization)
    RETURN p.id AS id, p.full_name AS name, p.national_id AS national_id,
           p.degree_centrality AS degree_centrality,
           p.betweenness_centrality AS betweenness_centrality,
           p.community_id AS community_id,
           collect(DISTINCT ph.number) AS phone_numbers,
           collect(DISTINCT acc.account_no) AS bank_accounts,
           collect(DISTINCT org.name) AS organizations
    """
    with driver.session() as session:
        record = session.run(query, person_id=person_id).single()

    if record is None:
        raise HTTPException(status_code=404, detail=f"No person found with id {person_id}")

    return dict(record)


# ------------------------------------------------------------
# ENDPOINT 3: Who are the top connectors? (for a "key people" sidebar/leaderboard)
# ------------------------------------------------------------
@app.get("/api/top-connectors")
def get_top_connectors(by: str = "betweenness", count: int = 10):
    """
    Returns the top N people ranked by importance.
    'by' can be "betweenness" (bridge people, connecting separate groups)
    or "degree" (hub people, with the most direct connections).
    """
    if by not in ("betweenness", "degree"):
        raise HTTPException(status_code=400, detail="'by' must be 'betweenness' or 'degree'")

    field = "betweenness_centrality" if by == "betweenness" else "degree_centrality"

    query = f"""
    MATCH (p:Person)
    WHERE p.{field} IS NOT NULL
    RETURN p.id AS id, p.full_name AS name, p.{field} AS score
    ORDER BY score DESC
    LIMIT $count
    """
    with driver.session() as session:
        records = session.run(query, count=count)
        return [dict(r) for r in records]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
