import type { Finding } from "./FindingsPanel";
import "./EvidencePanel.css";

export type Evidence = {
  id: string;
  evidence_type?: string;
  timestamp?: unknown;
  description?: string;
  source_record_id?: string;
};

type Props = {
  evidence: Evidence[];
  finding: Finding | null;
  loading?: boolean;
  activeEvidenceId?: string | null;
  onEvidenceSelect?: (evidence: Evidence) => void;
};

function label(type?: string) {
  if (!type) return "RECORD";
  return type.toUpperCase();
}

function formatTimestamp(value: unknown) {
  if (value == null) return "—";

  let normalized: string | null = null;

  if (typeof value === "string" || typeof value === "number") {
    normalized = String(value);
  } else if (typeof value === "object") {
    const raw = value as Record<string, unknown>;
    const date = raw._DateTime__date ?? raw.date;
    const time = raw._DateTime__time ?? raw.time;
    if (date && time) normalized = `${String(date)}T${String(time)}`;
    else if (date) normalized = String(date);
  }

  if (!normalized) return "—";

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return normalized;

  return date.toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function EvidencePanel({
  evidence,
  finding,
  loading = false,
  activeEvidenceId,
  onEvidenceSelect,
}: Props) {
  return (
    <section className="evidence-panel">
      <div className="section-label">SUPPORTING EVIDENCE</div>

      {finding && (
        <div className="evidence-context">
          <span>CONTEXT</span>
          <strong>{finding.person_name || "Selected lead"}</strong>
          <small>{evidence.length} supporting records returned</small>
        </div>
      )}

      {!finding ? (
        <div className="evidence-empty">Select a finding to inspect its supporting records.</div>
      ) : loading ? (
        <div className="evidence-loading">
          {[1, 2, 3].map((item) => <div key={item} className="evidence-skeleton" />)}
        </div>
      ) : evidence.length === 0 ? (
        <div className="evidence-empty">No evidence records returned.</div>
      ) : (
        <div className="evidence-items">
          {evidence.map((item) => {
            const selected = activeEvidenceId === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={`evidence-item ${selected ? "selected" : ""}`}
                onClick={() => onEvidenceSelect?.(item)}
              >
                <div className="evidence-meta">
                  <span>{label(item.evidence_type)}</span>
                  <time>
                    {formatTimestamp(item.timestamp)}
                  </time>
                </div>
                <p>{item.description || "No description available."}</p>
                {item.source_record_id && <small>Source: {item.source_record_id}</small>}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
