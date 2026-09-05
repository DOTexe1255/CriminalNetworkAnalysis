"""
Mock data generator for the criminal network intelligence prototype.

WHAT THIS SCRIPT DOES (plain English):
Generates a fake but realistic-looking set of people, phones, bank accounts,
vehicles, devices, organizations, locations, events, calls, and money
transfers -- all connected to each other -- and saves them as CSV files
(spreadsheet-style files) that you can load into Neo4j.

The data is NOT random noise. It's built around a deliberate "story":
- People are split into a few tight-knit groups (communities)
- A couple of people quietly bridge two groups (your "hidden connector" demo moment)
- A couple of people get boosted activity (your "hub" demo moment)
- A few relationships get extra calls / shared locations / money transfers
  (your "relationship strength" evidence demo moment)

HOW TO RUN:
1. pip install faker networkx pandas
2. python generate_mock_data.py
3. Check the "output" folder for the CSV files
"""

import csv
import os
import random
from datetime import datetime, timedelta

import networkx as nx
from faker import Faker

# ============================================================
# TWEAK THESE NUMBERS TO CHANGE THE SIZE OF YOUR FAKE DATASET
# ============================================================
NUM_COMMUNITIES = 5          # how many "friend groups" / clusters
COMMUNITY_SIZE_RANGE = (40, 70)   # people per group
WITHIN_COMMUNITY_DENSITY = 0.06   # how tightly connected people are inside a group
NUM_BRIDGE_EDGES = 6              # sparse connections BETWEEN groups
NUM_HUB_BOOSTS = 3                # how many people get artificially high connections
NUM_ORGANIZATIONS = 15
NUM_LOCATIONS = 20
DATE_RANGE_DAYS = 90               # spread of fake activity over the last N days
PLANTED_CASE_WINDOW_DAYS = 7        # a short "spike" window for the planted storyline
NUM_CASES = 3
CASE_NAMES = ["Operation Trinetra", "Project Kala Dhan", "Case Vajra"]
CASE_TYPES = ["Organized Crime", "Financial Investigation", "Network Investigation"]
AGENCIES = ["District Intelligence Unit", "Cyber Crime Cell", "Special Investigation Unit"]
OUTPUT_DIR = "output_v2"

fake = Faker("en_IN")   # Indian-style fake names/addresses
random.seed(42)         # keeps output the same every time you run it (remove this line for fresh randomness)

os.makedirs(OUTPUT_DIR, exist_ok=True)


def new_id(prefix, n):
    return f"{prefix}_{n:05d}"


# ------------------------------------------------------------
# STEP 1: Build the underlying "who knows who" graph
# ------------------------------------------------------------
print("Step 1: Building the person-to-person relationship graph...")

community_graphs = []
person_community = {}
person_counter = 0
full_graph = nx.Graph()

for c in range(NUM_COMMUNITIES):
    size = random.randint(*COMMUNITY_SIZE_RANGE)
    g = nx.gnp_random_graph(size, WITHIN_COMMUNITY_DENSITY, seed=random.randint(0, 99999))
    mapping = {i: person_counter + i for i in range(size)}
    g = nx.relabel_nodes(g, mapping)
    for node in g.nodes():
        person_community[node] = c
    full_graph = nx.compose(full_graph, g)
    person_counter += size

all_person_ids = list(full_graph.nodes())

# Add sparse bridge edges BETWEEN communities -- these become your "hidden connector" demo moment
bridge_people = []
for _ in range(NUM_BRIDGE_EDGES):
    c1, c2 = random.sample(range(NUM_COMMUNITIES), 2)
    p1 = random.choice([p for p in all_person_ids if person_community[p] == c1])
    p2 = random.choice([p for p in all_person_ids if person_community[p] == c2])
    full_graph.add_edge(p1, p2)
    bridge_people.extend([p1, p2])

