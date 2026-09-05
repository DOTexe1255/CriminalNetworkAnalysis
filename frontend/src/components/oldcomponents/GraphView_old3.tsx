import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core, type NodeSingular } from "cytoscape";
import "./GraphView.css";

const API = "http://localhost:8000";

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
  aliases?: string[];
  bio?: string;
  vehicles?: Array<{ id: string; plate_no?: string; model?: string }>;
  devices?: Array<{ id: string; imei?: string; device_type?: string }>;
};

type GraphViewProps = {
  searchQuery?: string;
  focusPersonId?: string;
  onPersonSelect?: (person: PersonDetails) => void;
  onPersonLoading?: (personId: string) => void;
  hopDistance?: 0 | 1 | 2;
  contextType?: string;
  contextPerson?: string;
  caseId?: string;
};

function normalizeElements(elements: any[]) {
  return elements.map((element) => {
    if (!element?.data) return element;

    const data = { ...element.data };

    // /api/graph calls the display field `name`, while /api/entity-graph
    // calls it `label`. Normalize both so Cytoscape always has a label.
    if (!data.label && data.name) data.label = data.name;
    if (!data.name && data.label && data.entityType === "Person") {
      data.name = data.label;
    }

    return { ...element, data };
  });
}

function addEntityClasses(cy: Core) {
  cy.nodes().forEach((node) => {
    const type = String(node.data("entityType") || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");

    if (type) node.addClass(`entity-${type}`);

    // Network endpoint has only people, so make sure those nodes still get
    // the same person styling as entity-detail nodes.
    if (!type && node.data("name")) node.addClass("entity-person");
    node.addClass("labeled");
  });

  cy.edges().forEach((edge) => {
    const kind = String(edge.data("kind") || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    if (kind) edge.addClass(`edge-${kind}`);
  });
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
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const onPersonSelectRef = useRef(onPersonSelect);
  const onPersonLoadingRef = useRef(onPersonLoading);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Keep NETWORK as the stable investigation view. ENTITY DETAIL is opt-in;
  // selecting another finding therefore does NOT rebuild the whole graph.
  const [entityMode, setEntityMode] = useState(false);

  useEffect(() => {
    onPersonSelectRef.current = onPersonSelect;
    onPersonLoadingRef.current = onPersonLoading;
  }, [onPersonSelect, onPersonLoading]);

  // Load/rebuild only when the actual graph source changes (case or mode).
  // Finding selection, focusPersonId and hopDistance are deliberately NOT
  // dependencies here; they only change visual focus below.
  useEffect(() => {
    let cancelled = false;

    async function loadGraph() {
      // Entity detail is only meaningful when a person is selected. If the
      // user toggles it before selecting one, stay on the network graph.
      if (entityMode && !focusPersonId) {
        setEntityMode(false);
        return;
      }

      try {
        setLoading(true);
        setError("");

        const url = entityMode
          ? `${API}/api/entity-graph?person_id=${encodeURIComponent(focusPersonId!)}&hop=${hopDistance || 1}${caseId ? `&case_id=${encodeURIComponent(caseId)}` : ""}`
          : `${API}/api/graph?limit=150${caseId ? `&case_id=${encodeURIComponent(caseId)}` : ""}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Backend returned ${response.status}`);

        const data = await response.json();
        if (cancelled || !containerRef.current) return;

        cyRef.current?.destroy();

        const cy = cytoscape({
          container: containerRef.current,
          elements: normalizeElements(data.elements || []),
          style: [
            {
              selector: "node",
              style: {
                // Important: use the normalized label field. The old version
                // used `data(label)` but /api/graph returns `name`.
                label: "data(label)",
                "font-family": "'IBM Plex Mono', monospace",
                "font-size": 9,
                color: "#C7CDD6",
                "text-valign": "bottom",
                "text-margin-y": 7,
                "text-background-color": "#10151C",
                "text-background-opacity": 0.92,
                "text-background-padding": "2",
                width: "data(size)",
                height: "data(size)",
                "border-width": 1,
                "border-color": "#0B0E11",
              },
            },
            { selector: "node.entity-person", style: { "background-color": "#D9A441" } },
            { selector: "node.entity-person.tier-mid", style: { "background-color": "#C7CDD6" } },
            { selector: "node.entity-phone", style: { "background-color": "#6689A9", shape: "round-rectangle" } },
            { selector: "node.entity-account", style: { "background-color": "#7F8791", shape: "rectangle" } },
            { selector: "node.entity-vehicle", style: { "background-color": "#9A8060", shape: "diamond" } },
            { selector: "node.entity-device", style: { "background-color": "#657A78", shape: "round-rectangle" } },
            { selector: "node.entity-location", style: { "background-color": "#718E78", shape: "hexagon" } },
            { selector: "node.entity-event", style: { "background-color": "#8A8F98", shape: "ellipse" } },
            { selector: "node.entity-organization", style: { "background-color": "#8C7A9B", shape: "rectangle" } },
            { selector: "node.entity-org", style: { "background-color": "#8C7A9B", shape: "rectangle" } },
            { selector: "node.entity-case", style: { "background-color": "#A37B56", shape: "round-rectangle" } },
            {
              selector: "edge",
              style: {
                width: 1.8,
                "line-color": "#536170",
                "curve-style": "bezier",
                opacity: 0.8,
                "target-arrow-shape": "none",
              },
            },
            { selector: "edge.relationship-focused", style: { width: 3, "line-color": "#D9A441", opacity: 1 } },
            { selector: "edge.edge-communication", style: { "line-style": "dashed" } },
            { selector: "edge.edge-transaction", style: { "line-style": "dashed" } },
            { selector: "edge.dimmed", style: { opacity: 0.05 } },
            { selector: "node.labeled", style: { label: "data(label)" } },
            {
              selector: "node.focused",
              style: {
                "border-width": 4,
                "border-color": "#F0C66B",
                label: "data(label)",
                "z-index": 20,
              },
            },
            { selector: "node.related", style: { "border-width": 2, "border-color": "#C7CDD6" } },
            { selector: "node.hovered", style: { label: "data(label)", "border-width": 2, "border-color": "#AEB7C2" } },
            {
              selector: "node.loading-selection",
              style: { "border-width": 3, "border-color": "#F0C66B", "border-style": "dashed" },
            },
          ],
          layout: {
            name: "cose",
            animate: false,
            nodeRepulsion: entityMode ? 10500 : 9000,
            idealEdgeLength: entityMode ? 105 : 80,
            gravity: 32,
          },
        });

        addEntityClasses(cy);

        cy.on("tap", "node", async (event) => {
          const node = event.target as NodeSingular;
          const personId = node.data("personId") || (node.data("entityType") === "Person" ? node.id() : null);
          if (!personId) return;

          onPersonLoadingRef.current?.(personId);
          node.addClass("loading-selection");
          try {
            const response = await fetch(`${API}/api/person/${encodeURIComponent(personId)}`);
            if (!response.ok) return;
            const person: PersonDetails = await response.json();
            onPersonSelectRef.current?.(person);
          } catch (err) {
            console.error("Failed to load person details:", err);
          } finally {
            node.removeClass("loading-selection");
          }
        });

        cy.on("mouseover", "node", (event) => event.target.addClass("hovered"));
        cy.on("mouseout", "node", (event) => event.target.removeClass("hovered"));
        cy.on("tap", "edge", (event) => {
          cy.edges().removeClass("relationship-focused");
          event.target.addClass("relationship-focused");
        });

        cyRef.current = cy;
        setError("");
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Could not load the investigation network.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadGraph();

    return () => {
      cancelled = true;
      // Do not destroy here when only finding focus changes; this effect does
      // not depend on focusPersonId. It only runs for a real graph-source change.
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [caseId, entityMode]);

  // Finding selection only changes focus. This is intentionally separate from
  // graph loading so clicking cards does not flash/rebuild the graph.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.nodes().removeClass("focused related dimmed");
    cy.edges().removeClass("dimmed");

    if (!focusPersonId) return;

    const person = cy.getElementById(focusPersonId);
    if (!person.length) return;

    const visibleIds = new Set<string>([person.id()]);
    let frontier = [person.id()];

    // Network mode: 1/2-hop focus is visual only, so no backend request.
    for (let depth = 0; depth < (hopDistance || 1); depth += 1) {
      const next: string[] = [];
      frontier.forEach((id) => {
        cy.getElementById(id).neighborhood("node").forEach((neighbor) => {
          const id = neighbor.id();
          if (!visibleIds.has(id)) {
            visibleIds.add(id);
            next.push(id);
          }
        });
      });
      frontier = next;
    }

    const visibleNodes = cy.nodes().filter((node) => visibleIds.has(node.id()));
    const visibleEdges = cy.edges().filter(
      (edge) => visibleIds.has(edge.source().id()) && visibleIds.has(edge.target().id())
    );

    cy.nodes().not(visibleNodes).addClass("dimmed");
    cy.edges().not(visibleEdges).addClass("dimmed");
    person.addClass("focused");
    visibleNodes.not(person).addClass("related");
    visibleEdges.addClass("focused");

    cy.animate(
      { center: { eles: person }, zoom: entityMode ? 1.35 : hopDistance === 1 ? 1.65 : 1.35 },
      { duration: 450 }
    );
  }, [focusPersonId, hopDistance, entityMode]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const query = searchQuery.trim().toLowerCase();
    if (!query) return;

    cy.nodes().removeClass("focused related dimmed");
    cy.edges().removeClass("dimmed");

    const matches = cy.nodes().filter((node) =>
      String(node.data("label") || node.data("name") || "").toLowerCase().includes(query)
    );
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
      {loading && <div className="graph-status">Building investigation network...</div>}
      {error && <div className="graph-status graph-error">{error}</div>}

      <div ref={containerRef} className="graph-canvas" />

      <div className="graph-mode-toggle">
        <button className={!entityMode ? "active" : ""} onClick={() => setEntityMode(false)}>
          NETWORK
        </button>
        <button className={entityMode ? "active" : ""} onClick={() => setEntityMode(true)} disabled={!focusPersonId}>
          ENTITY DETAIL
        </button>
      </div>

      <div className="graph-context">
        <span className="context-kicker">
          {entityMode && focusPersonId ? "ENTITY RELATIONSHIP MAP" : "INVESTIGATION NETWORK"}
        </span>
        <strong>
          {entityMode && focusPersonId ? "People, records & relationships" : "Connections & relationships"}
        </strong>
        <small>
          {entityMode && focusPersonId
            ? "Direct records around the selected person are shown with relationship types."
            : contextType && contextPerson
              ? `${contextType} around ${contextPerson}. Focused connections are highlighted.`
              : "Select a person or finding to inspect the relevant network."}
        </small>
      </div>

      <div className="graph-legend entity-legend">
        <b>ENTITY TYPE</b>
        <span><i className="legend-dot person" /> Person</span>
        <span><i className="legend-dot phone" /> Phone</span>
        <span><i className="legend-dot account" /> Account</span>
        <span><i className="legend-dot vehicle" /> Vehicle</span>
        <span><i className="legend-dot location" /> Location</span>
        <span><i className="legend-dot event" /> Event</span>
        <span><i className="legend-dot org" /> Organization</span>
      </div>
    </div>
  );
}
