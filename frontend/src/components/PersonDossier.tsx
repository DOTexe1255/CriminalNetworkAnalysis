import { useEffect, type ReactNode } from "react";
import type { PersonDetails } from "./EntityProfile";
import "./PersonDossier.css";

type Props = {
  person: PersonDetails | null;
  open: boolean;
  onClose: () => void;
};

const valueOrDash = (value?: string | null) => value && value.trim() ? value : "Not recorded";

export default function PersonDossier({ person, open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || !person) return null;

  const vehicles = (person.vehicles ?? []).filter(Boolean);
  const devices = (person.devices ?? []).filter(Boolean);
  const aliases = Array.isArray(person.aliases)
    ? person.aliases
    : person.aliases
      ? String(person.aliases).split(",").map((x) => x.trim()).filter(Boolean)
      : [];

  return (
    <div className="dossier-backdrop" onMouseDown={onClose}>
      <section
        className="person-dossier"
        role="dialog"
        aria-modal="true"
        aria-label={`Full profile for ${person.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dossier-header">
          <div>
            <div className="dossier-eyebrow">PERSON DOSSIER</div>
            <h2>{person.name}</h2>
            <div className="dossier-subtitle">
              Network Group {String(person.community_id ?? "—").padStart(2, "0")}
              <span>•</span>
              ID {person.id}
            </div>
          </div>
          <button className="dossier-close" onClick={onClose} aria-label="Close profile">×</button>
        </header>

        <div className="dossier-body">
          <section className="dossier-hero">
            <div className="avatar-placeholder">{person.name?.slice(0, 2).toUpperCase()}</div>
            <div>
              <div className="hero-label">PROFILE SUMMARY</div>
              <p>{valueOrDash(person.bio)}</p>
            </div>
          </section>

          <div className="dossier-grid">
            <DossierSection title="Personal details">
              <Detail label="Full name" value={person.name} />
              <Detail label="Date of birth" value={valueOrDash(person.date_of_birth)} />
              <Detail label="Occupation" value={valueOrDash(person.occupation)} />
              <Detail label="Aliases" value={aliases.length ? aliases.join(", ") : "Not recorded"} />
            </DossierSection>

            <DossierSection title="Address">
              <Detail label="Address" value={valueOrDash(person.address)} wide />
              <Detail label="City" value={valueOrDash(person.city)} />
            </DossierSection>

            <DossierSection title="Identity & contact">
              <Detail label="ID card" value={valueOrDash(person.national_id)} />
              <Detail label="Phone numbers" value={person.phone_numbers?.length ? person.phone_numbers.join(", ") : "Not recorded"} wide />
              <Detail label="Bank accounts" value={person.bank_accounts?.length ? person.bank_accounts.join(", ") : "Not recorded"} wide />
            </DossierSection>

            <DossierSection title={`Vehicles (${vehicles.length})`}>
              {vehicles.length ? vehicles.map((vehicle) => (
                <div className="asset-row" key={vehicle.id}>
                  <div>
                    <strong>{valueOrDash(vehicle.model)}</strong>
                    <span>{valueOrDash(vehicle.plate_no)}</span>
                  </div>
                  <code>{vehicle.id}</code>
                </div>
              )) : <EmptyState text="No vehicle records found" />}
            </DossierSection>

            <DossierSection title={`Devices (${devices.length})`}>
              {devices.length ? devices.map((device) => (
                <div className="asset-row" key={device.id}>
                  <div>
                    <strong>{valueOrDash(device.device_type)}</strong>
                    <span>IMEI: {valueOrDash(device.imei)}</span>
                  </div>
                  <code>{device.id}</code>
                </div>
              )) : <EmptyState text="No device records found" />}
            </DossierSection>

            <DossierSection title="Organizations">
              {person.organizations?.length ? (
                <div className="chip-list">
                  {person.organizations.map((org) => <span key={org}>{org}</span>)}
                </div>
              ) : <EmptyState text="No organization records found" />}
            </DossierSection>
          </div>

          <div className="dossier-footer-note">
            <span>DATA PROVENANCE</span>
            <p>Profile information is displayed from records available in the investigation dataset. Missing fields are not inferred.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function DossierSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dossier-section">
      <div className="dossier-section-title">{title}</div>
      <div className="dossier-section-content">{children}</div>
    </section>
  );
}

function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`detail-row ${wide ? "detail-wide" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="dossier-empty">{text}</div>;
}