# Boost a few people to be "hubs" -- extra random connections within their own community
hub_people = random.sample(all_person_ids, NUM_HUB_BOOSTS)
for hub in hub_people:
    same_community = [p for p in all_person_ids if person_community[p] == person_community[hub] and p != hub]
    extra_friends = random.sample(same_community, min(8, len(same_community)))
    for friend in extra_friends:
        full_graph.add_edge(hub, friend)

print(f"  -> {len(all_person_ids)} people, {full_graph.number_of_edges()} relationships")
print(f"  -> planted bridge people (note these for your demo): {sorted(set(bridge_people))[:6]}")
print(f"  -> planted hub people (note these for your demo): {hub_people}")


# ------------------------------------------------------------
# STEP 2: Generate person records
# ------------------------------------------------------------
print("Step 2: Generating person profiles...")

persons = []
for pid in all_person_ids:
    persons.append({
        "id": new_id("person", pid),
        "full_name": fake.name(),
        "national_id": fake.unique.bothify(text="??######"),
        "date_of_birth": fake.date_of_birth(minimum_age=21, maximum_age=68).isoformat(),
        "occupation": random.choice([
            "Business Owner", "Accountant", "Sales Executive", "Driver",
            "Contractor", "Freelancer", "Shop Owner", "Consultant",
            "Logistics Manager", "Software Engineer", "Real Estate Agent"
        ]),
        "address": fake.address().replace("\n", ", "),
        "city": random.choice(["Raipur", "Bhilai", "Durg", "Bilaspur", "Rajnandgaon"]),
        "aliases": fake.first_name() + " / " + fake.last_name(),
        "bio": "Private individual; profile assembled from investigation records for demonstration purposes.",
        "community_id": person_community[pid],
    })

person_id_map = {pid: new_id("person", pid) for pid in all_person_ids}


# ------------------------------------------------------------
# STEP 3: Generate phones, bank accounts, vehicles, devices
# ------------------------------------------------------------
print("Step 3: Generating phones, bank accounts, vehicles, devices...")

phones, bank_accounts, vehicles, devices = [], [], [], []
person_to_phone = {}
person_to_accounts = {}

device_pool = []  # some devices get shared between two people on purpose

for i, pid in enumerate(all_person_ids):
    person_id = person_id_map[pid]

    phone_id = new_id("phone", i)
    phones.append({
        "id": phone_id,
        "number": fake.numerify(text="9#########"),
        "carrier": random.choice(["Airtel", "Jio", "Vi", "BSNL"]),
        "owner_person_id": person_id,
    })
    person_to_phone[pid] = phone_id

    num_accounts = random.choices([0, 1, 2], weights=[0.1, 0.7, 0.2])[0]
    account_ids = []
    for a in range(num_accounts):
        acc_id = new_id("account", len(bank_accounts))
        bank_accounts.append({
            "id": acc_id,
            "account_no": fake.numerify(text="##########"),
            "bank_name": random.choice(["SBI", "HDFC", "ICICI", "PNB", "Axis"]),
            "owner_type": "person",
            "owner_id": person_id,
        })
        account_ids.append(acc_id)
    person_to_accounts[pid] = account_ids

    if random.random() < 0.35:
        vehicles.append({
            "id": new_id("vehicle", len(vehicles)),
            "plate_no": fake.bothify(text="??##??####").upper(),
            "model": random.choice(["Maruti Swift", "Hyundai i20", "Honda Activa", "Bajaj Pulsar", "Tata Nexon"]),
            "owner_person_id": person_id,
        })

    if random.random() < 0.3:
        # 20% chance this device is shared with someone else (suspicious evidence!)
        if device_pool and random.random() < 0.2:
            shared_device_id = random.choice(device_pool)
            devices.append({
                "id": shared_device_id,
                "imei": "SHARED",
                "device_type": "shared",
                "owner_person_id": person_id,
            })
        else:
            dev_id = new_id("device", len(devices))
            devices.append({
                "id": dev_id,
                "imei": fake.numerify(text="###############"),
                "device_type": random.choice(["smartphone", "laptop", "tablet"]),
                "owner_person_id": person_id,
            })
            device_pool.append(dev_id)


