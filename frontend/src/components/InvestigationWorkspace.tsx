import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import GraphView, { type EdgeDetails } from "./GraphView";
import FindingsPanel, { humanType, type Finding } from "./FindingsPanel";
import EntityProfile, { type PersonDetails } from "./EntityProfile";
import EvidencePanel, { type Evidence } from "./EvidencePanel";
import InvestigationHeader from "./InvestigationHeader";
import GraphControls from "./GraphControls";
import TimelineView from "./TimelineView";
import MapView from "./MapView";
import PersonDossier from "./PersonDossier";
import "./InvestigationWorkspace.css";
import { API_BASE_URL } from "../config";

const API = API_BASE_URL;

type AnalysisView = "graph" | "timeline" | "map";
type WorkspaceProps = { initialCaseId?: string; onBack?: () => void };

export default function InvestigationWorkspace({ initialCaseId = "case_00000", onBack }: WorkspaceProps) {
  const [person, setPerson] = useState<PersonDetails | null>(null);
  const [finding, setFinding] = useState<Finding | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [view, setView] = useState<AnalysisView>("graph");
  const [query, setQuery] = useState("");
  const [caseId, setCaseId] = useState(initialCaseId);
  const [profileLoading, setProfileLoading] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [graphFocusId, setGraphFocusId] = useState<string | undefined>();
  const [hopDistance, setHopDistance] = useState<0 | 1 | 2>(0);
  const [edge, setEdge] = useState<EdgeDetails | null>(null);
  const [ragAnswer, setRagAnswer] = useState("");
  const [ragSources, setRagSources] = useState<Array<{ title: string; event_date?: string | null }>>([]);
  const [ragLoading, setRagLoading] = useState(false);

  async function askCase() {
    if (!query.trim()) return;
    setRagLoading(true);
    setRagAnswer("");
    try {
      const response = await fetch(`${API}/api/rag/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: caseId, question: query.trim() }),
      });
      const data = await response.json();
      setRagAnswer(response.ok ? data.answer : data.detail || "Case query is unavailable.");
      setRagSources(response.ok ? data.sources || [] : []);
    } catch {
      setRagAnswer("Case query is unavailable. Check that the API and Hugging Face token are configured.");
      setRagSources([]);
    } finally {
      setRagLoading(false);
    }
  }

  async function summarizeCase() {
    setRagLoading(true);
    setRagAnswer("");
    setQuery("Case summary");
    try {
      const response = await fetch(`${API}/api/case/${encodeURIComponent(caseId)}/summary`);
      const data = await response.json();
      setRagAnswer(response.ok ? data.answer : data.detail || "Case summary is unavailable.");
      setRagSources(response.ok ? data.sources || [] : []);
    } catch {
      setRagAnswer("Case summary is unavailable. Check the API and Hugging Face token.");
      setRagSources([]);
    } finally {
      setRagLoading(false);
    }
  }

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
      .then((d) => {
        if (d) setPerson(d);
      })
      .catch(() => { })
      .finally(() => setProfileLoading(false));
  }, [finding]);

  useEffect(() => {
    if (!finding?.id) {
      setEvidence([]);
      setEvidenceLoading(false);
      setActiveEvidenceId(null);
      return;
    }

    setEvidence([]);
    setActiveEvidenceId(null);
    setEvidenceLoading(true);

    fetch(`${API}/api/finding/${finding.id}/evidence`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setEvidence(Array.isArray(d) ? d : d?.evidence ?? []))
      .catch(() => setEvidence([]))
      .finally(() => setEvidenceLoading(false));
  }, [finding]);

  useEffect(() => {
    setFinding(null);
    setPerson(null);
    setEvidence([]);
    setEdge(null);
    setRagAnswer("");
    setRagSources([]);
  }, [caseId]);

  const handlePersonSelect = useCallback((nextPerson: PersonDetails) => {
    setPerson(nextPerson);
    setProfileLoading(false);
    setGraphFocusId(nextPerson.id);
    setHopDistance((current) => (current === 0 ? 1 : current));
  }, []);

  const handlePersonLoading = useCallback((personId: string) => {
    setPerson(null);
    setProfileLoading(true);
    setGraphFocusId(personId);
    setHopDistance(1);
  }, []);

  const handleEvidenceSelect = useCallback((item: Evidence) => {
    setActiveEvidenceId(item.id);

    // Make evidence navigation change the central investigation view too.
    // A location event belongs on the map; calls/transactions/cross-case
    // records are most useful in temporal context.
    if (item.evidence_type === "Location Event") {
      setView("map");
    } else {
      setView("timeline");
    }
  }, []);

  const quickLeads = useMemo(() => (finding ? [finding] : []), [finding]);

  const contextLabel = finding
    ? humanType(finding.finding_type)
    : undefined;

  return (
    <div className={`trace-workspace ${finding ? "has-investigation-context" : ""}`}>
      <InvestigationHeader
        query={query}
        onQueryChange={setQuery}
        onQuerySubmit={askCase}
        onSummary={summarizeCase}
        caseId={caseId}
        onCaseChange={setCaseId}
        onBack={onBack}
      />

      <div className="trace-main">
        <FindingsPanel
          selectedId={finding?.id}
          caseId={caseId}
          onSelect={setFinding}
        />

        <main className="trace-center">
          <section className="investigation-brief">
            <div className="brief-heading">
              <div>
                <span className="eyebrow">
                  {finding ? "INVESTIGATION CONTEXT" : "INVESTIGATION BRIEF"}
                </span>
                <h1>
                  {finding
                    ? "Trace built an investigation thread"
                    : "What deserves attention"}
                </h1>
              </div>

              <div className="brief-status">
                <span className="status-dot" />
                {finding ? "CONTEXT ACTIVE" : "LIVE ANALYSIS"}
              </div>
            </div>

            <div className="brief-content">
              <div className="brief-copy">
                <span className="brief-label">
                  {finding ? contextLabel?.toUpperCase() : "TRACE HAS PRIORITIZED"}
                </span>

                <strong>
                  {finding
                    ? finding.person_name || "Selected investigation lead"
                    : "Investigation leads"}
                </strong>

                <p>
                  {finding
                    ? finding.description
                    : "Select a lead on the left to focus the relevant people, relationships and evidence."}
                </p>

                {finding && (
                  <div className="context-proof">
                    <span><b>{evidence.length}</b> supporting records</span>
                    <span><b>{finding.case_count ?? 0}</b> linked cases</span>
                    <span><b>1–2</b> network hops ready</span>
                    <span><b>{view.toUpperCase()}</b> context view</span>
                  </div>
                )}
              </div>

              <div className="brief-actions">
                {quickLeads.map((lead) => (
                  <button key={lead.id} type="button" onClick={() => setView("graph")}>
                    <span>INVESTIGATION THREAD</span>
                    <b>{lead.person_name || "Selected lead"}</b>
                    <small>INSPECT NETWORK →</small>
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

          {(ragLoading || ragAnswer) && (
            <section className="case-query-result">
              <div className="eyebrow">CASE QUESTION / {caseId}</div>
              <h2>{ragLoading ? "Searching indexed case material..." : "Evidence-grounded answer"}</h2>
              {!ragLoading && (
                <div className="rag-answer">
                  <ReactMarkdown>{ragAnswer}</ReactMarkdown>
                </div>
              )}
              {ragSources.length > 0 && <small>Sources: {ragSources.map((source) => `${source.title}${source.event_date ? ` (${source.event_date})` : ""}`).join(" · ")}</small>}
            </section>
          )}

          <div className="analysis-stage">
            {view === "graph" && (
              <GraphView
                searchQuery={query}
                focusPersonId={graphFocusId}
                onPersonSelect={handlePersonSelect}
                onPersonLoading={handlePersonLoading}
                hopDistance={hopDistance}
                contextType={finding?.finding_type}
                contextPerson={finding?.person_name}
                caseId={caseId}
                onEdgeSelect={setEdge}
              />
            )}

            {view === "timeline" && (
              <TimelineView
                personId={person?.id || finding?.person_id}
                personName={person?.name || finding?.person_name}
                finding={finding}
                evidence={evidence}
                loading={evidenceLoading}
                activeEvidenceId={activeEvidenceId}
                onEvidenceSelect={(item) => setActiveEvidenceId(item.id)}
              />
            )}

            {view === "map" && (
              <MapView
                person={person}
                personId={person?.id || finding?.person_id}
                personName={person?.name || finding?.person_name}
                finding={finding}
                evidence={evidence}
                activeEvidenceId={activeEvidenceId}
                onEvidenceSelect={(item) => setActiveEvidenceId(item.id)}
              />
            )}

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
          <section className="edge-detail-panel">
            <div className="section-label">SELECTED CONNECTION</div>
            {edge ? <><strong>{edge.label || edge.relationship || "Relationship"}</strong><p>{edge.source} <span>→</span> {edge.target}</p><small>{edge.kind ? `${edge.kind.toUpperCase()} LINK` : "ENTITY RELATIONSHIP"}</small></> : <div className="edge-empty">Select an edge in entity detail to inspect how these entities are connected.</div>}
          </section>
          <EntityProfile
            person={person}
            finding={finding}
            loading={profileLoading}
            onViewProfile={() => setProfileOpen(true)}
          />

          <EvidencePanel
            evidence={evidence}
            finding={finding}
            loading={evidenceLoading}
            activeEvidenceId={activeEvidenceId}
            onEvidenceSelect={handleEvidenceSelect}
          />
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
