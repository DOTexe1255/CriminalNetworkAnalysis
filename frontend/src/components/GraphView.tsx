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
};

type GraphViewProps = {
  searchQuery?: string;
  focusPersonId?: string;
  onPersonSelect?: (person: PersonDetails) => void;
  onPersonLoading?: (personId: string) => void;
  hopDistance?: 0 | 1 | 2;
  contextType?: string;
  contextPerson?: string;
};

export default function GraphView({
  searchQuery = "",
  focusPersonId,
  onPersonSelect,
  onPersonLoading,
  hopDistance = 0,
  contextType,
  contextPerson,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadGraph() {
      try {
        setLoading(true);

        const response = await fetch(`${API}/api/graph?limit=150`);
        if (!response.ok) {
          throw new Error(`Backend returned ${response.status}`);
        }

        const data = await response.json();
        if (cancelled || !containerRef.current) return;

        cyRef.current?.destroy();

        const cy = cytoscape({
          container: containerRef.current,
          elements: data.elements,

          style: [
            {
              selector: "node",
              style: {
                label: "",
                "font-family": "'IBM Plex Mono', monospace",
                "font-size": 9,
                color: "#C7CDD6",
                "text-valign": "bottom",
                "text-margin-y": 6,
                "text-background-color": "#10151C",
                "text-background-opacity": 0.9,
                "text-background-padding": 2,
                width: "mapData(degree, 0, 0.1, 16, 46)",
                height: "mapData(degree, 0, 0.1, 16, 46)",
                "border-width": 1,
                "border-color": "#0B0E11",
              },
            },

            // The graph still uses analytical scores internally,
            // but the investigator only sees human-readable meanings.
            {
              selector: "node.tier-low",
              style: { "background-color": "#5B7A9D" },
            },
            {
              selector: "node.tier-mid",
              style: { "background-color": "#8A8F98" },
            },
            {
              selector: "node.tier-high",
              style: { "background-color": "#D9A441" },
            },

            {
              selector: "edge",
              style: {
                width: 2.5,
                "line-color": "#536170",
                "curve-style": "haystack",
                opacity: 0.9,
              },
            },
            {
              selector: "edge.focused",
              style: {
                width: 3,
                "line-color": "#7E8792",
                opacity: 0.98,
              },
            },

            {
              selector: "node.labeled",
              style: { label: "data(name)" },
            },
            {
              selector: "node.hovered",
              style: {
                label: "data(name)",
                "border-width": 2,
                "border-color": "#AEB7C2",
              },
            },

            // Finding-focused state.
            {
              selector: "node.focused",
              style: {
                "border-width": 4,
                "border-color": "#F0C66B",
                label: "data(name)",
                "z-index": 10,
              },
            },
            {
              selector: "node.related",
              style: {
                "border-width": 2,
                "border-color": "#C7CDD6",
              },
            },
            {
              selector: "node.dimmed",
              style: {
                opacity: 0.12,
                label: "",
              },
            },
            {
              selector: "edge.dimmed",
              style: {
                opacity: 0.04,
              },
            },
            {
              selector: "node.loading-selection",
              style: {
                "border-width": 3,
                "border-color": "#F0C66B",
                "border-style": "dashed",
              },
            },

            {
              selector: "node:selected",
              style: {
                "border-width": 3,
                "border-color": "#D9A441",
                label: "data(name)",
                "z-index": 20,
              },
            },
          ],

          layout: {
            name: "cose",
            animate: false,
            nodeRepulsion: () => 9000,
            idealEdgeLength: () => 80,
            gravity: 40,
          },
        });

        const nodes = cy
          .nodes()
          .sort(
            (a, b) =>
              (b.data("betweenness") || 0) -
              (a.data("betweenness") || 0)
          );

        nodes.forEach((node, index) => {
          if (index < nodes.length * 0.1) {
            node.addClass("tier-high");
          } else if (index < nodes.length * 0.35) {
            node.addClass("tier-mid");
          } else {
            node.addClass("tier-low");
          }
        });

        // Keep only the most important names visible by default.
        nodes.slice(0, 15).addClass("labeled");

        cy.on("tap", "node", async (event) => {
          const node = event.target as NodeSingular;
          const personId = node.id();
          onPersonLoading?.(personId);
          node.addClass("loading-selection");

          try {
            const response = await fetch(`${API}/api/person/${personId}`);
            if (!response.ok) return;

            const person: PersonDetails = await response.json();
            onPersonSelect?.(person);
          } catch {
            // Keep the graph usable if the profile request fails.
          } finally {
            node.removeClass("loading-selection");
          }
        });

        cy.on("mouseover", "node", (event) => {
          event.target.addClass("hovered");
        });

        cy.on("mouseout", "node", (event) => {
          event.target.removeClass("hovered");
        });

        cyRef.current = cy;
        setError("");
      } catch (err) {
        console.error(err);
        setError("Could not load the investigation network.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadGraph();

    return () => {
      cancelled = true;
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [onPersonSelect]);

  // Focus the selected person and show only the requested investigation radius.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.nodes().removeClass("focused related dimmed");
    cy.edges().removeClass("focused dimmed");

    if (!focusPersonId || hopDistance === 0) return;

    const person = cy.getElementById(focusPersonId);
    if (!person.length) return;

    const visibleIds = new Set<string>([person.id()]);
    let frontier = [person.id()];

    for (let depth = 0; depth < hopDistance; depth += 1) {
      const next: string[] = [];
      frontier.forEach((id) => {
        const node = cy.getElementById(id);
        node.neighborhood("node").forEach((neighbor) => {
          const neighborId = neighbor.id();
          if (!visibleIds.has(neighborId)) {
            visibleIds.add(neighborId);
            next.push(neighborId);
          }
        });
      });
      frontier = next;
    }

    const visibleNodes = cy.nodes().filter((node) => visibleIds.has(node.id()));
    const visibleEdges = cy.edges().filter((edge) =>
      visibleIds.has(edge.source().id()) && visibleIds.has(edge.target().id())
    );

    cy.nodes().not(visibleNodes).addClass("dimmed");
    cy.edges().not(visibleEdges).addClass("dimmed");
    person.addClass("focused");
    visibleNodes.not(person).addClass("related");
    visibleEdges.addClass("focused");

    cy.animate(
      { center: { eles: person }, zoom: hopDistance === 1 ? 1.65 : 1.35 },
      { duration: 450 }
    );
  }, [focusPersonId, hopDistance]);

  // Search uses the same visual focus treatment.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.nodes().removeClass("focused related dimmed");
    cy.edges().removeClass("dimmed");

    const query = searchQuery.trim().toLowerCase();
    if (!query) return;

    const matches = cy.nodes().filter((node) =>
      String(node.data("name") || "")
        .toLowerCase()
        .includes(query)
    );

    if (!matches.length) return;

    const primary = matches.first();
    const neighborhood = primary.closedNeighborhood();

    cy.nodes().not(neighborhood.nodes()).addClass("dimmed");
    cy.edges().not(neighborhood.edges()).addClass("dimmed");

    matches.addClass("focused");
    neighborhood.nodes().not(matches).addClass("related");

    cy.animate(
      {
        center: { eles: primary },
        zoom: 1.55,
      },
      { duration: 350 }
    );
  }, [searchQuery]);

  return (
    <div className="trace-graph-wrap">
      {loading && <div className="graph-status">Loading investigation network...</div>}

      {error && (
        <div className="graph-status graph-error">
          {error}
        </div>
      )}

      <div ref={containerRef} className="graph-canvas" />

      <div className="graph-context">
        <span className="context-kicker">INVESTIGATION NETWORK</span>
        <strong>Connections &amp; relationships</strong>
        <small>
          {contextType && contextPerson
            ? `${contextType} around ${contextPerson}. Focused connections are highlighted.`
            : "Select a person or finding to inspect the relevant network."}
        </small>
      </div>

      <div className="graph-legend">
        <b>NETWORK SIGNAL</b>
        <span>
          <i className="legend-dot ordinary" /> Ordinary person
        </span>
        <span>
          <i className="legend-dot notable" /> Notable link
        </span>
        <span>
          <i className="legend-dot key" /> Key link
        </span>
        <small>Node size = number of direct connections</small>
      </div>
    </div>
  );
}
