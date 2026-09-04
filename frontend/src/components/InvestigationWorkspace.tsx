import { useCallback, useEffect, useMemo, useState } from "react";
import GraphView from "./GraphView";
import FindingsPanel, { humanType, type Finding } from "./FindingsPanel";
import EntityProfile, { type PersonDetails } from "./EntityProfile";
import EvidencePanel, { type Evidence } from "./EvidencePanel";
import InvestigationHeader from "./InvestigationHeader";
import GraphControls from "./GraphControls";
import TimelineView from "./TimelineView";
import MapView from "./MapView";
import PersonDossier from "./PersonDossier";
import "./InvestigationWorkspace.css";

const API = "http://localhost:8000";

export default function InvestigationWorkspace() {
  const [person, setPerson] = useState<PersonDetails | null>(null);
  const [finding, setFinding] = useState<Finding | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [view, setView] = useState<"graph" | "timeline" | "map">("graph");
  const [query, setQuery] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [graphFocusId, setGraphFocusId] = useState<string | undefined>();
  const [hopDistance, setHopDistance] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    if (!finding?.person_id) {
      setProfileLoading(false);
      return;
    }
    setPerson(null);
    setProfileLoading(true);
    setGraphFocusId(finding.person_id);
    setHopDistance(1);
    fetch(`${API}/api/person/${finding.person_id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setPerson(d); })
      .catch(() => {})
      .finally(() => setProfileLoading(false));
  }, [finding]);

  useEffect(() => {
    if (!finding?.id) {
      setEvidence([]);
      setEvidenceLoading(false);
      return;
    }
    setEvidence([]);
    setEvidenceLoading(true);
    fetch(`${API}/api/finding/${finding.id}/evidence`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setEvidence(Array.isArray(d) ? d : d?.evidence ?? []))
      .catch(() => setEvidence([]))
      .finally(() => setEvidenceLoading(false));
  }, [finding]);

  const handlePersonSelect = useCallback((nextPerson: PersonDetails) => {
    setPerson(nextPerson);
    setProfileLoading(false);
    setGraphFocusId(nextPerson.id);
    setHopDistance((current) => current === 0 ? 1 : current);
  }, []);

  const handlePersonLoading = useCallback((personId: string) => {
    setPerson(null);
    setProfileLoading(true);
    setGraphFocusId(personId);
    setHopDistance(1);
  }, []);

  const quickLeads = useMemo(() => {
    if (!finding) return [];
    return [finding];
  }, [finding]);

  return (
    <div className="trace-workspace">
      <InvestigationHeader query={query} onQueryChange={setQuery} />

      <div className="trace-main">
        <FindingsPanel selectedId={finding?.id} onSelect={setFinding} />

        <main className="trace-center">
          <section className="investigation-brief">
            <div className="brief-heading">
              <div>
                <span className="eyebrow">INVESTIGATION BRIEF</span>
                <h1>What deserves attention</h1>
              </div>
              <div className="brief-status">
                <span className="status-dot" /> LIVE ANALYSIS
              </div>
            </div>

            <div className="brief-content">
              <div className="brief-copy">
                <span className="brief-label">TRACE HAS PRIORITIZED</span>
                <strong>{finding ? humanType(finding.finding_type) : "Investigation leads"}</strong>
                <p>
                  {finding
                    ? finding.description
                    : "Select a lead on the left to focus the relevant people, relationships and evidence."}
                </p>
              </div>

              <div className="brief-actions">
                {quickLeads.map((lead) => (
                  <button key={lead.id} onClick={() => setView("graph")}>
                    <span>FOCUSED NETWORK</span>
                    <b>{lead.person_name || "Selected lead"}</b>
                    <small>SHOW CONNECTIONS →</small>
                  </button>
                ))}
                {!quickLeads.length && (
                  <div className="brief-placeholder">
                    <span>START HERE</span>
                    <b>Choose an investigation lead</b>
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="analysis-stage">
            {view === "graph" && (
              <GraphView
                searchQuery={query}
                focusPersonId={graphFocusId}
                hopDistance={hopDistance}
                onPersonSelect={handlePersonSelect}
                onPersonLoading={handlePersonLoading}
              />
            )}
            {view === "timeline" && <TimelineView personId={person?.id} />}
            {view === "map" && <MapView personId={person?.id} />}
            <GraphControls
              view={view}
              onViewChange={setView}
              hopDistance={hopDistance}
              onHopChange={(hop) => {
                setHopDistance(hop);
                if (hop === 0) {
                  setGraphFocusId(undefined);
                } else if (person?.id) {
                  setGraphFocusId(person.id);
                } else if (finding?.person_id) {
                  setGraphFocusId(finding.person_id);
                }
              }}
            />
          </div>
        </main>

        <aside className="trace-inspector">
          <EntityProfile
            person={person}
            finding={finding}
            loading={profileLoading}
            onViewProfile={() => setProfileOpen(true)}
          />
          <EvidencePanel evidence={evidence} finding={finding} loading={evidenceLoading} />
        </aside>
      </div>

      <PersonDossier
        person={person}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
      />
    </div>
  );
}
