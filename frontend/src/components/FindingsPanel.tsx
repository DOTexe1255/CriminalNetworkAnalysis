import { useEffect, useMemo, useState } from "react";
import "./FindingsPanel.css";

export type Finding = {
  id: string;
  finding_type: string;
  title: string;
  description: string;
  importance: string;
  person_id?: string;
  person_name?: string;
  evidence_count?: number;
  case_count?: number;
};

const API = "http://localhost:8000";

const typeLabel: Record<string, string> = {
  "Bridge Entity": "Key Connection",
  "Community Connector": "Links Separate Groups",
  "Activity Spike": "Unusual Activity",
  "Transaction Pattern": "Financial Activity",
  "Cross-Case Connection": "Cross-Case Link",
};

const typeIcon: Record<string, string> = {
  "Bridge Entity": "↔",
  "Community Connector": "⌘",
  "Activity Spike": "↗",
  "Transaction Pattern": "₹",
  "Cross-Case Connection": "⊕",
};

export function humanType(type: string) {
  return typeLabel[type] || type;
}

export default function FindingsPanel({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (f: Finding) => void;
}) {
  const [items, setItems] = useState<Finding[]>([]);
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/findings`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const next = Array.isArray(d) ? d : d?.findings ?? [];
        setItems(next);
        if (next.length && !selectedId) onSelect(next[0]);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
    // Initial selection is intentionally done only when the panel first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filters = [
    "All",
    "Bridge Entity",
    "Transaction Pattern",
    "Activity Spike",
    "Cross-Case Connection",
  ];

  const filtered = useMemo(
    () => items.filter((f) => filter === "All" || f.finding_type === filter),
    [items, filter]
  );

  const visible = filtered.slice(0, 8);

  return (
    <aside className="findings-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">INVESTIGATION LEADS</span>
          <h2>What needs attention</h2>
          <p className="panel-subtitle">Trace found these relationships and patterns first.</p>
        </div>
        <span className="finding-count">{items.length}</span>
      </div>

      <div className="finding-filters">
        {filters.map((x) => (
          <button
            key={x}
            className={filter === x ? "active" : ""}
            onClick={() => setFilter(x)}
          >
            {x === "All" ? "ALL" : humanType(x).toUpperCase()}
          </button>
        ))}
      </div>

      <div className="lead-hint">
        <span>01</span>
        <p>Select a lead to automatically focus the relevant network.</p>
      </div>

      <div className="finding-list">
        {loading ? Array.from({ length: 5 }).map((_, i) => (
          <div className="finding-skeleton" key={i}>
            <div className="skeleton-line short" /><div className="skeleton-line title" /><div className="skeleton-line" /><div className="skeleton-line" />
          </div>
        )) : visible.map((f, index) => {
          const label = humanType(f.finding_type);
          const person = f.person_name || f.title.split(":").slice(1).join(":").trim();
          return (
            <button
              key={f.id}
              className={`finding-card ${selectedId === f.id ? "selected" : ""}`}
              onClick={() => onSelect(f)}
            >
              <div className="finding-card-top">
                <span className="lead-icon">{typeIcon[f.finding_type] || "•"}</span>
                <span className={`severity severity-${f.importance.toLowerCase()}`}>
                  {f.importance}
                </span>
                <span className="finding-type">{label}</span>
              </div>
              <strong>{person}</strong>
              <p>{f.description}</p>
              <span className="investigate-link">INVESTIGATE →</span>
              <small>
                {f.evidence_count ?? 0} records · {f.case_count ?? 0} cases
              </small>
              {index === 0 && selectedId === f.id && <span className="selected-bar" />}
            </button>
          );
        })}
      </div>

      {filtered.length > visible.length && (
        <div className="more-leads">Showing {visible.length} of {filtered.length} leads</div>
      )}
    </aside>
  );
}
