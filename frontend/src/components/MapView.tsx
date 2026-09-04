import { useMemo } from "react";
import type { Finding } from "./FindingsPanel";
import type { Evidence } from "./EvidencePanel";
import type { PersonDetails } from "./EntityProfile";
import "./MapView.css";

type Props = {
  person?: PersonDetails | null;
  personId?: string;
  personName?: string;
  finding?: Finding | null;
  evidence?: Evidence[];
  activeEvidenceId?: string | null;
  onEvidenceSelect?: (evidence: Evidence) => void;
};

function extractLocationId(description?: string) {
  if (!description) return null;
  const match = description.match(/location_[a-zA-Z0-9_-]+/i);
  return match?.[0] || null;
}

function shortDate(value?: unknown) {
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
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

export default function MapView({
  person,
  personId,
  personName,
  finding,
  evidence = [],
  activeEvidenceId,
  onEvidenceSelect,
}: Props) {
  const locationSignals = useMemo(() => {
    return evidence
      .filter((item) => item.evidence_type === "Location Event")
      .map((item) => ({
        ...item,
        locationId: extractLocationId(item.description),
      }))
      .filter((item) => item.locationId);
  }, [evidence]);

  const uniqueLocations = useMemo(
    () => Array.from(new Set(locationSignals.map((item) => item.locationId))),
    [locationSignals]
  );

  if (!personId && !finding) {
    return (
      <div className="map-view map-empty">
        <span className="eyebrow">GEOSPATIAL ANALYSIS</span>
        <h2>Location Intelligence</h2>
        <p>Select an investigation lead to build a location context.</p>
      </div>
    );
  }

  return (
    <div className="map-view">
      <div className="map-header">
        <div>
          <span className="eyebrow">GEOSPATIAL ANALYSIS · CONTEXT ACTIVE</span>
          <h2>Locations relevant to this lead</h2>
          <p>{finding?.person_name || person?.name || personName || "Selected entity"}</p>
        </div>
        <div className="map-count"><b>{uniqueLocations.length}</b><span>location signals</span></div>
      </div>

      <div className="map-layout">
        <div className="map-canvas">
          <div className="map-grid-lines" />
          <div className="map-road road-a" />
          <div className="map-road road-b" />
          <div className="map-road road-c" />

          <div className="map-primary-marker" style={{ left: "50%", top: "50%" }}>
            <span />
            <label>
              {person?.city || "Primary entity location"}
              {person?.address ? <small>{person.address}</small> : null}
            </label>
          </div>

          {locationSignals.slice(0, 8).map((item, index) => {
            const positions = [
              [22, 28], [74, 26], [31, 69], [69, 67],
              [16, 52], [82, 50], [43, 18], [57, 82],
            ];
            const [left, top] = positions[index];
            const selected = activeEvidenceId === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={`map-marker ${selected ? "selected" : ""}`}
                style={{ left: `${left}%`, top: `${top}%` }}
                onClick={() => onEvidenceSelect?.(item)}
                title={item.locationId || "Location event"}
              >
                <span />
              </button>
            );
          })}

          <div className="map-disclaimer">EVENT LOCATIONS · CONTEXTUAL VIEW</div>
        </div>

        <aside className="location-list">
          <div className="location-list-heading">LOCATION SIGNALS</div>

          {person?.city && (
            <div className="location-primary">
              <span>ENTITY PROFILE</span>
              <strong>{person.city}</strong>
              <small>{person.address || "Address available in profile"}</small>
            </div>
          )}

          {locationSignals.length === 0 ? (
            <div className="location-empty">
              No location events were included in the supporting records for this lead.
            </div>
          ) : (
            locationSignals.slice(0, 10).map((item) => (
              <button
                key={item.id}
                type="button"
                className={`location-item ${activeEvidenceId === item.id ? "selected" : ""}`}
                onClick={() => onEvidenceSelect?.(item)}
              >
                <span className="location-dot" />
                <span>
                  <b>{item.locationId}</b>
                  <small>{shortDate(item.timestamp)} · {item.description || "Location event"}</small>
                </span>
              </button>
            ))
          )}
        </aside>
      </div>
    </div>
  );
}