# ------------------------------------------------------------
# STEP 4: Organizations + employment + org-owned accounts
# ------------------------------------------------------------
print("Step 4: Generating organizations...")

organizations = []
works_at = []
org_owns_account = []

for i in range(NUM_ORGANIZATIONS):
    organizations.append({
        "id": new_id("org", i),
        "name": fake.company(),
        "org_type": random.choice(["Private Ltd", "Trading Firm", "NGO", "Logistics", "Retail"]),
    })

for pid in all_person_ids:
    if random.random() < 0.6:
        org = random.choice(organizations)
        works_at.append({"person_id": person_id_map[pid], "organization_id": org["id"]})

for org in organizations:
    if random.random() < 0.4:
        acc_id = new_id("account", len(bank_accounts))
        bank_accounts.append({
            "id": acc_id,
            "account_no": fake.numerify(text="##########"),
            "bank_name": random.choice(["SBI", "HDFC", "ICICI", "PNB", "Axis"]),
            "owner_type": "organization",
            "owner_id": org["id"],
        })
        org_owns_account.append({"organization_id": org["id"], "account_id": acc_id})


# ------------------------------------------------------------
# STEP 5: Locations + events
# ------------------------------------------------------------
print("Step 5: Generating locations and events...")

# Roughly around Raipur, Chhattisgarh -- change this if your demo references a different city
BASE_LAT, BASE_LNG = 21.2514, 81.6296

locations = []
for i in range(NUM_LOCATIONS):
    locations.append({
        "id": new_id("location", i),
        "label": fake.street_name(),
        "lat": round(BASE_LAT + random.uniform(-0.15, 0.15), 6),
        "lng": round(BASE_LNG + random.uniform(-0.15, 0.15), 6),
    })

start_date = datetime.now() - timedelta(days=DATE_RANGE_DAYS)
case_window_start = datetime.now() - timedelta(days=PLANTED_CASE_WINDOW_DAYS)

events = []
event_participants = []

for pid in all_person_ids:
    num_events = random.randint(1, 4)
    for _ in range(num_events):
        # planted people get extra events clustered in the "case window" -- shows up as an activity spike
        if pid in hub_people or pid in bridge_people:
            occurred_at = case_window_start + timedelta(
                seconds=random.randint(0, PLANTED_CASE_WINDOW_DAYS * 86400)
            )
        else:
            occurred_at = start_date + timedelta(seconds=random.randint(0, DATE_RANGE_DAYS * 86400))

        event_id = new_id("event", len(events))
        events.append({
            "id": event_id,
            "event_type": random.choice(["meeting", "sighting", "travel", "purchase"]),
            "occurred_at": occurred_at.isoformat(),
            "location_id": random.choice(locations)["id"],
        })
        event_participants.append({"event_id": event_id, "person_id": person_id_map[pid]})


# ------------------------------------------------------------
# STEP 6: Communications (calls) -- based on the relationship graph
# ------------------------------------------------------------
print("Step 6: Generating call records...")

communications = []
planted_pairs = set()
for bp in bridge_people:
    for neighbor in full_graph.neighbors(bp):
        planted_pairs.add(tuple(sorted((bp, neighbor))))
for hub in hub_people:
    for neighbor in full_graph.neighbors(hub):
        planted_pairs.add(tuple(sorted((hub, neighbor))))

for p1, p2 in full_graph.edges():
    pair = tuple(sorted((p1, p2)))
    is_planted = pair in planted_pairs
    num_calls = random.randint(20, 60) if is_planted else random.randint(2, 15)

    for _ in range(num_calls):
        if is_planted:
            ts = case_window_start + timedelta(seconds=random.randint(0, PLANTED_CASE_WINDOW_DAYS * 86400))
        else:
            ts = start_date + timedelta(seconds=random.randint(0, DATE_RANGE_DAYS * 86400))

        communications.append({
            "id": new_id("comm", len(communications)),
            "phone_a_id": person_to_phone[p1],
            "phone_b_id": person_to_phone[p2],
            "timestamp": ts.isoformat(),
            "duration_sec": random.randint(15, 900),
        })


