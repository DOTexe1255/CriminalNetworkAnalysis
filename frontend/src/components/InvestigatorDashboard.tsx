import { useEffect, useState } from "react";
import "./InvestigatorDashboard.css";

const API = "http://localhost:8000";

type CaseItem = {
  id: string;
  name: string;
  description?: string;
  status?: string;
  priority?: string;
  lead?: string;
  created_at?: string;
  person_count?: number;
  finding_count?: number;
  documents?: Array<{ name: string; type?: string; size?: number }>;
  evidence?: Array<{ type: string; description: string; source?: string }>;
};

type Props = { onOpenCase: (caseId: string) => void };

export default function InvestigatorDashboard({ onOpenCase }: Props) {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", description: "", priority: "Medium", lead: "", evidence: "" });
  const [files, setFiles] = useState<File[]>([]);

  async function loadCases() {
    setLoading(true);
    try {
      const response = await fetch(`${API}/api/cases`);
      if (response.ok) setCases(await response.json());
    } finally { setLoading(false); }
  }

  useEffect(() => { loadCases(); }, []);

  async function submitCase(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`${API}/api/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        status: "Active",
        documents: files.map((file) => ({ name: file.name, type: file.type, size: file.size })),
        evidence: form.evidence ? [{ type: "Investigator note", description: form.evidence, source: "Manual entry" }] : [],
      }),
    });
    if (response.ok) {
      const created = await response.json();
      setCases((current) => [created, ...current]);
      setForm({ name: "", description: "", priority: "Medium", lead: "", evidence: "" });
      setFiles([]);
      setShowForm(false);
    }
  }

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-brand"><span>TRACE</span><small>CRIMINAL NETWORK INTELLIGENCE</small></div>
        <div className="dashboard-user"><span className="online-dot" /> INVESTIGATOR CONSOLE</div>
      </header>
      <main className="dashboard-content">
        <section className="dashboard-intro">
          <div><span className="dashboard-kicker">FIELD OPERATIONS / CASE DESK</span><h1>Every case starts with a question.</h1><p>Register a lead, attach its source material, then follow the network where the evidence takes you.</p></div>
          <button className="register-button" onClick={() => setShowForm((current) => !current)}>{showForm ? "CLOSE FORM" : "+ REGISTER NEW CASE"}</button>
        </section>
        {showForm && <form className="case-form" onSubmit={submitCase}>
          <div className="form-heading"><span className="dashboard-kicker">NEW CASE INTAKE</span><h2>Build the investigation brief</h2></div>
          <label>Case name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Operation Silver Thread" /></label>
          <label>Investigation description<textarea required rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What is known, suspected, or worth tracing?" /></label>
          <div className="form-grid"><label>Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>High</option><option>Medium</option><option>Low</option></select></label><label>Lead unit<input value={form.lead} onChange={(e) => setForm({ ...form, lead: e.target.value })} placeholder="Assigned team" /></label></div>
          <label>Evidence note<textarea rows={2} value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} placeholder="Add an initial evidence or document note" /></label>
          <label className="file-drop">Attach documents / PDFs<input type="file" multiple accept=".pdf,.doc,.docx,.csv,.jpg,.png" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />{files.length > 0 && <small>{files.map((file) => file.name).join(" · ")}</small>}</label>
          <button className="submit-case" type="submit">SUBMIT CASE FOR ANALYSIS <span>→</span></button>
        </form>}
        <section className="case-section"><div className="section-top"><div><span className="dashboard-kicker">ACTIVE REGISTER</span><h2>All investigations</h2></div><span className="case-total">{cases.length.toString().padStart(2, "0")} CASES</span></div>
          {loading ? <div className="empty-dashboard">Loading case register...</div> : <div className="case-grid">{cases.map((item) => <article className="case-card" key={item.id}><div className="case-card-top"><span className={`priority priority-${(item.priority ?? "medium").toLowerCase()}`}>{item.priority ?? "MEDIUM"}</span><span className="case-status">{item.status ?? "ACTIVE"}</span></div><h3>{item.name}</h3><p>{item.description || "No case description recorded."}</p><div className="case-metrics"><span><b>{item.person_count ?? 0}</b> PEOPLE</span><span><b>{item.finding_count ?? 0}</b> LEADS</span><span><b>{item.documents?.length ?? 0}</b> DOCS</span></div><div className="case-card-foot"><small>{item.lead || "Unassigned"} · {item.created_at || "Recently added"}</small><button onClick={() => onOpenCase(item.id)}>OPEN ANALYSIS →</button></div></article>)}</div>}
        </section>
      </main>
    </div>
  );
}
