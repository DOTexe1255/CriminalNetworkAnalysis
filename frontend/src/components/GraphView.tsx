import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core, type NodeSingular } from "cytoscape";
import "./GraphView.css";

const API = "http://localhost:8000";

type PersonDetails = {
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
  aliases?: string[];
  bio?: string;
  vehicles?: Array<{ id: string; plate_no?: string; model?: string }>;
  devices?: Array<{ id: string; imei?: string; device_type?: string }>;
};

type Props = {
  searchQuery?: string;
  focusPersonId?: string;
  onPersonSelect?: (person: PersonDetails) => void;
  onPersonLoading?: (personId: string) => void;
  hopDistance?: 0 | 1 | 2;
  contextType?: string;
  contextPerson?: string;
  caseId?: string;
};

const ICONS: Record<string, string> = {
  person: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="7" r="3.2" fill="none" stroke="#11161c" stroke-width="1.8"/><path d="M5.5 20c.7-4.2 3-6.2 6.5-6.2s5.8 2 6.5 6.2" fill="none" stroke="#11161c" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  phone: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7.2 4.5l3 2.1-1.8 2.7c1 2 2.3 3.3 4.3 4.3l2.7-1.8 2.1 3c.5.8.3 1.8-.4 2.3l-1.5 1c-1 .7-2.3.8-3.4.2-4.6-2.3-7.7-5.4-10-10-.6-1.1-.5-2.4.2-3.4l1-1.5c.5-.7 1.5-.9 2.3-.4z" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  account: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M3 9h18M7 14h4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  vehicle: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 15l1.5-5h11l1.5 5v4h-2v-2H7v2H5z" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M7 10l1.2-3h7.6l1.2 3M7 15h.1M17 15h.1" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  device: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="18" r=".8" fill="#fff"/></svg>`,
  location: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 21s6-5.4 6-11a6 6 0 1 0-12 0c0 5.6 6 11 6 11z" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="10" r="2" fill="none" stroke="#fff" stroke-width="1.5"/></svg>`,
  event: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M7 3v4M17 3v4M4 9h16" stroke="#fff" stroke-width="1.5"/><path d="M8 13h2M12 13h2M8 16h2" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  organization: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 20V7l7-3 7 3v13" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M9 9h2M13 9h2M9 13h2M13 13h2M10 20v-3h4v3" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  case: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3.5 7.5h6l1.5 2h9.5v9H3.5z" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M3.5 7.5V5.5h6l1.5 2" fill="none" stroke="#fff" stroke-width="1.5"/></svg>`,
};

