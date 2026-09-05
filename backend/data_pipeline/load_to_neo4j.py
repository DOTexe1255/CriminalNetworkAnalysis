"""
Loads the mock CSV files (from generate_mock_data.py) into Neo4j.

WHAT THIS SCRIPT DOES (plain English):
Reads all the CSV files in the "output" folder and creates them as a
connected web inside Neo4j -- people become dots (called "nodes"), and
their relationships (owns, calls, works_at, etc.) become the lines
connecting those dots (called "relationships" or "edges").

BEFORE YOU RUN THIS:
1. You need a running Neo4j database. Either:
   a) Neo4j AuraDB (free, cloud) -- sign up at neo4j.com/cloud/aura,
      create a free instance, and copy the connection URI + password
      it gives you, OR
   b) A local Neo4j running via Docker:
      docker run -d --name neo4j-sih -p 7474:7474 -p 7687:7687 \
        -e NEO4J_AUTH=neo4j/yourpassword \
        -e NEO4J_PLUGINS='["graph-data-science"]' \
        neo4j:latest

2. Fill in the connection details in the CONFIG section below.

3. pip install neo4j

4. Run: python load_to_neo4j.py

WHAT "MERGE" MEANS BELOW:
Every load uses MERGE instead of CREATE. MERGE means "create this if it
doesn't already exist, otherwise just use the existing one." This makes
the script safe to re-run if something goes wrong halfway through --
you won't end up with duplicate people or duplicate connections.
"""

import csv
import os
from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()

# ============================================================
# CONFIG -- fill these in with your own Neo4j connection details
# ============================================================
NEO4J_URI = os.environ.get("NEO4J_URI")
NEO4J_USER = os.environ.get("NEO4J_USERNAME")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD")
DATA_DIR = "output_v2"

if not all([NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD]):
    raise RuntimeError("Missing NEO4J_URI, NEO4J_USERNAME, or NEO4J_PASSWORD in .env")
BATCH_SIZE = 500   # how many rows we send to Neo4j at once -- keeps things fast


def read_csv(filename):
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        print(f"  (skipping {filename} -- file not found)")
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def batched(rows, size):
    for i in range(0, len(rows), size):
        yield rows[i:i + size]


class Loader:
    def __init__(self, uri, user, password):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))

    def close(self):
        self.driver.close()

    def run_batches(self, label, rows, cypher):
        """Sends rows to Neo4j in batches, running the given Cypher query for each batch."""
        if not rows:
            return
        total = 0
        with self.driver.session() as session:
            for batch in batched(rows, BATCH_SIZE):
                session.run(cypher, rows=batch)
                total += len(batch)
        print(f"  -> {label}: loaded {total} rows")

    def create_constraints(self):
        """
        Uniqueness constraints stop duplicate nodes and make lookups much faster.
        Think of this like telling Neo4j 'no two Person nodes can have the same id'.
        """
        constraints = [
            "CREATE CONSTRAINT IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (p:Phone) REQUIRE p.id IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (a:BankAccount) REQUIRE a.id IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (v:Vehicle) REQUIRE v.id IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (d:Device) REQUIRE d.id IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (o:Organization) REQUIRE o.id IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (l:Location) REQUIRE l.id IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (c:Case) REQUIRE c.id IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (ev:Evidence) REQUIRE ev.id IS UNIQUE",
        ]
        with self.driver.session() as session:
            for c in constraints:
                session.run(c)
        print("Constraints created.\n")


