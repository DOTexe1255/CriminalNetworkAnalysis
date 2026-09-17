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
  documents?: Array<{ name: string; type?: string; size?: number; category?: string; description?: string; person_name?: string; url?: string }>;
};
type Props = { onOpenCase: (caseId: string) => void };
type SortMode = "date_desc" | "date_asc" | "priority";
type UploadDraft = { file: File; category: string; description: string; personName: string };
type PersonDraft = { name: string; role: string; statement: string };

const blankForm = { name: "", description: "", priority: "Medium", lead: "", narrative: "", evidence: "", evidenceType: "Investigator note" };

export default function InvestigatorDashboard({ onOpenCase }: Props) {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("date_desc");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CaseItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [form, setForm] = useState(blankForm);
  const [files, setFiles] = useState<UploadDraft[]>([]);
  const [people, setPeople] = useState<PersonDraft[]>([]);

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
    setPeople((item.lead_details || []).filter((lead) => lead.name !== item.lead).map((lead) => ({ name: lead.name, role: lead.role || "Associated person", statement: "" })));
  }

  async function submitCase(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError("");
    let submissionError = "";
    const narrative = form.narrative.trim() ? [{ title: "Investigator narrative", date: new Date().toISOString().slice(0, 10), text: form.narrative.trim() }] : [];
    const evidence = form.evidence.trim() ? [{ type: form.evidenceType, date: new Date().toISOString().slice(0, 10), description: form.evidence.trim() }] : [];
    const leadDetails = form.lead.trim() ? [{ name: form.lead.trim(), unit: "Assigned investigation unit", role: "Case Lead" }] : [];
    const involvedPeople = people.filter((person) => person.name.trim()).map((person) => ({ name: person.name.trim(), unit: "Case record", role: person.role, statement: person.statement.trim() }));
    const existingDocuments = editing?.documents || [];
    const existingNarratives = editing?.narratives || [];
    const existingEvidence = editing?.evidence || [];
    const existingLeads = editing?.lead_details || [];
    const payload = {
      name: form.name, description: form.description, priority: form.priority, status: editing?.status || "Active", lead: form.lead,
      narratives: [...existingNarratives, ...narrative, ...involvedPeople.filter((person) => person.statement).map((person) => ({ title: `${person.role} statement - ${person.name}`, date: new Date().toISOString().slice(0, 10), text: person.statement }))], evidence: [...existingEvidence, ...evidence], lead_details: [...existingLeads, ...leadDetails, ...involvedPeople],
      documents: [...existingDocuments, ...files.map(({ file, category, description, personName }) => ({ name: file.name, type: file.type, size: file.size, category, description, person_name: personName }))],
    };
    try {
      const response = await fetch(editing ? `${API}/api/cases/${encodeURIComponent(editing.id)}` : `${API}/api/cases`, {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!response.ok) {
        submissionError = (await response.text()) || "Case could not be saved.";
        setSaveError(submissionError);
        return;
      }
      const saved: CaseItem = await response.json();
      if (files.length > 0) {
        const upload = new FormData();
        files.forEach(({ file }) => upload.append("files", file));
        upload.append("file_metadata", JSON.stringify(files.map(({ category, description, personName }) => ({ category, description, person_name: personName }))));
        const uploadResponse = await fetch(`${API}/api/cases/${encodeURIComponent(saved.id)}/documents`, { method: "POST", body: upload });
        if (!uploadResponse.ok) {
          submissionError = "Case saved, but one or more files could not be stored.";
          setSaveError(submissionError);
        }
      }
      if (!submissionError) { setEditing(null); setShowForm(false); setForm(blankForm); setFiles([]); setPeople([]); }
      await loadCases();
    } finally { setSaving(false); }
  }

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header"><div className="dashboard-brand"><span>TRACE</span><small>CRIMINAL NETWORK INTELLIGENCE</small></div><div className="dashboard-user"><span className="online-dot" /> INVESTIGATOR CONSOLE</div></header>
      <main className="dashboard-content">
        {saveError && <div className="case-save-error">{saveError}</div>}
        {(showForm || editing) && <section className="intake-people-panel"><div className="intake-block-heading"><div><span>PEOPLE INVOLVED / WITNESSES</span><small>Add names, roles, and recorded statements before submitting the case.</small></div><button type="button" onClick={() => setPeople((current) => [...current, { name: "", role: "Witness", statement: "" }])}>+ ADD PERSON</button></div>{people.map((person, index) => <div className="person-intake-row" key={index}><input placeholder="Full name" value={person.name} onChange={(e) => setPeople((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: e.target.value } : item))} /><select value={person.role} onChange={(e) => setPeople((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, role: e.target.value } : item))}><option>Witness</option><option>Subject for verification</option><option>Associated person</option><option>Reporting officer</option><option>Victim / complainant</option></select><textarea rows={2} placeholder="Recorded statement or relevance" value={person.statement} onChange={(e) => setPeople((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, statement: e.target.value } : item))} /><button type="button" className="remove-upload" onClick={() => setPeople((current) => current.filter((_, itemIndex) => itemIndex !== index))}>REMOVE</button></div>)}</section>}
        <section className="dashboard-intro"><div><span className="dashboard-kicker">FIELD OPERATIONS / CASE DESK</span><h1>Every case starts with a question.</h1><p>Search the register, compare priorities, and keep the investigation brief current as new evidence arrives.</p></div><button className="register-button" onClick={() => { setEditing(null); setForm(blankForm); setFiles([]); setPeople([]); setShowForm((current) => !current); }}>{showForm ? "CLOSE INTAKE" : "+ REGISTER NEW CASE"}</button></section>
        <section className="case-toolbar"><label className="case-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search case, lead, description..." /></label><label className="case-sort">SORT<select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="priority">Priority</option></select></label><span className="case-total">{cases.length.toString().padStart(2, "0")} CASES</span></section>
        {(showForm || editing) && <form className="case-form" onSubmit={submitCase}><div className="form-heading"><span className="dashboard-kicker">{editing ? "UPDATE CASE BRIEF" : "NEW CASE INTAKE"}</span><h2>{editing ? `Edit ${editing.name}` : "Build the investigation brief"}</h2></div><label>Case name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Case description<textarea required rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What is known, suspected, or worth tracing?" /></label><div className="form-grid"><label>Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>High</option><option>Medium</option><option>Low</option></select></label><label>Case lead<input value={form.lead} onChange={(e) => setForm({ ...form, lead: e.target.value })} placeholder="Investigator or unit" /></label></div><label>New narrative / timeline note<textarea rows={3} value={form.narrative} onChange={(e) => setForm({ ...form, narrative: e.target.value })} placeholder="Add a dated observation or investigative thread" /></label><div className="form-grid"><label>Evidence type<select value={form.evidenceType} onChange={(e) => setForm({ ...form, evidenceType: e.target.value })}><option>Investigator note</option><option>Call Record</option><option>Financial Record</option><option>Location Event</option><option>Document</option></select></label><label>Evidence detail<input value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} placeholder="Add a new supporting record" /></label></div><label className="file-drop">Add case media<input type="file" multiple accept=".pdf,.doc,.docx,.csv,.jpg,.jpeg,.png,.webp,.mp3,.wav,.m4a,.mp4" onChange={(e) => setFiles((current) => [...current, ...Array.from(e.target.files ?? []).map((file) => ({ file, category: file.type.startsWith("image/") ? "Important person image" : file.type.startsWith("audio/") ? "Audio record" : "Case document", description: "", personName: "" }))])} /><small>PDFs, documents, audio recordings, case images, and important-person images</small></label>{files.length > 0 && <div className="upload-list">{files.map((draft, index) => <div className="upload-row" key={`${draft.file.name}-${index}`}><strong>{draft.file.name}</strong><select value={draft.category} onChange={(e) => setFiles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, category: e.target.value } : item))}><option>Case document</option><option>Evidence image</option><option>Important person image</option><option>Audio record</option><option>Other</option></select><input placeholder="What does this file show?" value={draft.description} onChange={(e) => setFiles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: e.target.value } : item))} /><input placeholder="Person pictured (optional)" value={draft.personName} onChange={(e) => setFiles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, personName: e.target.value } : item))} /><button type="button" className="remove-upload" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>REMOVE</button></div>)}</div>}<div className="form-actions"><button className="submit-case" disabled={saving} type="submit">{saving ? "SAVING..." : editing ? "SAVE CASE UPDATES" : "SUBMIT CASE FOR ANALYSIS"}</button>{editing && <button type="button" className="cancel-button" onClick={() => setEditing(null)}>CANCEL</button>}</div></form>}
        <section className="case-section"><div className="section-top"><div><span className="dashboard-kicker">ACTIVE REGISTER</span><h2>All investigations</h2></div></div>{loading ? <div className="empty-dashboard">Loading case register...</div> : cases.length === 0 ? <div className="empty-dashboard">No cases match this search.</div> : <div className="case-grid">{cases.map((item) => <article className="case-card" key={item.id}><div className="case-card-top"><span className={`priority priority-${(item.priority ?? "medium").toLowerCase()}`}>{item.priority ?? "MEDIUM"}</span><span className="case-status">{item.status ?? "ACTIVE"}</span></div><h3>{item.name}</h3><p>{item.description || "No case description recorded."}</p><div className="case-metrics"><span><b>{item.person_count ?? 0}</b> PEOPLE</span><span><b>{item.finding_count ?? 0}</b> LEADS</span><span><b>{item.evidence?.length ?? 0}</b> EVIDENCE</span></div><div className="case-card-foot"><small>{item.lead || "Unassigned"} · {item.created_at || "Recently added"}</small><div><button className="edit-case" onClick={() => editCase(item)}>EDIT BRIEF</button><button onClick={() => onOpenCase(item.id)}>OPEN ANALYSIS →</button></div></div></article>)}</div>}</section>
      </main>
    </div>
  );
}
