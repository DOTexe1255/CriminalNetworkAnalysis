import { useMemo } from "react";
import type { Finding } from "./FindingsPanel";
import type { Evidence } from "./EvidencePanel";
import "./TimelineView.css";

type Props = {
  personId?: string;
  personName?: string;
  finding?: Finding | null;
  evidence?: Evidence[];
  loading?: boolean;
  activeEvidenceId?: string | null;
  onEvidenceSelect?: (evidence: Evidence) => void;
};

function typeLabel(type?: string) {
  if (!type) return "RECORD";
  if (type === "Call Record") return "COMMUNICATION";
  if (type === "Financial Record") return "TRANSACTION";
  if (type === "Location Event") return "LOCATION EVENT";
  if (type === "Cross-Case Link") return "CROSS-CASE";
  return type.toUpperCase();
}

/**
 * Neo4j/Python backends can serialize a datetime as either an ISO string,
 * a number, or an object such as:
 * { _DateTime__date: "2026-01-02", _DateTime__time: "14:30:00" }
 *
 * React cannot render that object directly, so normalize it at the UI edge.
 */
function timestampToString(value: unknown): string | null {
  if (value == null) return null;

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "object") {
    const raw = value as Record<string, unknown>;

    const date = raw._DateTime__date ?? raw.date ?? raw.year_month_day;
    const time = raw._DateTime__time ?? raw.time ?? raw.hour_minute_second;

    if (date && time) return `${String(date)}T${String(time)}`;
    if (date) return String(date);

    // Some serializers use {year, month, day, hour, minute, second}.
    if (
      typeof raw.year === "number" &&
      typeof raw.month === "number" &&
      typeof raw.day === "number"
    ) {
      const pad = (n: number) => String(n).padStart(2, "0");
      const datePart = `${raw.year}-${pad(raw.month)}-${pad(raw.day)}`;
      const hour = typeof raw.hour === "number" ? raw.hour : 0;
      const minute = typeof raw.minute === "number" ? raw.minute : 0;
      const second = typeof raw.second === "number" ? raw.second : 0;
      return `${datePart}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
    }
  }

  return null;
}

function timestampMillis(value: unknown): number {
  const normalized = timestampToString(value);
  if (!normalized) return 0;

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDate(value: unknown) {
  const normalized = timestampToString(value);
  if (!normalized) return "Date not recorded";

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return normalized;

  return date.toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TimelineView({
  personId,
  personName,
  finding,
  evidence = [],
  loading = false,
  activeEvidenceId,
  onEvidenceSelect,
}: Props) {
  const ordered = useMemo(
    () =>
      [...evidence].sort(
        (a, b) => timestampMillis(b.timestamp) - timestampMillis(a.timestamp)
      ),
    [evidence]
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    ordered.forEach((item) => {
      const key = typeLabel(item.evidence_type);
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries());
  }, [ordered]);

  const range = useMemo(() => {
    const dates = ordered
      .map((item) => timestampMillis(item.timestamp))
      .filter((value) => value > 0);

    if (!dates.length) return null;

    const newest = new Date(Math.max(...dates));
    const oldest = new Date(Math.min(...dates));

    return {
      from: oldest.toLocaleDateString([], {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      to: newest.toLocaleDateString([], {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    };
  }, [ordered]);

  if (!personId && !finding) {
    return (
      <div className="timeline-view timeline-empty">
        <span className="eyebrow">TEMPORAL ANALYSIS</span>
        <h2>Activity Timeline</h2>
        <p>Select an investigation lead to build a time-aware investigation view.</p>
      </div>
    );
  }

  return (
    <div className="timeline-view">
      <div className="timeline-toolbar">
        <div>
          <span className="eyebrow">TEMPORAL ANALYSIS · CONTEXT ACTIVE</span>
          <h2>{finding ? "Activity around this lead" : "Activity Timeline"}</h2>
          <p>
            {finding
              ? `${finding.person_name || personName || "Selected entity"} · ${finding.finding_type}`
              : `Activity associated with ${personName || "the selected entity"}.`}
          </p>
        </div>

        <div className="timeline-summary">
          <b>{loading ? "—" : ordered.length}</b>
          <span>supporting events</span>
          {range && <small>{range.from} → {range.to}</small>}
        </div>
      </div>

      {!loading && counts.length > 0 && (
        <div className="timeline-type-strip">
          {counts.map(([label, count]) => (
            <span key={label}><b>{count}</b> {label}</span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="timeline-loading">
          {[1, 2, 3, 4].map((item) => <div key={item} className="timeline-skeleton" />)}
        </div>
      ) : ordered.length === 0 ? (
        <div className="timeline-no-data">
          <strong>No timestamped supporting records</strong>
          <p>Trace has a selected lead, but no temporal records were returned for this view.</p>
        </div>
      ) : (
        <div className="timeline-stream">
          {ordered.map((item, index) => {
            const selected = activeEvidenceId === item.id;
            // Evidence IDs should be unique, but keep the timeline stable if
            // the backend ever returns a duplicate record as well.
            const key = item.id ? `${item.id}-${index}` : `timeline-${index}`;

            return (
              <button
                key={key}
                type="button"
                className={`timeline-event ${selected ? "selected" : ""}`}
                onClick={() => onEvidenceSelect?.(item)}
              >
                <span className="timeline-rail"><i /></span>
                <span className="timeline-event-content">
                  <span className="timeline-event-head">
                    <b>{typeLabel(item.evidence_type)}</b>
                    <time dateTime={timestampToString(item.timestamp) || undefined}>
                      {formatDate(item.timestamp)}
                    </time>
                  </span>
                  <strong>{item.description || "Supporting record"}</strong>
                  <small>
                    {item.source_record_id ? `SOURCE · ${item.source_record_id}` : "SOURCE · RECORD ID NOT RECORDED"}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