function iconData(type: string) {
  const key = type.toLowerCase().replace(/[^a-z]/g, "");
  const svg = ICONS[key] || ICONS.person;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function normalize(elements: any[]) {
  return elements.map((el) => {
    if (!el?.data) return el;
    const data = { ...el.data };
    if (!data.label && data.name) data.label = data.name;
    if (!data.name && data.label && data.entityType === "Person") data.name = data.label;
    return { ...el, data };
  });
}

function addClasses(cy: Core, entityMode: boolean) {
  cy.nodes().forEach((node) => {
    const rawType = String(node.data("entityType") || "");
    if (entityMode && rawType) {
      const type = rawType.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      node.addClass(`entity-${type}`);
      node.data("icon", iconData(type));
      node.addClass("entity-icon-node");
    }
    if (!entityMode) node.addClass("network-node");
    node.addClass("labeled");
  });
  cy.edges().forEach((edge) => {
    const kind = String(edge.data("kind") || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (kind) edge.addClass(`edge-${kind}`);
  });
}

function focusNeighborhood(cy: Core, personId: string, hops: number, entityMode: boolean) {
  cy.nodes().removeClass("focused related dimmed");
  cy.edges().removeClass("focused dimmed");
  if (!personId || hops === 0) return;

  const root = cy.getElementById(personId);
  if (!root.length) return;

  const visible = new Set<string>([root.id()]);
  let frontier = [root.id()];
  for (let depth = 0; depth < hops; depth += 1) {
    const next: string[] = [];
    frontier.forEach((id) => {
      cy.getElementById(id).neighborhood("node").forEach((n) => {
        if (!visible.has(n.id())) {
          visible.add(n.id());
          next.push(n.id());
        }
      });
    });
    frontier = next;
  }

  const visibleNodes = cy.nodes().filter((n) => visible.has(n.id()));
  const visibleEdges = cy.edges().filter((e) => visible.has(e.source().id()) && visible.has(e.target().id()));

  cy.nodes().not(visibleNodes).addClass("dimmed");
  cy.edges().not(visibleEdges).addClass("dimmed");
  root.addClass("focused");
  visibleNodes.not(root).addClass("related");
  visibleEdges.addClass("focused");

  cy.animate(
    { center: { eles: root }, zoom: entityMode ? 1.3 : hops === 1 ? 1.65 : 1.35 },
    { duration: 420 }
  );
}

export default function GraphView({
  searchQuery = "",
  focusPersonId,
  onPersonSelect,
  onPersonLoading,
  hopDistance = 0,
  contextType,
  contextPerson,
  caseId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const modeRef = useRef(false);
  const focusRef = useRef<string | undefined>(focusPersonId);
  const hopRef = useRef(hopDistance);
  const onPersonSelectRef = useRef(onPersonSelect);
  const onPersonLoadingRef = useRef(onPersonLoading);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [entityMode, setEntityMode] = useState(false);

  useEffect(() => { onPersonSelectRef.current = onPersonSelect; }, [onPersonSelect]);
  useEffect(() => { onPersonLoadingRef.current = onPersonLoading; }, [onPersonLoading]);
  useEffect(() => { focusRef.current = focusPersonId; }, [focusPersonId]);
  useEffect(() => { hopRef.current = hopDistance; }, [hopDistance]);

  // Stable NETWORK graph: finding selection never causes a reload.
  useEffect(() => {
    if (entityMode) return;
    let cancelled = false;

    async function loadNetwork() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch(`${API}/api/graph?limit=150`);
        if (!response.ok) throw new Error(`Backend returned ${response.status}`);
        const data = await response.json();
        if (cancelled || !containerRef.current) return;
        cyRef.current?.destroy();

        const cy = cytoscape({
          container: containerRef.current,
          elements: normalize(data.elements || []),
          style: [
            { selector: "node", style: { label: "data(label)", "font-family": "'IBM Plex Mono', monospace", "font-size": 9, color: "#C7CDD6", "text-valign": "bottom", "text-margin-y": 7, "text-background-color": "#10151C", "text-background-opacity": 0.92, "text-background-padding": 2, width: "mapData(degree, 0, 0.1, 16, 46)", height: "mapData(degree, 0, 0.1, 16, 46)", "border-width": 1, "border-color": "#0B0E11" } },
            { selector: "node.tier-low", style: { "background-color": "#5B7A9D" } },
            { selector: "node.tier-mid", style: { "background-color": "#8A8F98" } },
            { selector: "node.tier-high", style: { "background-color": "#D9A441" } },
            { selector: "edge", style: { width: 2.2, "line-color": "#536170", "curve-style": "haystack", opacity: 0.82 } },
            { selector: "edge.focused", style: { width: 3.2, "line-color": "#D9A441", opacity: 1 } },
            { selector: "node.focused", style: { "border-width": 4, "border-color": "#F0C66B", "z-index": 20, label: "data(label)" } },
            { selector: "node.related", style: { "border-width": 2, "border-color": "#AEB7C2" } },
            { selector: "node.dimmed", style: { opacity: 0.08, label: "" } },
            { selector: "edge.dimmed", style: { opacity: 0.025 } },
            { selector: "node.hovered", style: { "border-width": 2, "border-color": "#AEB7C2" } },
            { selector: "node.loading-selection", style: { "border-width": 3, "border-color": "#F0C66B", "border-style": "dashed" } },
          ],
          layout: { name: "cose", animate: false, nodeRepulsion: 9000, idealEdgeLength: 80, gravity: 32 },
        });

        const nodes = cy.nodes().sort((a, b) => (b.data("betweenness") || 0) - (a.data("betweenness") || 0));
        nodes.forEach((node, i) => node.addClass(i < nodes.length * 0.1 ? "tier-high" : i < nodes.length * 0.35 ? "tier-mid" : "tier-low"));
        nodes.forEach((node) => node.addClass("labeled"));
        addClasses(cy, false);

        cy.on("tap", "node", async (event) => {
          const node = event.target as NodeSingular;
          const personId = node.data("personId") || node.id();
          onPersonLoadingRef.current?.(personId);
          node.addClass("loading-selection");
          try {
            const response = await fetch(`${API}/api/person/${encodeURIComponent(personId)}`);
            if (!response.ok) return;
            onPersonSelectRef.current?.(await response.json());
          } catch (err) { console.error("Failed to load person details:", err); }
          finally { node.removeClass("loading-selection"); }
        });
        cy.on("mouseover", "node", (e) => e.target.addClass("hovered"));
        cy.on("mouseout", "node", (e) => e.target.removeClass("hovered"));
        cyRef.current = cy;
        setError("");
        focusNeighborhood(cy, focusRef.current || "", hopRef.current, false);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Could not load the investigation network.");
      } finally { if (!cancelled) setLoading(false); }
    }

    loadNetwork();
    return () => { cancelled = true; };
  }, [caseId, entityMode]);

  // ENTITY DETAIL graph intentionally reloads when the selected person changes,
  // because its data source is a different graph centered on that person.
  useEffect(() => {
    if (!entityMode || !focusPersonId) return;
    let cancelled = false;

    async function loadEntityGraph() {
      try {
        setLoading(true);
        setError("");
        const url = `${API}/api/entity-graph?person_id=${encodeURIComponent(focusPersonId)}&hop=${hopDistance || 1}${caseId ? `&case_id=${encodeURIComponent(caseId)}` : ""}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Entity graph returned ${response.status}`);
        const data = await response.json();
        if (cancelled || !containerRef.current) return;
        cyRef.current?.destroy();

        const cy = cytoscape({
          container: containerRef.current,
          elements: normalize(data.elements || []),
          style: [
            { selector: "node", style: { label: "data(label)", "font-family": "'IBM Plex Mono', monospace", "font-size": 9, color: "#D6DCE3", "text-valign": "bottom", "text-margin-y": 8, "text-background-color": "#0E1319", "text-background-opacity": 0.95, "text-background-padding": 2, width: "data(size)", height: "data(size)", "border-width": 1, "border-color": "#0B0E11", "background-image": "data(icon)", "background-fit": "contain", "background-clip": "node", "background-opacity": 1 } },
            { selector: "node.entity-person", style: { "background-color": "#D9A441", shape: "ellipse" } },
            { selector: "node.entity-phone", style: { "background-color": "#6689A9", shape: "round-rectangle" } },
            { selector: "node.entity-account", style: { "background-color": "#7F8791", shape: "rectangle" } },
            { selector: "node.entity-vehicle", style: { "background-color": "#9A8060", shape: "diamond" } },
            { selector: "node.entity-device", style: { "background-color": "#657A78", shape: "round-rectangle" } },
            { selector: "node.entity-location", style: { "background-color": "#718E78", shape: "hexagon" } },
            { selector: "node.entity-event", style: { "background-color": "#8A8F98", shape: "ellipse" } },
            { selector: "node.entity-organization", style: { "background-color": "#8C7A9B", shape: "rectangle" } },
            { selector: "node.entity-case", style: { "background-color": "#A37B56", shape: "round-rectangle" } },
            { selector: "edge", style: { width: 1.8, "line-color": "#536170", "curve-style": "bezier", opacity: 0.8, "target-arrow-shape": "triangle", "target-arrow-color": "#536170", label: "data(label)", "font-size": 7, color: "#7F8995", "text-background-color": "#0E1319", "text-background-opacity": 0.8, "text-background-padding": 2 } },
            { selector: "edge.focused", style: { width: 3, "line-color": "#D9A441", "target-arrow-color": "#D9A441", opacity: 1 } },
            { selector: "edge.edge-communication", style: { "line-style": "dashed" } },
            { selector: "edge.edge-transaction", style: { "line-style": "dashed" } },
            { selector: "node.focused", style: { "border-width": 5, "border-color": "#F0C66B", "z-index": 30, label: "data(label)" } },
            { selector: "node.related", style: { "border-width": 2, "border-color": "#C7CDD6" } },
            { selector: "node.dimmed", style: { opacity: 0.07, label: "" } },
            { selector: "edge.dimmed", style: { opacity: 0.025 } },
            { selector: "node.hovered", style: { "border-width": 2, "border-color": "#E3E7EC" } },
            { selector: "node.loading-selection", style: { "border-width": 3, "border-color": "#F0C66B", "border-style": "dashed" } },
          ],
          layout: { name: "cose", animate: false, nodeRepulsion: 11000, idealEdgeLength: 110, gravity: 30 },
        });
        addClasses(cy, true);

        cy.on("tap", "node", async (event) => {
          const node = event.target as NodeSingular;
          const personId = node.data("personId") || (node.data("entityType") === "Person" ? node.id() : null);
          if (!personId) return;
          onPersonLoadingRef.current?.(personId);
          node.addClass("loading-selection");
          try {
            const response = await fetch(`${API}/api/person/${encodeURIComponent(personId)}`);
            if (!response.ok) return;
            onPersonSelectRef.current?.(await response.json());
          } catch (err) { console.error("Failed to load person details:", err); }
          finally { node.removeClass("loading-selection"); }
        });
        cy.on("mouseover", "node", (e) => e.target.addClass("hovered"));
        cy.on("mouseout", "node", (e) => e.target.removeClass("hovered"));
        cy.on("tap", "edge", (e) => { cy.edges().removeClass("focused"); e.target.addClass("focused"); });
        cyRef.current = cy;
        setError("");
        focusNeighborhood(cy, focusPersonId, hopDistance || 1, true);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Entity detail graph is unavailable. Add the /api/entity-graph endpoint to the backend.");
      } finally { if (!cancelled) setLoading(false); }
    }

    loadEntityGraph();
    return () => { cancelled = true; };
  }, [entityMode, focusPersonId, hopDistance, caseId]);

  // In NETWORK mode, finding selection only changes visual focus.
  useEffect(() => {
    if (!entityMode && cyRef.current) focusNeighborhood(cyRef.current, focusPersonId || "", hopDistance, false);
  }, [focusPersonId, hopDistance, entityMode]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;
    cy.nodes().removeClass("focused related dimmed");
    const matches = cy.nodes().filter((n) => String(n.data("label") || n.data("name") || "").toLowerCase().includes(q));
    if (!matches.length) return;
    const primary = matches.first();
    const neighborhood = primary.closedNeighborhood();
    cy.nodes().not(neighborhood.nodes()).addClass("dimmed");
    cy.edges().not(neighborhood.edges()).addClass("dimmed");
    matches.addClass("focused");
    neighborhood.nodes().not(matches).addClass("related");
    cy.animate({ center: { eles: primary }, zoom: 1.45 }, { duration: 350 });
  }, [searchQuery]);

  return (
    <div className="trace-graph-wrap">
      {loading && <div className="graph-status">{entityMode ? "Building entity relationship map…" : "Building investigation network…"}</div>}
      {error && <div className="graph-status graph-error">{error}</div>}
      <div ref={containerRef} className="graph-canvas" />

      <div className="graph-mode-toggle">
        <button className={!entityMode ? "active" : ""} onClick={() => setEntityMode(false)}>NETWORK</button>
        <button className={entityMode ? "active" : ""} onClick={() => setEntityMode(true)} disabled={!focusPersonId}>ENTITY DETAIL</button>
      </div>

      <div className="graph-context">
        <span className="context-kicker">{entityMode ? "ENTITY RELATIONSHIP MAP" : "INVESTIGATION NETWORK"}</span>
        <strong>{entityMode ? "People, records & relationships" : "Connections & relationships"}</strong>
        <small>{entityMode ? "Direct records around the selected person are shown with relationship types." : contextType && contextPerson ? `${contextType} around ${contextPerson}. Focused connections are highlighted.` : "Select a person or finding to inspect the relevant network."}</small>
      </div>

      <div className="graph-legend entity-legend">
        <b>{entityMode ? "ENTITY TYPE" : "NETWORK SIGNAL"}</b>
        {entityMode ? <>
          <span><i className="legend-dot person" /> Person</span><span><i className="legend-dot phone" /> Phone</span><span><i className="legend-dot account" /> Account</span><span><i className="legend-dot vehicle" /> Vehicle</span><span><i className="legend-dot device" /> Device</span><span><i className="legend-dot location" /> Location</span><span><i className="legend-dot event" /> Event</span><span><i className="legend-dot org" /> Organization</span><span><i className="legend-dot case" /> Case</span>
        </> : <><span><i className="legend-dot ordinary" /> Ordinary person</span><span><i className="legend-dot notable" /> Notable link</span><span><i className="legend-dot key" /> Key link</span></>}
      </div>
    </div>
  );
}
