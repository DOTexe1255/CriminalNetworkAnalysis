"""
Trace — Investigation Analytics v2

Reads the connected investigation graph from Neo4j, computes graph structure
and evidence-backed investigation findings, then writes those findings back
into Neo4j.

Findings generated:
- Bridge Entity
- Community Connector
- Activity Spike
- Transaction Pattern
- Cross-Case Connection

IMPORTANT:
These are analytical observations, NOT criminality predictions or guilt scores.
Every finding is linked to the Person(s) involved and supporting Evidence nodes.

Requires:
    pip install neo4j networkx python-dotenv

Uses the same .env credentials as the working loader:
    NEO4J_URI=...
    NEO4J_USERNAME=...
    NEO4J_PASSWORD=...

Run:
    python run_analytics_v2.py
"""

import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import networkx as nx
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USERNAME")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

if not all([NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD]):
    raise RuntimeError(
        "Missing Neo4j credentials. Set NEO4J_URI, NEO4J_USERNAME and "
        "NEO4J_PASSWORD in .env."
    )


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def parse_dt(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def safe_title(person_id, names):
    return names.get(person_id, person_id)


def top_evidence_for_people(evidence_by_person, people, limit=6, allowed_types=None):
    rows = []
    seen = set()
    for person_id in people:
        for ev in evidence_by_person.get(person_id, []):
            if allowed_types and ev["evidence_type"] not in allowed_types:
                continue
            if ev["id"] in seen:
                continue
            seen.add(ev["id"])
            rows.append(ev)
    rows.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
    return [x["id"] for x in rows[:limit]]


def add_finding(findings, finding_id, finding_type, title, description,
                people, evidence_ids, importance="Medium", case_ids=None):
    findings.append({
        "id": finding_id,
        "finding_type": finding_type,
        "title": title,
        "description": description,
        "importance": importance,
        "person_ids": list(dict.fromkeys(people)),
        "evidence_ids": list(dict.fromkeys(evidence_ids)),
        "case_ids": list(dict.fromkeys(case_ids or [])),
    })


def main():
    print(f"Connecting to Neo4j at {NEO4J_URI} ...")
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

    try:
        # ------------------------------------------------------------------
        # STEP 1 — Pull people and person-to-person interactions
        # ------------------------------------------------------------------
        print("\nStep 1: Pulling investigation data from Neo4j...")

        with driver.session() as session:
            people_rows = list(session.run(
                "MATCH (p:Person) RETURN p.id AS id, p.full_name AS name"
            ))

            call_rows = list(session.run("""
                MATCH (p1:Person)-[:OWNS]->(ph1:Phone)
                      -[r:COMMUNICATED]-(ph2:Phone)<-[:OWNS]-(p2:Person)
                WHERE p1.id < p2.id
                RETURN p1.id AS person_a, p2.id AS person_b,
                       r.timestamp AS timestamp, r.duration_sec AS duration_sec
            """))

            txn_rows = list(session.run("""
                MATCH (p1:Person)-[:HOLDS]->(a:BankAccount)
                      -[r:TRANSACTED]->(b:BankAccount)<-[:HOLDS]-(p2:Person)
                WHERE p1.id <> p2.id
                RETURN p1.id AS person_a, p2.id AS person_b,
                       r.timestamp AS timestamp, r.amount AS amount
            """))

            evidence_rows = list(session.run("""
                MATCH (ev:Evidence)-[:INVOLVES]->(p:Person)
                OPTIONAL MATCH (c:Case)-[:HAS_EVIDENCE]->(ev)
                RETURN ev.id AS id,
                       ev.evidence_type AS evidence_type,
                       ev.source_record_id AS source_record_id,
                       ev.timestamp AS timestamp,
                       ev.description AS description,
                       p.id AS person_id,
                       c.id AS case_id
            """))

            case_rows = list(session.run("""
                MATCH (c:Case)-[r:ASSOCIATED_WITH]->(p:Person)
                RETURN c.id AS case_id, c.title AS case_title,
                       p.id AS person_id, r.role AS role
            """))

        names = {r["id"]: r["name"] or r["id"] for r in people_rows}
        print(f"  -> {len(names)} people")
        print(f"  -> {len(call_rows)} communication interactions")
        print(f"  -> {len(txn_rows)} transaction interactions")
        print(f"  -> {len(evidence_rows)} evidence links")
        print(f"  -> {len(case_rows)} case-person links")

        # ------------------------------------------------------------------
        # STEP 2 — Build NetworkX graph
        # ------------------------------------------------------------------
        print("\nStep 2: Building the investigation graph...")
        G = nx.Graph()
        G.add_nodes_from(names.keys())

        pair_stats = defaultdict(lambda: {"calls": 0, "transactions": 0, "amount": 0.0})
        activity_by_person = defaultdict(list)

        for row in call_rows:
            a, b = row["person_a"], row["person_b"]
            G.add_edge(a, b)
            key = tuple(sorted((a, b)))
            pair_stats[key]["calls"] += 1
            ts = parse_dt(row["timestamp"])
            if ts:
                activity_by_person[a].append(ts)
                activity_by_person[b].append(ts)

        for row in txn_rows:
            a, b = row["person_a"], row["person_b"]
            G.add_edge(a, b)
            key = tuple(sorted((a, b)))
            pair_stats[key]["transactions"] += 1
            pair_stats[key]["amount"] += float(row["amount"] or 0)
            ts = parse_dt(row["timestamp"])
            if ts:
                activity_by_person[a].append(ts)
                activity_by_person[b].append(ts)

        print(f"  -> graph: {G.number_of_nodes()} people, {G.number_of_edges()} connections")

        if G.number_of_nodes() == 0:
            print("No people found. Check that the v2 dataset was loaded first.")
            return

        # ------------------------------------------------------------------
        # STEP 3 — Graph analytics
        # ------------------------------------------------------------------
        print("\nStep 3: Running graph analytics...")
        degree = nx.degree_centrality(G)
        betweenness = nx.betweenness_centrality(G)
        communities = nx.community.louvain_communities(G, seed=42)

        community_map = {}
        for idx, members in enumerate(communities):
            for pid in members:
                community_map[pid] = idx

        print(f"  -> found {len(communities)} communities")

        # Persist the base metrics first.
        update_rows = [
            {
                "id": pid,
                "degree_centrality": degree.get(pid, 0.0),
                "betweenness_centrality": betweenness.get(pid, 0.0),
                "community_id": community_map.get(pid, -1),
            }
            for pid in G.nodes()
        ]

        # ------------------------------------------------------------------
        # STEP 4 — Organise evidence + cases
        # ------------------------------------------------------------------
        evidence_by_person = defaultdict(list)
        for row in evidence_rows:
            ev = {
                "id": row["id"],
                "evidence_type": row["evidence_type"],
                "source_record_id": row["source_record_id"],
                "timestamp": str(row["timestamp"]) if row["timestamp"] else None,
                "description": row["description"] or "",
                "case_id": row["case_id"],
            }
            evidence_by_person[row["person_id"]].append(ev)

        cases_by_person = defaultdict(set)
        case_titles = {}
        for row in case_rows:
            cases_by_person[row["person_id"]].add(row["case_id"])
            case_titles[row["case_id"]] = row["case_title"] or row["case_id"]

        # ------------------------------------------------------------------
        # STEP 5 — Generate investigation findings
        # ------------------------------------------------------------------
        print("\nStep 4: Generating evidence-backed findings...")
        findings = []

        # 5A. Bridge entities — top structural connectors.
        ranked_bridge = sorted(betweenness.items(), key=lambda x: x[1], reverse=True)
        for rank, (pid, score) in enumerate(ranked_bridge[:5], start=1):
            if score <= 0:
                continue
            neighbor_communities = sorted({community_map[n] for n in G.neighbors(pid)})
            ev_ids = top_evidence_for_people(
                evidence_by_person, [pid], limit=6,
                allowed_types={"Call Record", "Financial Record", "Location Event"}
            )
            importance = "High" if rank <= 2 else "Medium"
            add_finding(
                findings,
                f"finding_bridge_{rank}",
                "Bridge Entity",
                f"{safe_title(pid, names)} connects multiple network groups",
                f"This person has a high betweenness score ({score:.3f}) and links "
                f"activity across {len(neighbor_communities)} detected communities. "
                "This is a structural network observation, not a conclusion about wrongdoing.",
                [pid], ev_ids, importance,
                sorted(cases_by_person.get(pid, set()))
            )

        # 5B. Community connector — explicitly compare neighbor community IDs.
        connector_candidates = []
        for pid in G.nodes():
            own = community_map.get(pid, -1)
            other = {community_map.get(n, -1) for n in G.neighbors(pid) if community_map.get(n, -1) != own}
            if other:
                connector_candidates.append((pid, len(other), betweenness.get(pid, 0)))

        connector_candidates.sort(key=lambda x: (x[1], x[2]), reverse=True)
        for rank, (pid, other_count, score) in enumerate(connector_candidates[:5], start=1):
            ev_ids = top_evidence_for_people(evidence_by_person, [pid], limit=5)
            add_finding(
                findings,
                f"finding_connector_{rank}",
                "Community Connector",
                f"{safe_title(pid, names)} links separate communities",
                f"The entity has direct relationships reaching {other_count} community groups "
                f"outside its primary community. Betweenness: {score:.3f}.",
                [pid], ev_ids,
                "High" if rank == 1 else "Medium",
                sorted(cases_by_person.get(pid, set()))
            )

        # 5C. Activity spikes — compare planted 7-day window against earlier activity.
        all_times = [ts for values in activity_by_person.values() for ts in values]
        if all_times:
            latest = max(all_times)
            window_start = latest - timedelta(days=7)
            baseline_start = latest - timedelta(days=90)
            activity_candidates = []

            for pid, timestamps in activity_by_person.items():
                recent = sum(1 for ts in timestamps if ts >= window_start)
                baseline = sum(1 for ts in timestamps if baseline_start <= ts < window_start)
                # Expected weekly activity from the preceding 83 days.
                expected_week = baseline / max(83 / 7, 1)
                ratio = recent / max(expected_week, 1.0)
                if recent >= 8 and ratio >= 2.0:
                    activity_candidates.append((pid, recent, baseline, ratio))

            activity_candidates.sort(key=lambda x: (x[3], x[1]), reverse=True)
            for rank, (pid, recent, baseline, ratio) in enumerate(activity_candidates[:5], start=1):
                ev_ids = top_evidence_for_people(evidence_by_person, [pid], limit=6)
                add_finding(
                    findings,
                    f"finding_activity_{rank}",
                    "Activity Spike",
                    f"{safe_title(pid, names)} shows elevated recent activity",
                    f"{recent} communication/transaction interactions occurred in the latest 7-day "
                    f"window versus {baseline} during the preceding baseline period "
                    f"(about {ratio:.1f}× the expected weekly level).",
                    [pid], ev_ids, "High" if rank == 1 else "Medium",
                    sorted(cases_by_person.get(pid, set()))
                )

        # 5D. Transaction patterns — strong repeated pair-level financial interaction.
        transaction_candidates = []
        for (a, b), stats in pair_stats.items():
            if stats["transactions"] >= 5 and stats["amount"] >= 100000:
                transaction_candidates.append((a, b, stats))

        transaction_candidates.sort(
            key=lambda x: (x[2]["transactions"], x[2]["amount"]), reverse=True
        )
        for rank, (a, b, stats) in enumerate(transaction_candidates[:5], start=1):
            ev_ids = top_evidence_for_people(
                evidence_by_person, [a, b], limit=8,
                allowed_types={"Financial Record"}
            )
            case_ids = sorted(cases_by_person.get(a, set()) | cases_by_person.get(b, set()))
            add_finding(
                findings,
                f"finding_transaction_{rank}",
                "Transaction Pattern",
                f"Repeated financial interaction: {safe_title(a, names)} ↔ {safe_title(b, names)}",
                f"The pair has {stats['transactions']} recorded transfers totaling "
                f"INR {stats['amount']:,.2f}. This identifies a notable interaction pattern "
                "for investigator review; it does not imply illegality.",
                [a, b], ev_ids,
                "High" if rank <= 2 else "Medium", case_ids
            )

        # 5E. Cross-case connections — people appearing in multiple cases.
        cross_case_people = [
            (pid, sorted(case_ids))
            for pid, case_ids in cases_by_person.items()
            if len(case_ids) >= 2
        ]
        cross_case_people.sort(key=lambda x: len(x[1]), reverse=True)

        for rank, (pid, case_ids) in enumerate(cross_case_people[:10], start=1):
            ev_ids = top_evidence_for_people(
                evidence_by_person, [pid], limit=8,
                allowed_types={"Cross-Case Link", "Call Record", "Financial Record", "Location Event"}
            )
            case_names = ", ".join(case_titles.get(cid, cid) for cid in case_ids)
            add_finding(
                findings,
                f"finding_cross_case_{rank}",
                "Cross-Case Connection",
                f"{safe_title(pid, names)} appears across {len(case_ids)} cases",
                f"This entity is associated with multiple investigations: {case_names}. "
                "The overlap is surfaced for cross-case review and does not itself establish a connection between case events.",
                [pid], ev_ids, "High" if rank <= 3 else "Medium", case_ids
            )

        print(f"  -> generated {len(findings)} findings")

        # ------------------------------------------------------------------
        # STEP 6 — Write metrics + findings into Neo4j
        # ------------------------------------------------------------------
        print("\nStep 5: Saving analytics and findings to Neo4j...")
        with driver.session() as session:
            # Ensure Finding IDs are unique.
            session.run(
                "CREATE CONSTRAINT IF NOT EXISTS FOR (f:Finding) REQUIRE f.id IS UNIQUE"
            )

            session.run("""
                UNWIND $rows AS row
                MATCH (p:Person {id: row.id})
                SET p.degree_centrality = row.degree_centrality,
                    p.betweenness_centrality = row.betweenness_centrality,
                    p.community_id = row.community_id
            """, rows=update_rows)

            # Re-running analytics should not leave stale findings behind.
            session.run("MATCH (f:Finding) DETACH DELETE f")

            for finding in findings:
                session.run("""
                    CREATE (f:Finding {
                        id: $id,
                        finding_type: $finding_type,
                        title: $title,
                        description: $description,
                        importance: $importance,
                        created_at: datetime()
                    })
                    WITH f
                    UNWIND $person_ids AS person_id
                    MATCH (p:Person {id: person_id})
                    MERGE (f)-[:ABOUT]->(p)
                """, **finding)

                if finding["evidence_ids"]:
                    session.run("""
                        MATCH (f:Finding {id: $finding_id})
                        UNWIND $evidence_ids AS evidence_id
                        MATCH (ev:Evidence {id: evidence_id})
                        MERGE (f)-[:SUPPORTED_BY]->(ev)
                    """, finding_id=finding["id"], evidence_ids=finding["evidence_ids"])

                if finding["case_ids"]:
                    session.run("""
                        MATCH (f:Finding {id: $finding_id})
                        UNWIND $case_ids AS case_id
                        MATCH (c:Case {id: case_id})
                        MERGE (c)-[:HAS_FINDING]->(f)
                    """, finding_id=finding["id"], case_ids=finding["case_ids"])

        # ------------------------------------------------------------------
        # STEP 7 — Print demo-ready findings
        # ------------------------------------------------------------------
        print("\n================ TRACE FINDINGS ================")
        for finding in findings[:15]:
            print(f"[{finding['importance']}] {finding['finding_type']}: {finding['title']}")
            print(f"  {finding['description']}")
            print(f"  Evidence: {len(finding['evidence_ids'])} | Cases: {len(finding['case_ids'])}")

        print("\nDone. Neo4j now contains Person metrics + Finding nodes.")
        print("Try these queries in Neo4j Browser:")
        print("  MATCH (f:Finding) RETURN f ORDER BY f.importance")
        print("  MATCH (f:Finding)-[:ABOUT]->(p:Person) RETURN f.title, p.full_name, f.finding_type")
        print("  MATCH (f:Finding)-[:SUPPORTED_BY]->(ev:Evidence) RETURN f.title, ev.description LIMIT 50")

    finally:
        driver.close()


if __name__ == "__main__":
    main()
