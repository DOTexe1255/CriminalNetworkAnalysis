import { useEffect, useState } from "react";
import "./InvestigatorDashboard.css";
import { API_BASE_URL } from "../config";

const API = API_BASE_URL;
type Narrative = { title: string; date: string; text: string };
type Evidence = { id?: string; type: string; date: string; description: string };
type Lead = { name: string; unit: string; role: string };
type CaseItem = {
  id: string; name: string; description?: string; status?: string; priority?: string; lead?: string;
  created_at?: string; event_date?: string; person_count?: number; finding_count?: number;
  narratives?: Narrative[]; evidence?: Evidence[]; lead_details?: Lead[];
  documents?: Array<{ name: string; type?: string; size?: number }>;
};
type Props = { onOpenCase: (caseId: string) => void };
type SortMode = "date_desc" | "date_asc" | "priority";

const blankForm = { name: "", description: "", priority: "Medium", lead: "", narrative: "", evidence: "", evidenceType: "Investigator note" };

export default function InvestigatorDashboard({ onOpenCase }: Props) {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("date_desc");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CaseItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [files, setFiles] = useState<File[]>([]);

  async function loadCases() {
    setLoading(true);
    try {
      const response = await fetch(`${API}/api/cases?search=${encodeURIComponent(query)}&sort=${sort}`);
      if (response.ok) setCases(await response.json());
    } finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(loadCases, 180); return () => window.clearTimeout(timer); }, [query, sort]);

  function editCase(item: CaseItem) {
    setEditing(item);
    setShowForm(false);
    setForm({
      name: item.name, description: item.description || "", priority: item.priority || "Medium",
      lead: item.lead || "", narrative: "", evidence: "", evidenceType: "Investigator note",
    });
  }

  async function submitCase(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const narrative = form.narrative.trim() ? [{ title: "Investigator narrative", date: new Date().toISOString().slice(0, 10), text: form.narrative.trim() }] : [];
    const evidence = form.evidence.trim() ? [{ type: form.evidenceType, date: new Date().toISOString().slice(0, 10), description: form.evidence.trim() }] : [];
    const leadDetails = form.lead.trim() ? [{ name: form.lead.trim(), unit: "Assigned investigation unit", role: "Case Lead" }] : [];
    const existingDocuments = editing?.documents || [];
    const existingNarratives = editing?.narratives || [];
    const existingEvidence = editing?.evidence || [];
    const existingLeads = editing?.lead_details || [];
    const payload = {
      name: form.name, description: form.description, priority: form.priority, status: editing?.status || "Active", lead: form.lead,
      narratives: [...existingNarratives, ...narrative], evidence: [...existingEvidence, ...evidence], lead_details: [...existingLeads, ...leadDetails],
      documents: [...existingDocuments, ...files.map((file) => ({ name: file.name, type: file.type, size: file.size }))],
    };
    try {
      const response = await fetch(editing ? `${API}/api/cases/${encodeURIComponent(editing.id)}` : `${API}/api/cases`, {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!response.ok) return;
      const saved: CaseItem = await response.json();
      if (files.length > 0) {
        const upload = new FormData(); files.forEach((file) => upload.append("files", file));
        await fetch(`${API}/api/cases/${encodeURIComponent(saved.id)}/documents`, { method: "POST", body: upload });
      }
      setEditing(null); setShowForm(false); setForm(blankForm); setFiles([]); await loadCases();
    } finally { setSaving(false); }
  }

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header"><div className="dashboard-brand"><span>TRACE</span><small>CRIMINAL NETWORK INTELLIGENCE</small></div><div className="dashboard-user"><span className="online-dot" /> INVESTIGATOR CONSOLE</div></header>
      <main className="dashboard-content">
        <section className="dashboard-intro"><div><span className="dashboard-kicker">FIELD OPERATIONS / CASE DESK</span><h1>Every case starts with a question.</h1><p>Search the register, compare priorities, and keep the investigation brief current as new evidence arrives.</p></div><button className="register-button" onClick={() => { setEditing(null); setForm(blankForm); setShowForm((current) => !current); }}>{showForm ? "CLOSE INTAKE" : "+ REGISTER NEW CASE"}</button></section>
        <section className="case-toolbar"><label className="case-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search case, lead, description..." /></label><label className="case-sort">SORT<select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="priority">Priority</option></select></label><span className="case-total">{cases.length.toString().padStart(2, "0")} CASES</span></section>
        {(showForm || editing) && <form className="case-form" onSubmit={submitCase}><div className="form-heading"><span className="dashboard-kicker">{editing ? "UPDATE CASE BRIEF" : "NEW CASE INTAKE"}</span><h2>{editing ? `Edit ${editing.name}` : "Build the investigation brief"}</h2></div><label>Case name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Case description<textarea required rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What is known, suspected, or worth tracing?" /></label><div className="form-grid"><label>Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>High</option><option>Medium</option><option>Low</option></select></label><label>Case lead<input value={form.lead} onChange={(e) => setForm({ ...form, lead: e.target.value })} placeholder="Investigator or unit" /></label></div><label>New narrative / timeline note<textarea rows={3} value={form.narrative} onChange={(e) => setForm({ ...form, narrative: e.target.value })} placeholder="Add a dated observation or investigative thread" /></label><div className="form-grid"><label>Evidence type<select value={form.evidenceType} onChange={(e) => setForm({ ...form, evidenceType: e.target.value })}><option>Investigator note</option><option>Call Record</option><option>Financial Record</option><option>Location Event</option><option>Document</option></select></label><label>Evidence detail<input value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} placeholder="Add a new supporting record" /></label></div><label className="file-drop">Attach case files<input type="file" multiple accept=".pdf,.doc,.docx,.csv,.jpg,.png" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />{files.length > 0 && <small>{files.map((file) => file.name).join(" · ")}</small>}</label><div className="form-actions"><button className="submit-case" disabled={saving} type="submit">{saving ? "SAVING..." : editing ? "SAVE CASE UPDATES" : "SUBMIT CASE FOR ANALYSIS"}</button>{editing && <button type="button" className="cancel-button" onClick={() => setEditing(null)}>CANCEL</button>}</div></form>}
        <section className="case-section"><div className="section-top"><div><span className="dashboard-kicker">ACTIVE REGISTER</span><h2>All investigations</h2></div></div>{loading ? <div className="empty-dashboard">Loading case register...</div> : cases.length === 0 ? <div className="empty-dashboard">No cases match this search.</div> : <div className="case-grid">{cases.map((item) => <article className="case-card" key={item.id}><div className="case-card-top"><span className={`priority priority-${(item.priority ?? "medium").toLowerCase()}`}>{item.priority ?? "MEDIUM"}</span><span className="case-status">{item.status ?? "ACTIVE"}</span></div><h3>{item.name}</h3><p>{item.description || "No case description recorded."}</p><div className="case-metrics"><span><b>{item.person_count ?? 0}</b> PEOPLE</span><span><b>{item.finding_count ?? 0}</b> LEADS</span><span><b>{item.evidence?.length ?? 0}</b> EVIDENCE</span></div><div className="case-card-foot"><small>{item.lead || "Unassigned"} · {item.created_at || "Recently added"}</small><div><button className="edit-case" onClick={() => editCase(item)}>EDIT BRIEF</button><button onClick={() => onOpenCase(item.id)}>OPEN ANALYSIS →</button></div></div></article>)}</div>}</section>
      </main>
    </div>
  );
}
