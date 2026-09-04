import { useEffect, useMemo, useState } from "react";
import "./FindingsPanel.css";

export type Finding = {
  id: string;
  finding_type: string;
  title?: string;
  description?: string;
  importance?: string;
  person_id?: string;
  person_name?: string;
  evidence_count?: number;
  case_count?: number;
};

export function humanType(type: string): string {
  const labels: Record<string, string> = {
    "Bridge Entity": "Key Connection",
    "Community Connector": "Links Separate Groups",
    "Activity Spike": "Unusual Activity",
    "Transaction Pattern": "Financial Activity",
    "Cross-Case Connection": "Cross-Case Link",
  };

  return labels[type] ?? type;
}

const API = "http://localhost:8000";

const FILTERS = [
  "All",
  "Bridge Entity",
  "Community Connector",
  "Activity Spike",
  "Transaction Pattern",
  "Cross-Case Connection",
];

type Props = {
  selectedId?: string | null;
  onSelect: (finding: Finding) => void;
};

function getSeverity(importance?: string) {
  const value = (importance ?? "").toLowerCase();

  if (value === "critical" || value === "high") {
    return "high";
  }

  if (value === "medium") {
    return "medium";
  }

  return "review";
}

function getIcon(type: string) {
  switch (type) {
    case "Bridge Entity":
      return "↔";

    case "Community Connector":
      return "⌘";

    case "Activity Spike":
      return "↗";

    case "Transaction Pattern":
      return "₹";

    case "Cross-Case Connection":
      return "⛓";

    default:
      return "•";
  }
}

export default function FindingsPanel({
  selectedId,
  onSelect,
}: Props) {
  const [items, setItems] = useState<Finding[]>([]);
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadFindings() {
      setLoading(true);

      try {
        const response = await fetch(`${API}/api/findings`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        const findings: Finding[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.findings)
            ? data.findings
            : [];

        if (!cancelled) {
          setItems(findings);
        }
      } catch (error) {
        console.error("Failed to load findings:", error);

        if (!cancelled) {
          setItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadFindings();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Defensive deduplication.
   *
   * If Neo4j returns the same Finding more than once,
   * only one card is rendered.
   */
  const uniqueItems = useMemo(() => {
    const map = new Map<string, Finding>();

    items.forEach((finding) => {
      if (!finding?.id) return;

      if (!map.has(finding.id)) {
        map.set(finding.id, finding);
      }
    });

    return Array.from(map.values());
  }, [items]);

  const filtered = useMemo(() => {
    if (filter === "All") {
      return uniqueItems;
    }

    return uniqueItems.filter(
      (finding) => finding.finding_type === filter
    );
  }, [uniqueItems, filter]);

  return (
    <aside className="findings-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">INVESTIGATION LEADS</span>

          <h2>What needs attention</h2>

          <p className="panel-subtitle">
            Trace found these relationships and patterns first.
          </p>
        </div>

        <span className="finding-count">
          {loading ? "—" : uniqueItems.length}
        </span>
      </div>

      {/* FILTERS */}
      <div className="finding-filters">
        {FILTERS.map((filterName) => {
          const active = filter === filterName;

          return (
            <button
              key={filterName}
              type="button"
              className={`finding-filter ${
                active ? "active" : ""
              }`}
              onClick={() => setFilter(filterName)}
            >
              {filterName === "All"
                ? "ALL"
                : humanType(filterName).toUpperCase()}
            </button>
          );
        })}
      </div>

      {/* LOADING */}
      {loading && (
        <div className="finding-list">
          {[1, 2, 3, 4].map((id) => (
            <div className="finding-skeleton" key={id}>
              <div className="skeleton-top" />

              <div className="skeleton-line large" />
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
            </div>
          ))}
        </div>
      )}

      {/* EMPTY */}
      {!loading && filtered.length === 0 && (
        <div className="findings-empty">
          <strong>No investigation leads</strong>

          <p>
            No findings match the current filter.
          </p>
        </div>
      )}

      {/* FINDINGS */}
      {!loading && filtered.length > 0 && (
        <div className="finding-list">
          {filtered.map((finding) => {
            const selected = selectedId === finding.id;
            const severity = getSeverity(finding.importance);

            const personBasedFinding =
                finding.finding_type !== "Transaction Pattern";

            const cleanTitle = personBasedFinding
                ? finding.person_name || finding.title || "Investigation lead"
                : finding.title || "Financial interaction";

            return (
              <button
                key={finding.id}
                type="button"
                className={`finding-card ${
                  selected ? "selected" : ""
                }`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();

                  onSelect(finding);
                }}
              >
                <div className="finding-card-top">
                  <div className="finding-icon">
                    {getIcon(finding.finding_type)}
                  </div>

                  <span
                    className={`severity severity-${severity}`}
                  >
                    {severity === "high"
                      ? "HIGH"
                      : severity === "medium"
                        ? "MEDIUM"
                        : "REVIEW"}
                  </span>

                  <span className="finding-type">
                    {humanType(finding.finding_type)}
                  </span>

                  <span className="finding-arrow">
                    →
                  </span>
                </div>

                <div className="finding-card-title">
                  {cleanTitle}
                </div>

                <p className="finding-description">
                  {finding.description ||
                    "Trace identified a relationship or pattern that may require further investigation."}
                </p>

                <div className="finding-card-footer">
                  <div className="finding-meta">
                    <span>
                      {finding.evidence_count ?? 0}{" "}
                      {(finding.evidence_count ?? 0) === 1
                        ? "record"
                        : "records"}
                    </span>

                    <span>
                      {finding.case_count ?? 0}{" "}
                      {(finding.case_count ?? 0) === 1
                        ? "case"
                        : "cases"}
                    </span>
                  </div>

                  <span className="investigate-label">
                    {selected
                      ? "INVESTIGATING"
                      : "INVESTIGATE →"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}