"""
Trace — enrich existing Neo4j person profiles.

Purpose:
- Enrich the EXISTING Person nodes in Neo4j.
- Does NOT regenerate the graph.
- Does NOT delete or modify calls, transactions, findings, communities, or analytics.
- Adds missing/blank profile fields:
    date_of_birth, occupation, address, city, aliases, bio
- Ensures demo-friendly Vehicle and Device records exist for people who
  currently have none.
- Uses the existing .env:
    NEO4J_URI
    NEO4J_USERNAME
    NEO4J_PASSWORD

Run from the folder containing .env:
    python enrich_person_profiles.py
"""

import os
import random
from datetime import date, timedelta

from dotenv import load_dotenv
from faker import Faker
from neo4j import GraphDatabase


# ------------------------------------------------------------
# CONFIG
# ------------------------------------------------------------
load_dotenv()

NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USERNAME")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

if not all([NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD]):
    raise RuntimeError(
        "Missing NEO4J_URI, NEO4J_USERNAME or NEO4J_PASSWORD in .env"
    )

random.seed(42)
fake = Faker("en_IN")
Faker.seed(42)

CITIES = [
    ("Raipur", "Chhattisgarh"),
    ("Bhilai", "Chhattisgarh"),
    ("Durg", "Chhattisgarh"),
    ("Bilaspur", "Chhattisgarh"),
    ("Rajnandgaon", "Chhattisgarh"),
]

OCCUPATIONS = [
    "Business Owner",
    "Accountant",
    "Sales Executive",
    "Driver",
    "Contractor",
    "Freelancer",
    "Shop Owner",
    "Consultant",
    "Logistics Manager",
    "Software Engineer",
    "Real Estate Agent",
]

VEHICLE_MODELS = [
    "Maruti Swift",
    "Hyundai i20",
    "Honda Activa",
    "Bajaj Pulsar",
    "Tata Nexon",
    "Mahindra Scorpio",
    "Toyota Innova",
]

DEVICE_TYPES = [
    "Android Smartphone",
    "iPhone",
    "Windows Laptop",
    "Tablet",
]


def random_dob():
    """Generate a plausible adult DOB between 21 and 68 years old."""
    today = date.today()
    start = today - timedelta(days=68 * 365)
    end = today - timedelta(days=21 * 365)
    return fake.date_between(start_date=start, end_date=end).isoformat()


def make_address(city):
    """Generate an Indian-style synthetic address."""
    return fake.street_address().replace("\n", ", ")


def profile_for(person_id, full_name):
    """Create deterministic-ish synthetic profile data."""
    # Seed from ID so rerunning the script gives stable-looking data.
    local_seed = sum(ord(c) for c in person_id)
    rng = random.Random(local_seed)

    city, state = rng.choice(CITIES)
    first_name = (full_name or "Person").split()[0]
    last_name = (full_name or "Unknown").split()[-1]

    aliases = []
    if rng.random() < 0.65:
        aliases.append(first_name)
    if rng.random() < 0.35:
        aliases.append(last_name)
    if not aliases:
        aliases.append(first_name)

    bio_templates = [
        f"{full_name} is recorded as a {rng.choice(OCCUPATIONS).lower()} based in {city}. "
        "Profile assembled from investigation records for demonstration purposes.",
        f"Recorded residence in {city}, {state}. Employment and contact information "
        "is derived from the available investigation dataset.",
        f"Investigation profile for {full_name}, with recorded identity, contact, "
        "asset and organizational information.",
    ]

    return {
        "date_of_birth": random_dob(),
        "occupation": rng.choice(OCCUPATIONS),
        "address": make_address(city),
        "city": city,
        "aliases": " / ".join(aliases),
        "bio": rng.choice(bio_templates),
    }


