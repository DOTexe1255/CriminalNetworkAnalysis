import InvestigationWorkspace from "./components/InvestigationWorkspace";
import InvestigatorDashboard from "./components/InvestigatorDashboard";
import "./App.css";
import { useState } from "react";

export default function App() {
  const [caseId, setCaseId] = useState<string | null>(null);

  return caseId ? (
    <InvestigationWorkspace initialCaseId={caseId} onBack={() => setCaseId(null)} />
  ) : (
    <InvestigatorDashboard onOpenCase={setCaseId} />
  );
}
