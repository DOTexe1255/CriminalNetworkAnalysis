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
type ChatSource = { title?: string; event_date?: string | null; source_record_id?: string | null };
type ChatMessage = { id: string; role: "user" | "assistant"; text: string; sources?: ChatSource[]; error?: boolean };

export default function InvestigationWorkspace({ initialCaseId = "case_00000", onBack }: WorkspaceProps) {
  const [person, setPerson] = useState<PersonDetails | null>(null);
  const [finding, setFinding] = useState<Finding | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [view, setView] = useState<AnalysisView>("graph");
  const [briefCollapsed, setBriefCollapsed] = useState(false);
  const [ragCollapsed, setRagCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [caseId, setCaseId] = useState(initialCaseId);
  const [profileLoading, setProfileLoading] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [graphFocusId, setGraphFocusId] = useState<string | undefined>();
  const [hopDistance, setHopDistance] = useState<0 | 1 | 2>(0);
  const [edge, setEdge] = useState<EdgeDetails | null>(null);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragError, setRagError] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  async function askCase(questionOverride?: string) {
    const question = (questionOverride || chatInput.trim() || "What are the strongest evidence-backed leads in this case?").trim();
    if (!question || ragLoading) return;
    setChatInput("");
    setRagLoading(true);
    setRagError("");
    setRagCollapsed(false);
    const messageId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setChatMessages((current) => [...current, { id: `${messageId}-question`, role: "user", text: question }]);
    try {
      const response = await fetch(`${API}/api/rag/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: caseId, question }),
      });
      const data = await response.json();
      if (!response.ok) {
        const detail = data.detail || "Case query is unavailable.";
        setRagError(detail);
        setChatMessages((current) => [...current, { id: `${messageId}-error`, role: "assistant", text: detail, error: true }]);
      } else {
        const answer = data.answer || "The available case records did not produce an answer.";
        const sources = data.sources || [];
        setChatMessages((current) => [...current, { id: `${messageId}-answer`, role: "assistant", text: answer, sources }]);
      }
    } catch {
      setRagError("Case query is unavailable. Check that the API is running.");
      setChatMessages((current) => [...current, { id: `${messageId}-error`, role: "assistant", text: "Case query is unavailable. Check that the API is running.", error: true }]);
    } finally {
      setRagLoading(false);
    }
  }

  async function summarizeCase() {
    if (ragLoading) return;
    setRagLoading(true);
    setRagError("");
    setQuery("Case summary");
    setRagCollapsed(false);
    const messageId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setChatMessages((current) => [...current, { id: `${messageId}-question`, role: "user", text: "Summarize this case" }]);
    try {
      const response = await fetch(`${API}/api/case/${encodeURIComponent(caseId)}/summary`);
      const data = await response.json();
      if (!response.ok) {
        const detail = data.detail || "Case summary is unavailable.";
        setRagError(detail);
        setChatMessages((current) => [...current, { id: `${messageId}-error`, role: "assistant", text: detail, error: true }]);
      } else {
        const answer = data.answer || "No case summary was returned.";
        const sources = data.sources || [];
        setChatMessages((current) => [...current, { id: `${messageId}-answer`, role: "assistant", text: answer, sources }]);
      }
    } catch {
      setRagError("Case summary is unavailable. Check that the API is running.");
      setChatMessages((current) => [...current, { id: `${messageId}-error`, role: "assistant", text: "Case summary is unavailable. Check that the API is running.", error: true }]);
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
    setGraphFocusId(undefined);
    setHopDistance(0);
    setRagError("");
    setChatInput("");
    setChatMessages([]);
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

  const handleHopChange = useCallback((hop: 0 | 1 | 2) => {
    if (hop === 0) {
      // Reset is a complete graph reset: clear both the hop mode and the
      // selected graph person so GraphView can remove every focus class.
      setHopDistance(0);
      setGraphFocusId(undefined);
      setEdge(null);
      return;
    }

    // graphFocusId is the authoritative selection because it is populated
    // immediately when a graph node is clicked. The profile/person state can
    // still be null for a moment while its API request is loading.
    const targetId = graphFocusId || person?.id || finding?.person_id;
    if (!targetId) return;

    setGraphFocusId(targetId);
    setHopDistance(hop);
  }, [graphFocusId, person?.id, finding?.person_id]);

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
        asking={ragLoading}
      />

      <div className="trace-main">
        <FindingsPanel
          selectedId={finding?.id}
          caseId={caseId}
          onSelect={setFinding}
        />

        <main className="trace-center">
          <section className={`investigation-brief ${briefCollapsed ? "is-collapsed" : ""}`}>
            <div className="brief-heading">
              <div>
                <span className="eyebrow">
                  {finding ? "INVESTIGATION CONTEXT" : "INVESTIGATION BRIEF"}
                </span>
                {!briefCollapsed && (
                  <h1>
                    {finding
                      ? "Trace built an investigation thread"
                      : "What deserves attention"}
                  </h1>
                )}
              </div>

              <div className="brief-heading-actions">
                <div className="brief-status">
                  <span className="status-dot" />
                  {finding ? "CONTEXT ACTIVE" : "LIVE ANALYSIS"}
                </div>
                <button
                  type="button"
                  className="brief-collapse-btn"
                  onClick={() => setBriefCollapsed((current) => !current)}
                  aria-label={briefCollapsed ? "Expand investigation summary" : "Minimize investigation summary"}
                  title={briefCollapsed ? "Expand summary" : "Minimize summary"}
                >
                  {briefCollapsed ? "+" : "−"}
                </button>
              </div>
            </div>

            {!briefCollapsed && (
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
            )}
          </section>

          <section className={`case-query-result case-chat ${ragCollapsed ? "is-collapsed" : ""}`}>
              <div className="case-query-header">
                <div>
                  <div className="eyebrow">TRACE CASE ASSISTANT / {caseId}</div>
                  {!ragCollapsed && (
                    <h2>{ragLoading ? "Reviewing indexed case material..." : "Ask this case"}</h2>
                  )}
                </div>
                <div className="case-chat-actions">
                  {chatMessages.length > 0 && <button type="button" className="chat-clear" onClick={() => setChatMessages([])}>CLEAR</button>}
                  <button type="button" className="case-query-collapse-btn" onClick={() => setRagCollapsed((current) => !current)} aria-label={ragCollapsed ? "Expand case assistant" : "Minimize case assistant"} title={ragCollapsed ? "Expand assistant" : "Minimize assistant"}>{ragCollapsed ? "+" : "−"}</button>
                </div>
              </div>

              {!ragCollapsed && (
                <>
                  <div className="case-chat-intro">Ask about recorded people, evidence, timelines, relationships, or what still needs verification. Answers stay grounded in this case's indexed records.</div>
                  <div className="chat-suggestions">
                    {["What are the strongest evidence-backed leads?", "Which people and records are linked?", "What remains unverified in this case?"] .map((suggestion) => <button key={suggestion} type="button" onClick={() => askCase(suggestion)} disabled={ragLoading}>{suggestion}</button>)}
                  </div>
                  <div className="chat-thread" aria-live="polite">
                    {chatMessages.length === 0 && <div className="chat-empty"><span>READY FOR CASE QUESTIONS</span><b>Start with a suggested question or type your own below.</b></div>}
                    {chatMessages.map((message) => <div className={`chat-message chat-message-${message.role} ${message.error ? "has-error" : ""}`} key={message.id}><span className="chat-role">{message.role === "user" ? "YOU" : "TRACE AI"}</span>{message.role === "assistant" ? <div className="rag-answer"><ReactMarkdown>{message.text}</ReactMarkdown></div> : <p>{message.text}</p>}{message.sources && message.sources.length > 0 && <div className="chat-sources">{message.sources.map((source, index) => <span key={`${source.title || "record"}-${source.event_date || index}`}>{source.title || "Case record"}{source.event_date ? ` · ${source.event_date}` : ""}{source.source_record_id ? ` · ${source.source_record_id}` : ""}</span>)}</div>}</div>)}
                    {ragLoading && <div className="chat-message chat-message-assistant chat-thinking"><span className="chat-role">TRACE AI</span><p>Searching the case evidence and relationship context<span className="typing-dots">...</span></p></div>}
                  </div>
                  {ragError && !ragLoading && <div className="rag-error-message">{ragError}</div>}
                  <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void askCase(chatInput); }}><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Ask a question about this case..." disabled={ragLoading} aria-label="Ask a question about this case" /><button type="submit" disabled={ragLoading || !chatInput.trim()}>{ragLoading ? "SEARCHING" : "SEND"}</button></form>
                </>
              )}
            </section>

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
              onHopChange={handleHopChange}
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
