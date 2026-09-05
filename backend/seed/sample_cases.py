from __future__ import annotations

from datetime import date, timedelta


def build_sample_cases(count: int = 100) -> list[dict[str, object]]:
    priorities = ("High", "Medium", "Low")
    themes = (
        "telecom and movement pattern",
        "financial transfer chain",
        "device co-location pattern",
        "cross-case identity link",
    )
    cases: list[dict[str, object]] = []
    for index in range(count):
        case_number = index + 1
        case_id = f"case_{case_number:05d}"
        event_date = date(2025, 1, 1) + timedelta(days=index * 3)
        theme = themes[index % len(themes)]
        lead = {"name": f"Inspector {(index % 12) + 1:02d} Mehta", "unit": f"Field Unit {(index % 8) + 1:02d}", "role": "Case Lead"}
        narratives = [
            {"title": "Initial intake", "date": event_date.isoformat(), "text": f"A source flagged a {theme} around a recurring contact cluster."},
            {"title": "Analyst note", "date": (event_date + timedelta(days=3)).isoformat(), "text": "The timeline shows repeated contact windows and one shared entity requiring review."},
        ]
        evidence = [
            {"id": f"ev_{case_number:05d}_call", "type": "Call Record", "date": event_date.isoformat(), "description": "Repeated communication between two linked phone records."},
            {"id": f"ev_{case_number:05d}_location", "type": "Location Event", "date": (event_date + timedelta(days=7)).isoformat(), "description": "A location event overlaps with the active investigation window."},
            {"id": f"ev_{case_number:05d}_finance", "type": "Financial Record", "date": (event_date + timedelta(days=11)).isoformat(), "description": "A transfer pattern was recorded for investigator review."},
        ]
        documents = [{"name": f"case_{case_number:05d}_intake.pdf", "type": "application/pdf", "size": 184000}, {"name": f"case_{case_number:05d}_timeline.csv", "type": "text/csv", "size": 9200}]
        cases.append({
            "id": case_id,
            "name": f"Operation Signal {case_number:03d}",
            "case_number": f"TRC-2025-{case_number:04d}",
            "description": f"Sample investigation covering a {theme}.",
            "status": "Active" if index % 5 else "Review",
            "priority": priorities[index % len(priorities)],
            "lead": lead["name"],
            "lead_details": [lead],
            "narratives": narratives,
            "evidence": evidence,
            "documents": documents,
            "created_at": event_date.isoformat(),
            "event_date": (event_date + timedelta(days=14)).isoformat(),
            "document": (
                f"Case {case_id} records a {theme}. On {event_date.isoformat()}, "
                f"investigators linked Person {case_number:04d}, Person {(case_number % count) + 1:04d}, "
                "and a shared communication or financial record. This is synthetic training data."
            ),
        })
    return cases
