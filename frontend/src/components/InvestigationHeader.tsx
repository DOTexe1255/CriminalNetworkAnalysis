import "./InvestigationHeader.css";
type Props = { query: string; onQueryChange: (value: string) => void; caseId: string; onCaseChange: (value: string) => void; onBack?: () => void };

export default function InvestigationHeader({ query, onQueryChange, caseId, onCaseChange, onBack }: Props) {
	return <header className="trace-header"><button className="header-back" onClick={onBack} disabled={!onBack} aria-label="Back to case register">←</button><div className="trace-brand"><div className="trace-mark">T</div><div><strong>TRACE</strong><span>CRIMINAL NETWORK INTELLIGENCE</span></div></div><div className="case-selector"><span>CASE</span><button onClick={() => onCaseChange(caseId)}>{caseId} ⌄</button></div><label className="entity-search"><span>⌕</span><input value={query} onChange={e => onQueryChange(e.target.value)} placeholder="Search person, phone, account..." /><kbd>⌘ K</kbd></label><button className="header-action">FILTERS</button><button className="header-icon">⋮</button></header>;
}