# ------------------------------------------------------------
# STEP 7: Transactions (money transfers) -- only along a SUBSET of relationships
# ------------------------------------------------------------
print("Step 7: Generating transaction records...")

transactions = []
for p1, p2 in full_graph.edges():
    if not person_to_accounts.get(p1) or not person_to_accounts.get(p2):
        continue
    pair = tuple(sorted((p1, p2)))
    is_planted = pair in planted_pairs

    # not every relationship involves money -- real people don't send everyone cash
    if not is_planted and random.random() > 0.25:
        continue

    num_txns = random.randint(8, 20) if is_planted else random.randint(1, 4)
    for _ in range(num_txns):
        if is_planted:
            ts = case_window_start + timedelta(seconds=random.randint(0, PLANTED_CASE_WINDOW_DAYS * 86400))
        else:
            ts = start_date + timedelta(seconds=random.randint(0, DATE_RANGE_DAYS * 86400))

        transactions.append({
            "id": new_id("txn", len(transactions)),
            "from_account_id": random.choice(person_to_accounts[p1]),
            "to_account_id": random.choice(person_to_accounts[p2]),
            "timestamp": ts.isoformat(),
            "amount": round(random.uniform(500, 75000), 2),
        })


# ------------------------------------------------------------
# STEP 8: Cases + evidence layer
# ------------------------------------------------------------
print("Step 8: Generating cases and evidence...")

cases = []
case_members = {}
case_lookup = {}
for i in range(NUM_CASES):
    case_id = new_id("case", i)
    case_lookup[i] = case_id
    cases.append({
        "id": case_id,
        "case_number": f"TRC-2026-{100+i}",
        "title": CASE_NAMES[i],
        "agency": AGENCIES[i],
        "case_type": CASE_TYPES[i],
        "status": "Active" if i < 2 else "Under Review",
        "created_at": (datetime.now() - timedelta(days=random.randint(15, 60))).isoformat(),
    })
    case_members[case_id] = set()

# Most people belong to one case; a smaller subset overlaps across cases.
for pid in all_person_ids:
    primary = random.randrange(NUM_CASES)
    case_members[case_lookup[primary]].add(person_id_map[pid])
    if random.random() < 0.12:
        secondary = random.choice([i for i in range(NUM_CASES) if i != primary])
        case_members[case_lookup[secondary]].add(person_id_map[pid])

# Force two bridge entities to appear in Case 0 and Case 1 for the demo.
demo_bridge_ids = [person_id_map[p] for p in sorted(set(bridge_people))[:2]]
for pid in demo_bridge_ids:
    case_members[case_lookup[0]].add(pid)
    case_members[case_lookup[1]].add(pid)

case_persons = []
for case_id, members in case_members.items():
    for person_id in sorted(members):
        case_persons.append({
            "case_id": case_id,
            "person_id": person_id,
            "role": "Subject" if random.random() < 0.25 else "Associated Person",
        })

# Evidence is a provenance layer pointing back to original call, transaction,
# or event records. It is intentionally descriptive rather than accusatory.
evidence = []

def add_evidence(case_id, evidence_type, source_record_id, timestamp, description, entity_ids):
    evidence.append({
        "id": new_id("evidence", len(evidence)),
        "case_id": case_id,
        "evidence_type": evidence_type,
        "source_record_id": source_record_id,
        "timestamp": timestamp,
        "description": description,
        "entity_ids": "|".join(sorted(set(entity_ids))),
    })

def choose_case_for_people(person_ids):
    ids = set(person_ids)
    candidates = [cid for cid, members in case_members.items() if ids & members]
    return random.choice(candidates) if candidates else case_lookup[0]

# Event evidence
for event, participant in zip(events, event_participants):
    pid = participant["person_id"]
    cid = choose_case_for_people([pid])
    add_evidence(cid, "Location Event", event["id"], event["occurred_at"],
                 f'{event["event_type"].title()} recorded at location {event["location_id"]}', [pid])

