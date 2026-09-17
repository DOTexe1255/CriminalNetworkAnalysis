from __future__ import annotations

from datetime import date, timedelta


def build_sample_cases(count: int = 3) -> list[dict[str, object]]:
    profiles = [
        ("Operation Godavari Link", "TRC-2026-0147", "A fictional narcotics-network inquiry following courier movements between Hyderabad, Nagpur, and Raipur.", "Inspector Kavita Deshmukh", "High", "Ravi Prakash Yadav", "Meera Nair"),
        ("Project Neelam Ledger", "TRC-2026-0152", "A fictional financial investigation into layered IMPS transfers, shell vendors, and a warehouse account in Gurugram.", "Deputy Superintendent Arjun Malhotra", "High", "Sanjay Kumar Bansal", "Farah Siddiqui"),
        ("Case Monsoon Relay", "TRC-2026-0161", "A fictional communications inquiry examining recurring late-night calls and shared travel locations around Pune and Mumbai.", "Inspector Ananya Iyer", "Medium", "Nikhil Ramesh Patil", "Ayesha Khan"),
    ]
    cases: list[dict[str, object]] = []
    for index, (name, number, description, lead_name, priority, subject, associate) in enumerate(profiles[:count]):
        event_date = date(2026, 8, 18) + timedelta(days=index * 5)
        case_id = f"case_{index:05d}"
        lead = {"name": lead_name, "unit": "State Intelligence Coordination Desk", "role": "Case Lead"}
        cases.append({
            "id": case_id, "name": name, "case_number": number, "description": description,
            "status": "Active" if index < 2 else "Review", "priority": priority, "lead": lead_name,
            "lead_details": [lead], "created_at": event_date.isoformat(), "event_date": (event_date + timedelta(days=12)).isoformat(),
            "narratives": [
                {"title": "Initial intake", "date": event_date.isoformat(), "text": f"Source material identifies {subject} as a person requiring verification and places {associate} in the same contact window."},
                {"title": "Analyst note", "date": (event_date + timedelta(days=3)).isoformat(), "text": "The relationship is recorded as an investigative lead only; identity, intent, and attribution remain subject to corroboration."},
            ],
            "evidence": [
                {"id": f"ev_{index:05d}_call", "type": "Call Record", "date": event_date.isoformat(), "description": f"Call-detail review shows repeated contact between {subject} and {associate} during the relevant window."},
                {"id": f"ev_{index:05d}_location", "type": "Location Event", "date": (event_date + timedelta(days=7)).isoformat(), "description": f"A device associated with {subject} was recorded near a location also visited by {associate}."},
                {"id": f"ev_{index:05d}_finance", "type": "Financial Record", "date": (event_date + timedelta(days=11)).isoformat(), "description": f"A transaction involving an account linked to {subject} is pending source-document verification."},
            ],
            "documents": [
                {"name": f"{case_id}-intake-brief.pdf", "type": "application/pdf", "size": 184000, "category": "Case document", "description": "Initial intake brief and source chronology."},
                {"name": f"{case_id}-timeline.csv", "type": "text/csv", "size": 9200, "category": "Timeline export", "description": "Normalized contact and location timeline."},
            ],
            "document": f"{name} is synthetic training data. Named individuals are fictional placeholders for a realistic demonstration and are not allegations about real people.",
        })
    return cases
