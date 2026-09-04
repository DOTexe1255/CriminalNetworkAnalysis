import { useEffect, useState } from "react";
import "./FindingsPanel.css";
export type Finding = { id:string; finding_type:string; title:string; description:string; importance:string; person_id?:string; person_name?:string; evidence_count?:number; case_count?:number };

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
const API="http://localhost:8000";
export default function FindingsPanel({selectedId,onSelect}:{selectedId?:string;onSelect:(f:Finding)=>void}) {
 const [items,setItems]=useState<Finding[]>([]); const [filter,setFilter]=useState("All");
 useEffect(()=>{
   fetch(`${API}/api/findings`)
     .then(r=>r.ok?r.json():[])
     .then(d=>{
       const raw = Array.isArray(d) ? d : d?.findings ?? [];
       // The backend can currently return the same finding more than once.
       // Keep the first occurrence so React gets a stable, unique key and
       // the investigator does not see duplicate leads.
       const unique = Array.from(
         new Map(raw.map((f: Finding) => [f.id, f])).values()
       );
       setItems(unique);
     })
     .catch(()=>setItems([]))
 },[]);
 const filtered=items.filter(f=>filter==="All"||f.finding_type===filter);
 return <aside className="findings-panel"><div className="panel-heading"><div><span className="eyebrow">INTELLIGENCE</span><h2>Findings</h2></div><span className="finding-count">{items.length}</span></div>
 <div className="finding-filters">{["All","Bridge Entity","Community Connector","Activity Spike","Cross-Case Connection"].map(x=><button key={x} className={filter===x?"active":""} onClick={()=>setFilter(x)}>{x==="All"?"ALL":x}</button>)}</div>
 <div className="finding-list">{filtered.map(f=><button key={f.id} className={`finding-card ${selectedId===f.id?"selected":""}`} onClick={()=>onSelect(f)}>
 <div className="finding-card-top"><span className={`severity severity-${f.importance.toLowerCase()}`}>{f.importance}</span><span className="finding-type">{f.finding_type}</span></div>
 <strong>{f.title.replace(/^(Bridge Entity|Community Connector|Activity Spike|Transaction Pattern|Cross-Case Connection):\s*/,"")}</strong>
 <p>{f.description}</p><small>{f.evidence_count??0} evidence · {f.case_count??0} cases</small></button>)}</div></aside>;
}
