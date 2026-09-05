/*
GraphView.tsx -- v2, restyled.

WHAT CHANGED FROM v1 (plain English):
- The side panel now looks like an actual case file instead of plain
  centered text: left-aligned, with dividing lines between each fact.
- Only the most important people (top 15 by bridge importance) show
  their name label permanently. Everyone else's name only appears when
  you hover over them. This is what fixes the "overlapping unreadable
  text" problem you saw in your screenshot.
- Added a small legend in the corner explaining what dot size and color
  mean, since a judge glancing at this for the first time needs to
  understand it in about 2 seconds.
- Added an empty-state message that actually tells you what to do,
  instead of a generic placeholder.

HOW TO USE:
Same as before -- drop both files into your components folder,
`npm install cytoscape`, use <GraphView /> in your app.
*/

import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import "./GraphView.css";

const API_BASE_URL = "http://localhost:8000";
const ALWAYS_LABELED_COUNT = 15; // how many top "bridge" people get a permanent name label

type PersonDetails = {
  id: string;
  name: string;
  national_id: string;
  degree_centrality: number;
  betweenness_centrality: number;
  community_id: number;
  phone_numbers: string[];
  bank_accounts: string[];
  organizations: string[];
};

export default function GraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<PersonDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadGraph() {
      try {
        setLoading(true);
        const response = await fetch(`${API_BASE_URL}/api/graph?limit=150`);
        if (!response.ok) throw new Error(`Backend returned ${response.status}`);
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
                // No label by default -- prevents the cluttered, overlapping
                // text you saw before. Labels get switched on selectively
                // below via the "labeled" and "hovered" classes.
                "label": "",
                "font-family": "'IBM Plex Mono', monospace",
                "font-size": 9,
                "color": "#C7CDD6",
                "text-valign": "bottom",
                "text-margin-y": 4,
                "text-background-color": "#10151C",
                "text-background-opacity": 0.85,
                "text-background-padding": "2",
                "width": "mapData(degree, 0, 0.1, 16, 46)",
                "height": "mapData(degree, 0, 0.1, 16, 46)",
                "border-width": 1,
                "border-color": "#0B0E11",
              },
            },
            {
              // Three clean, distinct tiers instead of a blended gradient --
              // blending blue straight into amber produces a muddy grey in
              // the middle, which reads as a confusing, unexplained third
              // color on screen. Discrete tiers also fit an investigation
              // tool's "flagged level" mental model better than a smooth fade.
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
                "width": 1,
                "line-color": "#2B333D",
                "curve-style": "haystack",
                "opacity": 0.6,
              },
            },
            {
              selector: "node.labeled",
              style: { "label": "data(name)" },
            },
            {
              selector: "node.hovered",
              style: { "label": "data(name)" },
            },
            {
              selector: "node:selected",
              style: {
                "border-width": 3,
                "border-color": "#D9A441",
                "label": "data(name)",
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

        // Sort everyone by bridge importance once, then use that same
        // ordering both to assign color tiers and to decide who gets a
        // permanent name label -- keeps the two visual signals consistent
        // with each other instead of using separate, disconnected math.
        const byImportance = cy
          .nodes()
          .sort((a, b) => (b.data("betweenness") || 0) - (a.data("betweenness") || 0));

        const total = byImportance.length;
        byImportance.forEach((node, index) => {
          if (index < total * 0.1) node.addClass("tier-high");
          else if (index < total * 0.35) node.addClass("tier-mid");
          else node.addClass("tier-low");
        });

        byImportance.slice(0, ALWAYS_LABELED_COUNT).addClass("labeled");

        cy.on("tap", "node", (evt) => loadPersonDetails(evt.target.id()));
        cy.on("mouseover", "node", (evt) => evt.target.addClass("hovered"));
        cy.on("mouseout", "node", (evt) => evt.target.removeClass("hovered"));

        cyRef.current = cy;
        setError(null);
      } catch (err) {
        setError(
          "Could not load the graph. Is the backend running? " +
            (err instanceof Error ? err.message : String(err))
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadGraph();
    return () => {
      cancelled = true;
      cyRef.current?.destroy();
    };
  }, []);

  async function loadPersonDetails(personId: string) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/person/${personId}`);
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
      const data: PersonDetails = await response.json();
      setSelectedPerson(data);
    } catch (err) {
      console.error("Failed to load person details:", err);
    }
  }

  return (
    <div className="investigator-shell">
      <div className="graph-pane">
        {loading && <div className="status-banner">Loading network...</div>}
        {error && <div className="status-banner status-banner--error">{error}</div>}

        <div className="legend">
          <div className="legend-title">Reading this graph</div>
          <div className="legend-row">
            <span className="legend-dot" style={{ width: 10, height: 10, background: "#5B7A9D" }} />
            Ordinary connection
          </div>
          <div className="legend-row">
            <span className="legend-dot" style={{ width: 11, height: 11, background: "#8A8F98" }} />
            Notable connector
          </div>
          <div className="legend-row">
            <span className="legend-dot" style={{ width: 14, height: 14, background: "#D9A441" }} />
            High bridge importance
          </div>
          <div className="legend-row legend-row--muted">Larger dot = more direct connections</div>
        </div>

        <div ref={containerRef} className="graph-canvas" />
      </div>

      <div className="case-file">
        <div className="case-file-header">Case File</div>

        {!selectedPerson && (
          <div className="case-file-empty">
            Select a person in the network to open their file.
          </div>
        )}

        {selectedPerson && (
          <div className="case-file-body">
            <div className="case-file-name">{selectedPerson.name}</div>
            <div className="case-file-tag">Community {selectedPerson.community_id}</div>

            <dl className="evidence-list">
              <div className="evidence-row">
                <dt>ID card</dt>
                <dd>{selectedPerson.national_id}</dd>
              </div>
              <div className="evidence-row">
                <dt>Direct connections</dt>
                <dd>{selectedPerson.degree_centrality?.toFixed(3)}</dd>
              </div>
              <div className="evidence-row">
                <dt>Bridge importance</dt>
                <dd>{selectedPerson.betweenness_centrality?.toFixed(3)}</dd>
              </div>
              <div className="evidence-row">
                <dt>Phones</dt>
                <dd>{selectedPerson.phone_numbers.join(", ") || "\u2014"}</dd>
              </div>
              <div className="evidence-row">
                <dt>Bank accounts</dt>
                <dd>{selectedPerson.bank_accounts.join(", ") || "\u2014"}</dd>
              </div>
              <div className="evidence-row">
                <dt>Organizations</dt>
                <dd>{selectedPerson.organizations.join(", ") || "\u2014"}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}