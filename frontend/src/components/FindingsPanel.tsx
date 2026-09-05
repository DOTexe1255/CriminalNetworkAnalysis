import { useEffect, useMemo, useState } from "react";
import "./FindingsPanel.css";
import { API_BASE_URL } from "../config";

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
  case_ids?: string[];
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

const API = API_BASE_URL;

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
  caseId: string;
  onSelect: (finding: Finding) => void;
};

function getSeverity(importance?: string) {
  const value = (importance ?? "").toLowerCase();
  if (value === "critical" || value === "high") return "high";
  if (value === "medium") return "medium";
  return "review";
}

function getIcon(type: string) {
  switch (type) {
    case "Bridge Entity": return "↔";
    case "Community Connector": return "⌘";
    case "Activity Spike": return "↗";
    case "Transaction Pattern": return "₹";
    case "Cross-Case Connection": return "⛓";
    default: return "•";
  }
}

export default function FindingsPanel({ selectedId, caseId, onSelect }: Props) {
  const [items, setItems] = useState<Finding[]>([]);
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadFindings() {
      if (!caseId) return;
      setLoading(true);

      try {
        const response = await fetch(
          `${API}/api/case/${encodeURIComponent(caseId)}/findings`
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const findings: Finding[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.findings)
            ? data.findings
            : [];

        // The case-scoped backend endpoint intentionally returns the finding
        // itself, while evidence/case counts live on the finding detail and
        // evidence endpoints. Hydrate those counts here so the cards never
        // display misleading 0 values.
        const hydrated = await Promise.all(
          findings.map(async (finding) => {
            try {
              const [detailResponse, evidenceResponse] = await Promise.all([
                fetch(`${API}/api/finding/${encodeURIComponent(finding.id)}`),
                fetch(`${API}/api/finding/${encodeURIComponent(finding.id)}/evidence`),
              ]);

              const detail = detailResponse.ok ? await detailResponse.json() : {};
              const evidence = evidenceResponse.ok ? await evidenceResponse.json() : [];

              return {
                ...finding,
                case_ids: Array.isArray(detail?.case_ids) ? detail.case_ids : [],
                case_count: Array.isArray(detail?.case_ids)
                  ? detail.case_ids.length
                  : undefined,
                evidence_count: Array.isArray(evidence)
                  ? evidence.length
                  : undefined,
              };
            } catch {
              return finding;
            }
          })
        );

        if (!cancelled) setItems(hydrated);
      } catch (error) {
        console.error("Failed to load case findings:", error);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setItems([]);
    loadFindings();

    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const uniqueItems = useMemo(() => {
    const map = new Map<string, Finding>();
    for (const finding of items) {
      if (finding?.id && !map.has(finding.id)) map.set(finding.id, finding);
    }
    return Array.from(map.values());
  }, [items]);

  const filtered = useMemo(() => {
    if (filter === "All") return uniqueItems;
    return uniqueItems.filter((finding) => finding.finding_type === filter);
  }, [uniqueItems, filter]);

  useEffect(() => {
    if (!loading && filtered.length > 0) {
      const selectedStillExists = filtered.some((f) => f.id === selectedId);
      if (!selectedStillExists) onSelect(filtered[0]);
    }
  }, [loading, filtered, selectedId, onSelect]);

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
        <span className="finding-count">{loading ? "—" : uniqueItems.length}</span>
      </div>

      <div className="finding-filters">
        {FILTERS.map((name) => (
          <button
            key={name}
            type="button"
            className={`finding-filter ${filter === name ? "active" : ""}`}
            onClick={() => setFilter(name)}
          >
            {name === "All" ? "ALL" : humanType(name).toUpperCase()}
          </button>
        ))}
      </div>

      {loading ? (
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
      ) : filtered.length === 0 ? (
        <div className="findings-empty">
          <strong>No investigation leads</strong>
          <p>No findings match the current case/filter.</p>
        </div>
      ) : (
        <div className="finding-list">
          {filtered.map((finding) => {
            const selected = selectedId === finding.id;
            const severity = getSeverity(finding.importance);
            const personBased = finding.finding_type !== "Transaction Pattern";
            const title = personBased
              ? finding.person_name || finding.title || "Investigation lead"
              : finding.title || "Financial interaction";

            return (
              <button
                key={finding.id}
                type="button"
                className={`finding-card ${selected ? "selected" : ""}`}
                onClick={() => onSelect(finding)}
              >
                <div className="finding-card-top">
                  <div className="finding-icon">{getIcon(finding.finding_type)}</div>
                  <span className={`severity severity-${severity}`}>
                    {severity === "high" ? "HIGH" : severity === "medium" ? "MEDIUM" : "REVIEW"}
                  </span>
                  <span className="finding-type">{humanType(finding.finding_type)}</span>
                  <span className="finding-arrow">→</span>
                </div>

                <div className="finding-card-title">{title}</div>
                <p className="finding-description">
                  {finding.description || "Trace identified a relationship or pattern that may require further investigation."}
                </p>

                <div className="finding-card-footer">
                  <div className="finding-meta">
                    <span>
                      {finding.evidence_count ?? "—"} {
                        finding.evidence_count == null
                          ? "records, "
                          : finding.evidence_count === 1
                            ? "record, "
                            : "records, "
                      }
                    </span>
                    <span>
                      {finding.case_count ?? "—"} {
                        finding.case_count == null
                          ? "cases"
                          : finding.case_count === 1
                            ? "case"
                            : "cases"
                      }
                    </span>
                  </div>
                  {/* <span className="investigate-label">{selected ? "INVESTIGATING" : "INVESTIGATE →"}</span> */}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