# Communication evidence
phone_to_person = {phone: person_id_map[pid] for pid, phone in person_to_phone.items()}
for comm in communications:
    p1 = phone_to_person.get(comm["phone_a_id"])
    p2 = phone_to_person.get(comm["phone_b_id"])
    if not p1 or not p2:
        continue
    cid = choose_case_for_people([p1, p2])
    add_evidence(cid, "Call Record", comm["id"], comm["timestamp"],
                 f"Call between {p1} and {p2} lasting {comm["duration_sec"]} seconds", [p1, p2])

# Transaction evidence
account_owner = {}
for pid, accounts in person_to_accounts.items():
    for aid in accounts:
        account_owner[aid] = person_id_map[pid]
for txn in transactions:
    p1 = account_owner.get(txn["from_account_id"])
    p2 = account_owner.get(txn["to_account_id"])
    if not p1 or not p2:
        continue
    cid = choose_case_for_people([p1, p2])
    add_evidence(cid, "Financial Record", txn["id"], txn["timestamp"],
                 f'Transfer of INR {txn["amount"]:.2f} between linked accounts', [p1, p2])

# Explicit cross-case observations for the demo. These show overlap, not guilt.
for pid in demo_bridge_ids:
    for cid in (case_lookup[0], case_lookup[1]):
        add_evidence(cid, "Cross-Case Link", f"cross_case_{pid}", datetime.now().isoformat(),
                     f"{pid} is present in both {case_lookup[0]} and {case_lookup[1]}", [pid])

print(f"  -> {len(cases)} cases")
print(f"  -> {len(case_persons)} case-person assignments")
print(f"  -> {len(evidence)} evidence records")

# ------------------------------------------------------------
# STEP 9: Save everything as CSV files
# ------------------------------------------------------------
print("Step 8: Saving CSV files...")


def save_csv(filename, rows):
    if not rows:
        print(f"  -> skipped {filename} (no rows)")
        return
    path = os.path.join(OUTPUT_DIR, filename)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"  -> {filename}: {len(rows)} rows")


save_csv("persons.csv", persons)
save_csv("phones.csv", phones)
save_csv("bank_accounts.csv", bank_accounts)
save_csv("vehicles.csv", vehicles)
save_csv("devices.csv", devices)
save_csv("organizations.csv", organizations)
save_csv("works_at.csv", works_at)
save_csv("org_owns_account.csv", org_owns_account)
save_csv("locations.csv", locations)
save_csv("events.csv", events)
save_csv("event_participants.csv", event_participants)
save_csv("communications.csv", communications)
save_csv("transactions.csv", transactions)
save_csv("cases.csv", cases)
save_csv("case_persons.csv", case_persons)
save_csv("evidence.csv", evidence)

# Save a "cheat sheet" of which IDs were deliberately planted, so you know what to click during the demo
with open(os.path.join(OUTPUT_DIR, "DEMO_CHEAT_SHEET.txt"), "w") as f:
    f.write("PEOPLE TO USE IN YOUR DEMO (these have planted, guaranteed-interesting connections)\n")
    f.write("=" * 70 + "\n\n")
    f.write("HUB PEOPLE (high connectivity -- good for 'Analyze Network' demo):\n")
    for p in hub_people:
        f.write(f"  {person_id_map[p]}\n")
    f.write("\nCASES:\n")
    for case in cases:
        f.write(f"  {case['id']} | {case['case_number']} | {case['title']}\n")
    f.write("\nDEMO CROSS-CASE BRIDGE PEOPLE:\n")
    for pid in demo_bridge_ids:
        f.write(f"  {pid}\n")
    f.write("\nBRIDGE PEOPLE (connect two separate groups -- good for 'Find Key Connectors' demo):\n")
    for p in sorted(set(bridge_people)):
        f.write(f"  {person_id_map[p]}\n")

print("\nDone. Check the 'output' folder.")
print("Open DEMO_CHEAT_SHEET.txt to see exactly which people to click on during your demo.")