def main():
    print(f"Connecting to Neo4j at {NEO4J_URI} ...")
    loader = Loader(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)

    try:
        print("\nStep 1: Setting up constraints (prevents duplicates, speeds up loading)...")
        loader.create_constraints()

        # --------------------------------------------------
        # STEP 2: Load all the "dots" (nodes) first
        # --------------------------------------------------
        print("Step 2: Loading nodes (people, phones, accounts, etc.)...")

        loader.run_batches(
            "Person",
            read_csv("persons.csv"),
            """
            UNWIND $rows AS row
            MERGE (p:Person {id: row.id})
            SET p.full_name = row.full_name,
                p.national_id = row.national_id,
                p.date_of_birth = row.date_of_birth,
                p.occupation = row.occupation,
                p.address = row.address,
                p.city = row.city,
                p.aliases = row.aliases,
                p.bio = row.bio,
                p.community_id = toInteger(row.community_id)
            """,
        )

        loader.run_batches(
            "Phone",
            read_csv("phones.csv"),
            """
            UNWIND $rows AS row
            MERGE (ph:Phone {id: row.id})
            SET ph.number = row.number, ph.carrier = row.carrier
            WITH ph, row
            MATCH (owner:Person {id: row.owner_person_id})
            MERGE (owner)-[:OWNS]->(ph)
            """,
        )

        loader.run_batches(
            "BankAccount",
            read_csv("bank_accounts.csv"),
            """
            UNWIND $rows AS row
            MERGE (a:BankAccount {id: row.id})
            SET a.account_no = row.account_no, a.bank_name = row.bank_name
            WITH a, row
            CALL {
                WITH a, row
                WITH a, row WHERE row.owner_type = 'person'
                MATCH (owner:Person {id: row.owner_id})
                MERGE (owner)-[:HOLDS]->(a)
            }
            """,
        )

        loader.run_batches(
            "Vehicle",
            read_csv("vehicles.csv"),
            """
            UNWIND $rows AS row
            MERGE (v:Vehicle {id: row.id})
            SET v.plate_no = row.plate_no, v.model = row.model
            WITH v, row
            MATCH (owner:Person {id: row.owner_person_id})
            MERGE (owner)-[:OWNS]->(v)
            """,
        )

        loader.run_batches(
            "Device",
            read_csv("devices.csv"),
            """
            UNWIND $rows AS row
            MERGE (d:Device {id: row.id})
            SET d.imei = row.imei, d.device_type = row.device_type
            WITH d, row
            MATCH (owner:Person {id: row.owner_person_id})
            MERGE (owner)-[:USES]->(d)
            """,
        )

        loader.run_batches(
            "Organization",
            read_csv("organizations.csv"),
            """
            UNWIND $rows AS row
            MERGE (o:Organization {id: row.id})
            SET o.name = row.name, o.org_type = row.org_type
            """,
        )

        loader.run_batches(
            "Location",
            read_csv("locations.csv"),
            """
            UNWIND $rows AS row
            MERGE (l:Location {id: row.id})
            SET l.label = row.label, l.lat = toFloat(row.lat), l.lng = toFloat(row.lng)
            """,
        )

        loader.run_batches(
            "Event",
            read_csv("events.csv"),
            """
            UNWIND $rows AS row
            MERGE (e:Event {id: row.id})
            SET e.event_type = row.event_type, e.occurred_at = datetime(row.occurred_at)
            WITH e, row
            MATCH (l:Location {id: row.location_id})
            MERGE (e)-[:OCCURS_AT]->(l)
            """,
        )

        # --------------------------------------------------
        # STEP 3: Load cases and evidence
        # --------------------------------------------------
        print("\nStep 3: Loading investigation cases and evidence...")

        loader.run_batches(
            "Case",
            read_csv("cases.csv"),
            """
            UNWIND $rows AS row
            MERGE (c:Case {id: row.id})
            SET c.case_number = row.case_number,
                c.title = row.title,
                c.agency = row.agency,
                c.case_type = row.case_type,
                c.status = row.status,
                c.created_at = datetime(row.created_at)
            """,
        )

        loader.run_batches(
            "CASE_PERSON",
            read_csv("case_persons.csv"),
            """
            UNWIND $rows AS row
            MATCH (c:Case {id: row.case_id})
            MATCH (p:Person {id: row.person_id})
            MERGE (c)-[r:ASSOCIATED_WITH]->(p)
            SET r.role = row.role
            """,
        )

        loader.run_batches(
            "Evidence",
            read_csv("evidence.csv"),
            """
            UNWIND $rows AS row
            MERGE (ev:Evidence {id: row.id})
            SET ev.evidence_type = row.evidence_type,
                ev.source_record_id = row.source_record_id,
                ev.timestamp = datetime(row.timestamp),
                ev.description = row.description

            WITH ev, row
            MATCH (c:Case {id: row.case_id})
            MERGE (c)-[:HAS_EVIDENCE]->(ev)

            WITH ev, row
            FOREACH (person_id IN CASE
                WHEN row.entity_ids IS NULL OR row.entity_ids = '' THEN []
                ELSE split(row.entity_ids, '|')
            END |
                MERGE (p:Person {id: person_id})
                MERGE (ev)-[:INVOLVES]->(p)
            )
            """,
        )

        # --------------------------------------------------
        # STEP 4: Load the remaining "lines" (relationships)
        # --------------------------------------------------
        print("\nStep 4: Loading relationships (works at, attended, called, transacted)...")

        loader.run_batches(
            "WORKS_AT",
            read_csv("works_at.csv"),
            """
            UNWIND $rows AS row
            MATCH (p:Person {id: row.person_id})
            MATCH (o:Organization {id: row.organization_id})
            MERGE (p)-[:WORKS_AT]->(o)
            """,
        )

        loader.run_batches(
            "ORG_OWNS_ACCOUNT",
            read_csv("org_owns_account.csv"),
            """
            UNWIND $rows AS row
            MATCH (o:Organization {id: row.organization_id})
            MATCH (a:BankAccount {id: row.account_id})
            MERGE (o)-[:OWNS]->(a)
            """,
        )

        loader.run_batches(
            "PARTICIPATED_IN",
            read_csv("event_participants.csv"),
            """
            UNWIND $rows AS row
            MATCH (p:Person {id: row.person_id})
            MATCH (e:Event {id: row.event_id})
            MERGE (p)-[:PARTICIPATED_IN]->(e)
            """,
        )

        # Communications and transactions carry the "evidence" -- counts, timestamps,
        # durations, amounts -- that later powers the relationship strength score.
        loader.run_batches(
            "COMMUNICATED",
            read_csv("communications.csv"),
            """
            UNWIND $rows AS row
            MATCH (a:Phone {id: row.phone_a_id})
            MATCH (b:Phone {id: row.phone_b_id})
            CREATE (a)-[:COMMUNICATED {
                timestamp: datetime(row.timestamp),
                duration_sec: toInteger(row.duration_sec)
            }]->(b)
            """,
        )

        loader.run_batches(
            "TRANSACTED",
            read_csv("transactions.csv"),
            """
            UNWIND $rows AS row
            MATCH (a:BankAccount {id: row.from_account_id})
            MATCH (b:BankAccount {id: row.to_account_id})
            CREATE (a)-[:TRANSACTED {
                timestamp: datetime(row.timestamp),
                amount: toFloat(row.amount)
            }]->(b)
            """,
        )

        print("\nAll done. Your data is now a connected graph inside Neo4j.")
        print("Open Neo4j Browser and try this query to sanity-check it:")
        print("  MATCH (p:Person)-[r]-() RETURN p, r LIMIT 100")

    finally:
        loader.close()


if __name__ == "__main__":
    main()
