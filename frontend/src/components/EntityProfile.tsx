import type { Finding } from "./FindingsPanel";
import { humanType } from "./FindingsPanel";
import "./EntityProfile.css";

export type PersonDetails = {
  id: string;
  name: string;
  national_id?: string;
  degree_centrality: number;
  betweenness_centrality: number;
  community_id: number;
  phone_numbers: string[];
  bank_accounts: string[];
  organizations: string[];
  date_of_birth?: string;
  occupation?: string;
  address?: string;
  city?: string;
  aliases?: string | string[];
  bio?: string;
  vehicles?: Array<{ id: string; model?: string; plate_no?: string }>;
  devices?: Array<{ id: string; device_type?: string; imei?: string }>;
};

export default function EntityProfile({
  person,
  finding,
  loading = false,
  onViewProfile,
}: {
  person: PersonDetails | null;
  finding: Finding | null;
  loading?: boolean;
  onViewProfile?: () => void;
}) {
  if (loading) return <section className="entity-profile profile-loading"><LoadingCard /></section>;

  if (!person)
    return (
      <section className="entity-profile empty-profile">
        <span className="eyebrow">INVESTIGATION DETAIL</span>
        <div className="empty-icon">◎</div>
        <h3>Nothing selected yet</h3>
        <p>Select an investigation lead and Trace will focus the relevant person and relationships for you.</p>
      </section>
    );

  const significance = person.betweenness_centrality >= 0.25 ? "High" : person.betweenness_centrality >= 0.15 ? "Medium" : "Low";
  const displayConnections = Math.round((person.degree_centrality || 0) * 1000);

  return (
    <section className="entity-profile">
      <div className="profile-eyebrow">PERSON UNDER REVIEW</div>
      <div className="profile-name">{person.name}</div>
      <div className="profile-tags">
        <span>NETWORK GROUP {String(person.community_id).padStart(2, "0")}</span>
        <span className={`tag-${significance.toLowerCase()}`}>{significance}</span>
      </div>

      {finding && (
        <div className="why-matters">
          <div className="section-label">WHY THIS MATTERS</div>
          <strong>{humanType(finding.finding_type)}</strong>
          <p>{finding.description}</p>
          <button className="profile-action">VIEW SUPPORTING RECORDS ↓</button>
        </div>
      )}

      <div className="metrics">
        <div>
          <span>Direct connections</span>
          <b>{displayConnections}</b>
        </div>
        <div>
          <span>Network significance</span>
          <b>{significance}</b>
        </div>
      </div>

      <button
        className="view-profile-button"
        onClick={onViewProfile}
        type="button"
      >
        <span>VIEW FULL PROFILE</span>
        <b>↗</b>
      </button>

      <div className="profile-section-label">IDENTIFIERS</div>
      <dl className="entity-facts">
        <Fact label="ID card" value={person.national_id || "—"} />
        <Fact label="Phones" value={person.phone_numbers?.join(", ") || "—"} />
        <Fact label="Bank accounts" value={person.bank_accounts?.join(", ") || "—"} />
        <Fact label="Organizations" value={person.organizations?.join(", ") || "—"} />
      </dl>

      <div className="profile-note">
        <span>INVESTIGATOR CONTROL</span>
        <p>Trace surfaces relationships and supporting records. It does not determine wrongdoing.</p>
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="entity-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LoadingCard() {
  return <div className="profile-skeleton">
    <div className="skeleton-line short" />
    <div className="skeleton-line title" />
    <div className="skeleton-block" />
    <div className="skeleton-row" />
    <div className="skeleton-row" />
    <div className="skeleton-row" />
  </div>;
}