def run():
    print(f"Connecting to Neo4j at {NEO4J_URI} ...")
    driver = GraphDatabase.driver(
        NEO4J_URI,
        auth=(NEO4J_USER, NEO4J_PASSWORD),
    )

    try:
        # ----------------------------------------------------
        # STEP 1 — Enrich existing people
        # ----------------------------------------------------
        print("\nStep 1: Reading existing people...")

        with driver.session() as session:
            people = [
                dict(record)
                for record in session.run(
                    """
                    MATCH (p:Person)
                    RETURN p.id AS id, p.full_name AS full_name
                    ORDER BY p.id
                    """
                )
            ]

        if not people:
            print("No Person nodes found. Load your Neo4j dataset first.")
            return

        print(f"  -> found {len(people)} people")

        updates = []
        for person in people:
            profile = profile_for(person["id"], person["full_name"])
            updates.append(
                {
                    "id": person["id"],
                    **profile,
                }
            )

        with driver.session() as session:
            session.run(
                """
                UNWIND $rows AS row
                MATCH (p:Person {id: row.id})
                SET p.date_of_birth = coalesce(p.date_of_birth, row.date_of_birth),
                    p.occupation = coalesce(p.occupation, row.occupation),
                    p.address = coalesce(p.address, row.address),
                    p.city = coalesce(p.city, row.city),
                    p.aliases = coalesce(p.aliases, row.aliases),
                    p.bio = coalesce(p.bio, row.bio)
                """,
                rows=updates,
            )

        print(f"  -> enriched {len(updates)} Person profiles")

        # ----------------------------------------------------
        # STEP 2 — Add missing vehicles
        # ----------------------------------------------------
        print("\nStep 2: Checking vehicle records...")

        with driver.session() as session:
            people_without_vehicle = [
                dict(record)
                for record in session.run(
                    """
                    MATCH (p:Person)
                    WHERE NOT (p)-[:OWNS]->(:Vehicle)
                    RETURN p.id AS id, p.full_name AS full_name
                    ORDER BY p.id
                    """
                )
            ]

        print(
            f"  -> {len(people_without_vehicle)} people currently have no vehicle"
        )

        vehicle_rows = []
        for i, person in enumerate(people_without_vehicle):
            # Give most people a vehicle, but leave a realistic minority without one.
            rng = random.Random(sum(ord(c) for c in person["id"]) + 1000)
            if rng.random() > 0.78:
                continue

            vehicle_rows.append(
                {
                    "id": f"profile_vehicle_{i:05d}",
                    "person_id": person["id"],
                    "plate_no": fake.bothify(
                        text="??##??####"
                    ).upper(),
                    "model": rng.choice(VEHICLE_MODELS),
                }
            )

        if vehicle_rows:
            with driver.session() as session:
                session.run(
                    """
                    UNWIND $rows AS row
                    MERGE (v:Vehicle {id: row.id})
                    SET v.plate_no = row.plate_no,
                        v.model = row.model
                    WITH v, row
                    MATCH (p:Person {id: row.person_id})
                    MERGE (p)-[:OWNS]->(v)
                    """,
                    rows=vehicle_rows,
                )

        print(f"  -> added {len(vehicle_rows)} vehicle records")

        # ----------------------------------------------------
        # STEP 3 — Add missing devices
        # ----------------------------------------------------
        print("\nStep 3: Checking device records...")

        with driver.session() as session:
            people_without_device = [
                dict(record)
                for record in session.run(
                    """
                    MATCH (p:Person)
                    WHERE NOT (p)-[:USES]->(:Device)
                    RETURN p.id AS id, p.full_name AS full_name
                    ORDER BY p.id
                    """
                )
            ]

        print(
            f"  -> {len(people_without_device)} people currently have no device"
        )

        device_rows = []
        for i, person in enumerate(people_without_device):
            # Give almost everyone a device for a richer demo profile.
            rng = random.Random(sum(ord(c) for c in person["id"]) + 2000)
            if rng.random() > 0.92:
                continue

            device_rows.append(
                {
                    "id": f"profile_device_{i:05d}",
                    "person_id": person["id"],
                    "imei": fake.numerify(text="###############"),
                    "device_type": rng.choice(DEVICE_TYPES),
                }
            )

        if device_rows:
            with driver.session() as session:
                session.run(
                    """
                    UNWIND $rows AS row
                    MERGE (d:Device {id: row.id})
                    SET d.imei = row.imei,
                        d.device_type = row.device_type
                    WITH d, row
                    MATCH (p:Person {id: row.person_id})
                    MERGE (p)-[:USES]->(d)
                    """,
                    rows=device_rows,
                )

        print(f"  -> added {len(device_rows)} device records")

        # ----------------------------------------------------
        # STEP 4 — Guarantee the most important demo people
        # ----------------------------------------------------
        print("\nStep 4: Making sure top network connectors have rich profiles...")

        with driver.session() as session:
            top_people = [
                dict(record)
                for record in session.run(
                    """
                    MATCH (p:Person)
                    WHERE p.betweenness_centrality IS NOT NULL
                    RETURN p.id AS id, p.full_name AS full_name
                    ORDER BY p.betweenness_centrality DESC
                    LIMIT 10
                    """
                )
            ]

            for person in top_people:
                # Vehicle
                session.run(
                    """
                    MATCH (p:Person {id: $id})
                    WHERE NOT (p)-[:OWNS]->(:Vehicle)
                    CREATE (v:Vehicle {
                        id: 'demo_vehicle_' + replace($id, 'person_', ''),
                        plate_no: $plate_no,
                        model: $model
                    })
                    MERGE (p)-[:OWNS]->(v)
                    """,
                    id=person["id"],
                    plate_no=fake.bothify(text="CG##??####").upper(),
                    model=random.choice(VEHICLE_MODELS),
                )

                # Device
                session.run(
                    """
                    MATCH (p:Person {id: $id})
                    WHERE NOT (p)-[:USES]->(:Device)
                    CREATE (d:Device {
                        id: 'demo_device_' + replace($id, 'person_', ''),
                        imei: $imei,
                        device_type: $device_type
                    })
                    MERGE (p)-[:USES]->(d)
                    """,
                    id=person["id"],
                    imei=fake.numerify(text="###############"),
                    device_type=random.choice(DEVICE_TYPES),
                )

        print(f"  -> checked {len(top_people)} top network connectors")

        # ----------------------------------------------------
        # STEP 5 — Verification
        # ----------------------------------------------------
        print("\nStep 5: Verifying profile coverage...")

        with driver.session() as session:
            result = session.run(
                """
                MATCH (p:Person)
                OPTIONAL MATCH (p)-[:OWNS]->(v:Vehicle)
                OPTIONAL MATCH (p)-[:USES]->(d:Device)
                RETURN
                    count(p) AS people,
                    count(DISTINCT CASE WHEN p.date_of_birth IS NOT NULL THEN p END) AS dob,
                    count(DISTINCT CASE WHEN p.occupation IS NOT NULL THEN p END) AS occupation,
                    count(DISTINCT CASE WHEN p.address IS NOT NULL THEN p END) AS address,
                    count(DISTINCT CASE WHEN p.city IS NOT NULL THEN p END) AS city,
                    count(DISTINCT CASE WHEN p.aliases IS NOT NULL THEN p END) AS aliases,
                    count(DISTINCT CASE WHEN p.bio IS NOT NULL THEN p END) AS bio,
                    count(DISTINCT v) AS vehicles,
                    count(DISTINCT d) AS devices
                """
            ).single()

        print("\n================ PROFILE COVERAGE ================")
        print(f"People:        {result['people']}")
        print(f"DOB:           {result['dob']}")
        print(f"Occupation:    {result['occupation']}")
        print(f"Address:       {result['address']}")
        print(f"City:          {result['city']}")
        print(f"Aliases:       {result['aliases']}")
        print(f"Bio:           {result['bio']}")
        print(f"Vehicles:      {result['vehicles']}")
        print(f"Devices:       {result['devices']}")

        print("\nDone.")
        print("Refresh Trace and open a person's full profile.")
        print("Existing findings, calls, transactions and analytics were left untouched.")

    finally:
        driver.close()


if __name__ == "__main__":
    run()
