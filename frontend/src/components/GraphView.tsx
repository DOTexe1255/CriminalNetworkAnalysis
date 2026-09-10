import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core, type NodeSingular } from "cytoscape";
import "./GraphView.css";
import { API_BASE_URL } from "../config";

const API = API_BASE_URL;

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

type Props = {
  searchQuery?: string;
  focusPersonId?: string;
  onPersonSelect?: (person: PersonDetails) => void;
  onPersonLoading?: (personId: string) => void;
  hopDistance?: 0 | 1 | 2;
  contextType?: string;
  contextPerson?: string;
  caseId?: string;
  onEdgeSelect?: (edge: EdgeDetails) => void;
};

export type EdgeDetails = {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind?: string;
  relationship?: string;
};

/*
 * Crisp inline SVG icons rendered by Cytoscape as background images.
 * Theme variants allow dark icons on gold/selected nodes and light icons on colored nodes.
 */
const ICONS: Record<string, { light: string; dark: string }> = {
  person: {
    light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#F8FAFC" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    dark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  },
  phone: {
    light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
    dark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  },
  account: {
    light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
    dark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
  },
  vehicle: {
    light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><path d="M5 17h14M5 17a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2M7 17v2M17 17v2"/></svg>`,
    dark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2"><path d="M5 17h14M5 17a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2M7 17v2M17 17v2"/></svg>`,
  },
  device: {
    light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
    dark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
  },
  location: {
    light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    dark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  },
  event: {
    light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    dark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  },
  organization: {
    light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><path d="M3 21h18M6 18V7l6-3 6 3v11"/></svg>`,
    dark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2"><path d="M3 21h18M6 18V7l6-3 6 3v11"/></svg>`,
  },
  case: {
    light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    dark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  },
};

function iconData(type: string, theme: "light" | "dark" = "light") {
  const key = type.toLowerCase().replace(/[^a-z]/g, "");
  const iconObj = ICONS[key] || ICONS.person;
  const svg = theme === "dark" ? iconObj.dark : iconObj.light;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function normalize(elements: any[]) {
  return elements.map((el) => {
    if (!el?.data) return el;
    const data = { ...el.data };
    if (!data.label) {
      data.label = data.name || data.full_name || data.person_name || data.fullName || "";
    }
    if (!data.name && data.label && data.entityType === "Person") data.name = data.label;
    if (data.community_id == null && data.community != null) data.community_id = data.community;
    if (data.communityName != null && data.community_name == null) data.community_name = data.communityName;
    return { ...el, data };
  });
}

const CLUSTER_PALETTE = [
  { stroke: "#3B82F6", fill: "#1D4ED8", nodeColor: "#2563EB", name: "North Cluster", sub: "Financial Network" },
  { stroke: "#EF4444", fill: "#B91C1C", nodeColor: "#DC2626", name: "Northeast Cluster", sub: "Core Group" },
  { stroke: "#A855F7", fill: "#6B21A8", nodeColor: "#9333EA", name: "East Cluster", sub: "Cross-Case Links" },
  { stroke: "#06B6D4", fill: "#0E7490", nodeColor: "#0891B2", name: "Southeast Cluster", sub: "Extended Network" },
  { stroke: "#2563EB", fill: "#1E40AF", nodeColor: "#1D4ED8", name: "South Cluster", sub: "Regional Contacts" },
  { stroke: "#F97316", fill: "#C2410C", nodeColor: "#EA580C", name: "Southwest Cluster", sub: "Auxiliary Network" },
  { stroke: "#10B981", fill: "#047857", nodeColor: "#059669", name: "West Cluster", sub: "Logistics / Operations" },
];

/* Anchor coordinates for community centers spread in an organic ring across viewport */
const COMMUNITY_ANCHORS = [
  { x: -60,  y: -290 }, // 0: North
  { x: 380,  y: -260 }, // 1: Northeast
  { x: 460,  y: 40   }, // 2: East
  { x: 320,  y: 320  }, // 3: Southeast
  { x: -60,  y: 350  }, // 4: South
  { x: -420, y: 220  }, // 5: Southwest
  { x: -450, y: -120 }, // 6: West
];

/*
 * Seeds organic community clusters. Nodes within each group are distributed via golden-angle spiral
 * around dedicated cluster anchor points, preventing rigid grids or single-column collapse.
 */
function seedCommunityPositions(elements: any[]) {
  const nodes = elements.filter((el) => el?.data && !el.data.source && !el.data.target);
  const groups = new Map<string, any[]>();

  nodes.forEach((el) => {
    const key = String(
      el.data.community_id ?? el.data.communityId ?? el.data.community ?? "0"
    );
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(el);
  });

  const sortedGroupKeys = [...groups.keys()].sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  sortedGroupKeys.forEach((key, commIdx) => {
    const members = groups.get(key)!;
    const paletteIdx = commIdx % CLUSTER_PALETTE.length;
    const palette = CLUSTER_PALETTE[paletteIdx];

    const center = COMMUNITY_ANCHORS[commIdx % COMMUNITY_ANCHORS.length] || {
      x: Math.cos((commIdx / sortedGroupKeys.length) * Math.PI * 2 - Math.PI / 2) * 450,
      y: Math.sin((commIdx / sortedGroupKeys.length) * Math.PI * 2 - Math.PI / 2) * 350,
    };

    const spreadRadius = Math.max(90, Math.min(180, 75 + Math.sqrt(members.length) * 16));

    members.forEach((el, idx) => {
      el.data.communityColor = palette.nodeColor;
      el.data.paletteIndex = paletteIdx;
      if (!el.data.community_name) {
        el.data.community_name = palette.name;
        el.data.community_sub = palette.sub;
      }

      // Golden angle spiral distribution ensures organic density with ample spacing
      const phi = idx * 2.3999632297;
      const ratio = Math.sqrt((idx + 0.4) / Math.max(members.length, 1));
      const r = spreadRadius * ratio;

      el.position = {
        x: center.x + Math.cos(phi) * r,
        y: center.y + Math.sin(phi) * r,
      };
    });
  });

  return elements;
}

function convexHull(points: Array<{ x: number; y: number }>) {
  if (points.length <= 2) return points;
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Array<{ x: number; y: number }> = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<{ x: number; y: number }> = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/* Quadratic bezier curve midpoint interpolation generates smooth, rounded cluster hulls */
function smoothClosedPath(pts: Array<{ x: number; y: number }>) {
  if (pts.length < 3) return "";
  const n = pts.length;
  let path = `M ${(pts[0].x + pts[n - 1].x) / 2} ${(pts[0].y + pts[n - 1].y) / 2}`;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    path += ` Q ${p1.x} ${p1.y} ${midX} ${midY}`;
  }
  return `${path} Z`;
}

function updateClusterOverlay(cy: Core, svg: SVGSVGElement | null) {
  if (!svg || !cy || cy.destroyed()) return;
  const width = cy.width();
  const height = cy.height();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const groups = new Map<string, NodeSingular[]>();
  cy.nodes().forEach((node) => {
    const id = String(node.data("community_id") ?? node.data("communityId") ?? node.data("community") ?? "0");
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(node);
  });

  const sorted = [...groups.entries()].sort((a, b) => {
    const na = parseInt(a[0], 10);
    const nb = parseInt(b[0], 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a[0].localeCompare(b[0]);
  });

  const parts: string[] = [];

  sorted.forEach(([, members], index) => {
    if (members.length < 3) return;
    const palette = CLUSTER_PALETTE[index % CLUSTER_PALETTE.length];
    const pts = members.map((n) => n.renderedPosition());
    const hull = convexHull(pts);
    if (hull.length < 3) return;

    const cx = hull.reduce((sum, p) => sum + p.x, 0) / hull.length;
    const cyy = hull.reduce((sum, p) => sum + p.y, 0) / hull.length;
    const pad = 34;

    const expanded = hull.map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cyy;
      const dist = Math.hypot(dx, dy) || 1;
      return {
        x: p.x + (dx / dist) * pad,
        y: p.y + (dy / dist) * pad,
      };
    });

    const path = smoothClosedPath(expanded);
    const minY = Math.min(...expanded.map((p) => p.y));
    const minX = Math.min(...expanded.map((p) => p.x));

    const name = String(members[0].data("community_name") || palette.name);
    const sub = String(members[0].data("community_sub") || palette.sub);

    parts.push(
      `<path d="${path}" fill="${palette.fill}" fill-opacity="0.08" stroke="${palette.stroke}" stroke-opacity="0.65" stroke-width="1.5"/>`
    );
    parts.push(
      `<text x="${Math.max(14, minX)}" y="${Math.max(22, minY - 14)}" fill="${palette.stroke}" font-family="IBM Plex Sans, sans-serif" font-size="12" font-weight="600">${name}</text>`
    );
    parts.push(
      `<text x="${Math.max(14, minX)}" y="${Math.max(34, minY - 2)}" fill="${palette.stroke}" fill-opacity="0.75" font-family="IBM Plex Sans, sans-serif" font-size="9" font-weight="400">${sub}</text>`
    );
  });

  svg.innerHTML = parts.join("");
}

function updateMinimap(cy: Core, svg: SVGSVGElement | null) {
  if (!svg || !cy || cy.destroyed()) return;
  const width = 245, height = 110, pad = 10;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const bb = cy.nodes().boundingBox();
  const scale = Math.min((width - pad * 2) / Math.max(bb.w, 1), (height - pad * 2) / Math.max(bb.h, 1));
  
  const px = (x: number) => pad + (x - bb.x1) * scale;
  const py = (y: number) => pad + (y - bb.y1) * scale;
  const parts: string[] = [];

  cy.edges().forEach((e) => {
    parts.push(
      `<line x1="${px(e.source().position().x).toFixed(1)}" y1="${py(e.source().position().y).toFixed(1)}" x2="${px(e.target().position().x).toFixed(1)}" y2="${py(e.target().position().y).toFixed(1)}" stroke="#697483" stroke-opacity="0.35" stroke-width="0.6"/>`
    );
  });

  cy.nodes().forEach((n) => {
    const color = n.data("communityColor") || "#3B82F6";
    const r = n.hasClass("key-person") ? 3.0 : n.hasClass("tier-high") ? 2.2 : 1.4;
    parts.push(
      `<circle cx="${px(n.position().x).toFixed(1)}" cy="${py(n.position().y).toFixed(1)}" r="${r}" fill="${color}" fill-opacity="0.9"/>`
    );
  });

  svg.innerHTML = parts.join("");
}

function addClasses(cy: Core, entityMode: boolean) {
  cy.nodes().forEach((node) => {
    const rawType = String(node.data("entityType") || "Person");
    const type = rawType.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const isDarkIcon = node.hasClass("key-person") || node.hasClass("focused");

    node.data("icon", iconData(type, isDarkIcon ? "dark" : "light"));
    node.addClass(`entity-${type}`);
    node.addClass(entityMode ? "entity-icon-node" : "network-node");
  });

  cy.edges().forEach((edge) => {
    const kind = String(edge.data("kind") || edge.data("relationship") || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    if (kind) edge.addClass(`edge-${kind}`);

    const sourceCommunity = edge.source().data("community_id");
    const targetCommunity = edge.target().data("community_id");
    if (
      sourceCommunity !== undefined &&
      targetCommunity !== undefined &&
      String(sourceCommunity) !== String(targetCommunity)
    ) {
      edge.addClass("cross-community");
      edge.source().addClass("cross-case-person");
      edge.target().addClass("cross-case-person");
    }
  });
}

/*
 * Dynamic zoom-aware node sizing formula:
 * Screen-rendered pixel dimension decreases when zooming IN so nodes remain readable circles,
 * and scales up when zooming OUT so nodes remain visible.
 */
function rescaleNetworkNodes(cy: Core) {
  if (!cy || cy.destroyed() || cy.nodes().length === 0) return;

  const zoom = Math.max(0.25, Math.min(6.0, cy.zoom()));
  const targetRenderedSize = Math.max(13, Math.min(32, 24 / Math.pow(zoom, 0.35)));
  const baseModelSize = targetRenderedSize / zoom;

  cy.nodes().forEach((node) => {
    const isKey = node.hasClass("key-person") || node.hasClass("focused");
    const isHigh = node.hasClass("tier-high");
    const multiplier = isKey ? 1.35 : isHigh ? 1.15 : 1.0;

    const finalModelSize = Math.max(6, Math.min(90, baseModelSize * multiplier));
    node.style({
      width: finalModelSize,
      height: finalModelSize,
    });
  });
}

function resetNetworkFocus(cy: Core) {
  if (!cy || cy.destroyed()) return;

  cy.stop();
  cy.nodes().removeClass("focused related dimmed loading-selection hovered");
  cy.edges().removeClass("focused dimmed");

  cy.nodes().forEach((node) => {
    node.removeStyle("label");
    const type = String(node.data("entityType") || "Person").toLowerCase();
    const isDarkIcon = node.hasClass("key-person");
    node.data("icon", iconData(type, isDarkIcon ? "dark" : "light"));
  });

  rescaleNetworkNodes(cy);

  cy.animate(
    { fit: { eles: cy.nodes(), padding: 60 } },
    { duration: 350 }
  );
}

function focusNeighborhood(cy: Core, personId: string, hops: number, entityMode: boolean) {
  if (!cy || cy.destroyed()) return;

  cy.stop();
  cy.nodes().removeClass("focused related dimmed");
  cy.edges().removeClass("focused dimmed");

  if (!personId || hops === 0) {
    resetNetworkFocus(cy);
    return;
  }

  const root = cy.getElementById(personId);
  if (!root.length) return;

  const visible = new Set<string>([root.id()]);
  let frontier = [root.id()];

  for (let depth = 0; depth < hops; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      const node = cy.getElementById(id);
      node.connectedEdges().forEach((edge) => {
        const other = edge.source().id() === id ? edge.target() : edge.source();
        if (!visible.has(other.id())) {
          visible.add(other.id());
          next.push(other.id());
        }
      });
    }
    frontier = next;
  }

  const visibleNodes = cy.nodes().filter((n) => visible.has(n.id()));
  const visibleEdges = cy.edges().filter(
    (e) => visible.has(e.source().id()) && visible.has(e.target().id())
  );

  cy.nodes().not(visibleNodes).addClass("dimmed");
  cy.edges().not(visibleEdges).addClass("dimmed");
  root.addClass("focused");
  visibleNodes.not(root).forEach((node) => {
    const label = String(
      node.data("label") ||
      node.data("name") ||
      node.data("full_name") ||
      node.data("person_name") ||
      ""
    );
    if (label) node.data("label", label);
    node.addClass("related");
    if (label) node.style("label", label);
  });
  visibleEdges.addClass("focused");

  const rootLabel = String(
    root.data("label") ||
    root.data("name") ||
    root.data("full_name") ||
    root.data("person_name") ||
    ""
  );
  if (rootLabel) {
    root.data("label", rootLabel);
    root.style("label", rootLabel);
  }

  root.data("icon", iconData("person", "dark"));

  rescaleNetworkNodes(cy);

  cy.animate(
    { center: { eles: root }, zoom: entityMode ? 1.3 : hops === 1 ? 1.35 : 1.1 },
    { duration: 400 }
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
  onEdgeSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphWrapRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const clusterOverlayRef = useRef<SVGSVGElement>(null);
  const minimapRef = useRef<SVGSVGElement>(null);
  const focusRef = useRef<string | undefined>(focusPersonId);
  const hopRef = useRef(hopDistance);
  const onPersonSelectRef = useRef(onPersonSelect);
  const onPersonLoadingRef = useRef(onPersonLoading);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [entityMode, setEntityMode] = useState(false);
  const [networkStats, setNetworkStats] = useState({ people: 0, communities: 0, crossLinks: 0 });
  const [keyPeople, setKeyPeople] = useState<string[]>([]);
  const [collapsedPanels, setCollapsedPanels] = useState({
    context: false,
    minimap: false,
    legend: false,
  });
  const [isFullscreen, setIsFullscreen] = useState(false);

  const togglePanel = (panel: "context" | "minimap" | "legend") => {
    setCollapsedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  };

  

  const toggleFullscreen = async () => {
    const element = graphWrapRef.current;
    if (!element) return;

    // Fullscreen the whole analysis stage so the external
    // 1 HOP / 2 HOPS / RESET controls stay visible too.
    const fullscreenTarget =
      element.closest(".analysis-stage") as HTMLElement | null;

    try {
      if (document.fullscreenElement === fullscreenTarget) {
        await document.exitFullscreen();
      } else {
        await (fullscreenTarget || element).requestFullscreen();
      }
    } catch (err) {
      console.error("Failed to toggle graph fullscreen:", err);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenTarget =
        graphWrapRef.current?.closest(".analysis-stage") as HTMLElement | null;
      const active =
        document.fullscreenElement === fullscreenTarget ||
        document.fullscreenElement === graphWrapRef.current;

      setIsFullscreen(active);

      requestAnimationFrame(() => {
        const cy = cyRef.current;
        if (!cy || cy.destroyed()) return;

        cy.resize();

        if (active) {
          cy.fit(cy.nodes(), 70);
        }

        updateClusterOverlay(cy, clusterOverlayRef.current);
        updateMinimap(cy, minimapRef.current);
      });
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => { onPersonSelectRef.current = onPersonSelect; }, [onPersonSelect]);
  useEffect(() => { onPersonLoadingRef.current = onPersonLoading; }, [onPersonLoading]);
  useEffect(() => { focusRef.current = focusPersonId; }, [focusPersonId]);
  useEffect(() => { hopRef.current = hopDistance; }, [hopDistance]);

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

        const elements = seedCommunityPositions(normalize(data.elements || []));
        const cy = cytoscape({
          container: containerRef.current,
          elements,
          style: [
            {
              selector: "node",
              style: {
                label: "",
                "font-family": "'IBM Plex Mono', monospace",
                "font-size": 9,
                color: "#E2E8F0",
                "text-valign": "bottom",
                "text-margin-y": 8,
                "text-background-color": "#0B1118",
                "text-background-opacity": 0.92,
                "text-background-padding": "3",
                width: 22,
                height: 22,
                "border-width": 2,
                "border-color": "rgba(255, 255, 255, 0.25)",
                "background-color": "data(communityColor)",
                "background-image": "data(icon)",
                "background-fit": "contain",
                "background-clip": "node",
                "background-position-x": "50%",
                "background-position-y": "50%",
                "background-width": "68%",
                "background-height": "68%",
                "background-opacity": 1,
              },
            },
            { selector: "node.cross-case-person", style: { "background-color": "#8D5BE8" } },
            { selector: "node.tier-high", style: { "border-width": 2.5, "border-color": "#F472B6" } },
            {
              selector: "node.key-person",
              style: {
                "background-color": "#D9A441",
                "border-width": 3,
                "border-color": "#F4CB72",
              },
            },
            {
              selector: "edge",
              style: {
                width: 1.1,
                "line-color": "#475569",
                "curve-style": "bezier",
                opacity: 0.35,
              },
            },
            {
              selector: "edge.cross-community",
              style: {
                width: 1.5,
                "line-color": "#9E855A",
                "line-style": "dashed",
                opacity: 0.55,
              },
            },
            { selector: "edge.focused", style: { width: 3.0, "line-color": "#F0C66B", opacity: 1 } },
            {
              selector: "node.labeled",
              style: { label: "data(label)", "font-weight": 500 },
            },
            {
              selector: "node.hovered",
              style: { label: "data(label)", "border-width": 3, "border-color": "#F8FAFC", "z-index": 25 },
            },
            {
              selector: "node.focused",
              style: {
                "background-color": "#D9A441",
                "border-width": 4,
                "border-color": "#FFE09A",
                label: "data(label)",
                "z-index": 30,
              },
            },
            {
              selector: "node.related",
              style: {
                "border-width": 2.5,
                "border-color": "#CBD5E1",
                opacity: 1,
                label: "data(label)",
                "font-weight": 500,
              },
            },
            { selector: "node.dimmed", style: { opacity: 0.1, label: "" } },
            { selector: "edge.dimmed", style: { opacity: 0.03 } },
            {
              selector: "node.loading-selection",
              style: { "border-width": 3, "border-color": "#F0C66B", "border-style": "dashed" },
            },
          ],
          layout: {
            name: "preset",
            fit: true,
            padding: 60,
          },
        });

        const nodes = cy.nodes().sort(
          (a, b) => (b.data("betweenness") || 0) - (a.data("betweenness") || 0)
        );

        nodes.forEach((node, i) => {
          node.addClass(
            i < nodes.length * 0.1
              ? "tier-high"
              : i < nodes.length * 0.35
                ? "tier-mid"
                : "tier-low"
          );
        });

        nodes.slice(0, 3).addClass("key-person");

        // Keep the graph understandable without requiring a click: label the
        // strongest connector from each detected community, then add a few
        // globally important people. This keeps labels meaningful without
        // turning the whole network into a wall of text.
        const labeledIds = new Set<string>();
        const strongestByCommunity = new Map<string, NodeSingular>();

        nodes.forEach((node) => {
          const community = String(
            node.data("community_id") ?? node.data("communityId") ?? node.data("community") ?? "0"
          );
          if (!strongestByCommunity.has(community)) {
            strongestByCommunity.set(community, node);
          }
        });

        strongestByCommunity.forEach((node) => {
          labeledIds.add(node.id());
        });
        nodes.slice(0, 5).forEach((node) => {
          labeledIds.add(node.id());
        });
        cy.nodes().forEach((node) => {
          if (labeledIds.has(node.id())) node.addClass("labeled");
        });

        addClasses(cy, false);
        rescaleNetworkNodes(cy);

        const communityIds = new Set<string>();
        let crossLinks = 0;
        cy.nodes().forEach((node) => {
          const id = node.data("community_id");
          if (id !== undefined && id !== null) communityIds.add(String(id));
        });
        cy.edges().forEach((edge) => {
          if (edge.hasClass("cross-community")) crossLinks += 1;
        });

        setNetworkStats({ people: cy.nodes().length, communities: communityIds.size, crossLinks });
        setKeyPeople(nodes.slice(0, 3).map((node) => String(node.data("name") || node.data("label") || "Unknown")));
        
        requestAnimationFrame(() => {
          updateClusterOverlay(cy, clusterOverlayRef.current);
          updateMinimap(cy, minimapRef.current);
        });

        const refreshOverlays = () => {
          updateClusterOverlay(cy, clusterOverlayRef.current);
          updateMinimap(cy, minimapRef.current);
        };

        cy.on("render pan resize", refreshOverlays);
        cy.on("zoom", () => {
          rescaleNetworkNodes(cy);
          refreshOverlays();
        });

        cy.on("tap", "node", async (event) => {
          const node = event.target as NodeSingular;
          const personId = node.data("personId") || node.id();
          onPersonLoadingRef.current?.(personId);
          node.addClass("loading-selection");
          try {
            const response = await fetch(`${API}/api/person/${encodeURIComponent(personId)}`);
            if (!response.ok) return;
            onPersonSelectRef.current?.(await response.json());
          } catch (err) {
            console.error("Failed to load person details:", err);
          } finally {
            node.removeClass("loading-selection");
          }
        });

        cy.on("mouseover", "node", (e) => e.target.addClass("hovered"));
        cy.on("mouseout", "node", (e) => e.target.removeClass("hovered"));
        cy.on("tap", "edge", (e) => {
          cy.edges().removeClass("focused");
          e.target.addClass("focused");
          onEdgeSelect?.(e.target.data() as EdgeDetails);
        });

        cyRef.current = cy;
        setError("");

        if (focusRef.current && hopRef.current > 0) {
          focusNeighborhood(cy, focusRef.current, hopRef.current, false);
        } else {
          resetNetworkFocus(cy);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Could not load the investigation network.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadNetwork();
    return () => {
      cancelled = true;
      clusterOverlayRef.current && (clusterOverlayRef.current.innerHTML = "");
      minimapRef.current && (minimapRef.current.innerHTML = "");
    };
  }, [caseId, entityMode]);

  useEffect(() => {
    if (!entityMode || !focusPersonId) return;
    if (clusterOverlayRef.current) clusterOverlayRef.current.innerHTML = "";
    if (minimapRef.current) minimapRef.current.innerHTML = "";
    const selectedPersonId = focusPersonId;
    const selectedCaseId = caseId;
    let cancelled = false;

    async function loadEntityGraph() {
      try {
        setLoading(true);
        setError("");
        const url = `${API}/api/entity-graph?person_id=${encodeURIComponent(selectedPersonId)}&hop=${hopDistance || 1}${selectedCaseId ? `&case_id=${encodeURIComponent(selectedCaseId)}` : ""}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Entity graph returned ${response.status}`);
        const data = await response.json();
        if (cancelled || !containerRef.current) return;
        cyRef.current?.destroy();

        const cy = cytoscape({
          container: containerRef.current,
          elements: normalize(data.elements || []),
          style: [
            {
              selector: "node",
              style: {
                label: "data(label)",
                "font-family": "'IBM Plex Mono', monospace",
                "font-size": 9,
                color: "#D6DCE3",
                "text-valign": "bottom",
                "text-margin-y": 8,
                "text-background-color": "#0E1319",
                "text-background-opacity": 0.95,
                "text-background-padding": "2",
                width: "data(size)",
                height: "data(size)",
                "border-width": 1,
                "border-color": "#0B0E11",
                "background-image": "data(icon)",
                "background-fit": "contain",
                "background-clip": "node",
                "background-position-x": "50%",
                "background-position-y": "50%",
                "background-width": "68%",
                "background-height": "68%",
                "background-opacity": 1,
              },
            },
            { selector: "node.entity-person", style: { "background-color": "#D9A441", shape: "ellipse" } },
            { selector: "node.entity-phone", style: { "background-color": "#6689A9", shape: "round-rectangle" } },
            { selector: "node.entity-account", style: { "background-color": "#7F8791", shape: "rectangle" } },
            { selector: "node.entity-vehicle", style: { "background-color": "#9A8060", shape: "diamond" } },
            { selector: "node.entity-device", style: { "background-color": "#657A78", shape: "round-rectangle" } },
            { selector: "node.entity-location", style: { "background-color": "#718E78", shape: "hexagon" } },
            { selector: "node.entity-event", style: { "background-color": "#8A8F98", shape: "ellipse" } },
            { selector: "node.entity-organization", style: { "background-color": "#8C7A9B", shape: "rectangle" } },
            { selector: "node.entity-case", style: { "background-color": "#A37B56", shape: "round-rectangle" } },
            {
              selector: "edge",
              style: {
                width: 1.8,
                "line-color": "#536170",
                "curve-style": "bezier",
                opacity: 0.8,
                "target-arrow-shape": "triangle",
                "target-arrow-color": "#536170",
                label: "data(label)",
                "font-size": 7,
                color: "#7F8995",
                "text-background-color": "#0E1319",
                "text-background-opacity": 0.8,
                "text-background-padding": "2",
              },
            },
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
          } catch (err) {
            console.error("Failed to load person details:", err);
          } finally {
            node.removeClass("loading-selection");
          }
        });
        cy.on("mouseover", "node", (e) => e.target.addClass("hovered"));
        cy.on("mouseout", "node", (e) => e.target.removeClass("hovered"));
        cy.on("tap", "edge", (e) => {
          cy.edges().removeClass("focused");
          e.target.addClass("focused");
          onEdgeSelect?.(e.target.data() as EdgeDetails);
        });

        cyRef.current = cy;
        setError("");
        focusNeighborhood(cy, selectedPersonId, hopDistance || 1, true);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Entity detail graph is unavailable. Add the /api/entity-graph endpoint to the backend.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadEntityGraph();
    return () => {
      cancelled = true;
    };
  }, [entityMode, focusPersonId, hopDistance, caseId]);

  useEffect(() => {
    if (entityMode) return;
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;

    if (hopDistance === 0 || !focusPersonId) {
      resetNetworkFocus(cy);
      return;
    }

    focusNeighborhood(cy, focusPersonId, hopDistance, false);
  }, [focusPersonId, hopDistance, entityMode]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || entityMode || collapsedPanels.minimap) return;
    const frame = requestAnimationFrame(() => updateMinimap(cy, minimapRef.current));
    return () => cancelAnimationFrame(frame);
  }, [collapsedPanels.minimap, entityMode]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      if (hopDistance === 0 && !focusPersonId) resetNetworkFocus(cy);
      return;
    }

    cy.nodes().removeClass("focused related dimmed");
    cy.edges().removeClass("dimmed");
    const matches = cy.nodes().filter((n) =>
      String(n.data("label") || n.data("name") || "").toLowerCase().includes(q)
    );
    if (!matches.length) return;

    const primary = matches.first();
    const neighborhood = primary.closedNeighborhood();
    cy.nodes().not(neighborhood.nodes()).addClass("dimmed");
    cy.edges().not(neighborhood.edges()).addClass("dimmed");
    matches.addClass("focused");
    neighborhood.nodes().not(matches).addClass("related");
    cy.animate({ center: { eles: primary }, zoom: 1.35 }, { duration: 350 });
  }, [searchQuery]);

  return (
    <div
      ref={graphWrapRef}
      className={`trace-graph-wrap ${isFullscreen ? "is-fullscreen" : ""}`}
      style={
        isFullscreen
          ? {
              width: "100%",
              height: "100%",
              position: "relative",
              background: "#10151c",
            }
          : undefined
      }
    >
      <button
        type="button"
        className="graph-fullscreen-btn"
        onClick={toggleFullscreen}
        title={isFullscreen ? "Exit fullscreen" : "Open graph fullscreen"}
        aria-label={isFullscreen ? "Exit graph fullscreen" : "Open graph fullscreen"}
        style={{
          position: "absolute",
          bottom: 16,
          right: 220,
          zIndex: 80,
          padding: "8px 11px",
          border: "1px solid #303a45",
          background: "#161c24",
          color: "#9aa4af",
          font: "10px 'IBM Plex Mono', monospace",
          letterSpacing: ".04em",
          cursor: "pointer",
        }}
      >
        {isFullscreen ? "↙ EXIT" : "⛶ FULL SCREEN"}
      </button>

      {loading && (
        <div className="graph-status">
          {entityMode ? "Building entity relationship map…" : "Building investigation network…"}
        </div>
      )}
      {error && <div className="graph-status graph-error">{error}</div>}
      <div ref={containerRef} className="graph-canvas" />
      <svg ref={clusterOverlayRef} className="graph-cluster-overlay" aria-hidden="true" />

      {!entityMode && (
        <div className={`graph-minimap ${collapsedPanels.minimap ? "is-collapsed" : ""}`}>
          <div className="graph-panel-header">
            <div className="graph-minimap-title">NETWORK OVERVIEW</div>
            <button
              type="button"
              className="graph-panel-toggle"
              onClick={() => togglePanel("minimap")}
              aria-label={collapsedPanels.minimap ? "Expand network overview" : "Minimize network overview"}
              title={collapsedPanels.minimap ? "Expand" : "Minimize"}
            >
              {collapsedPanels.minimap ? "+" : "−"}
            </button>
          </div>
          {!collapsedPanels.minimap && <svg ref={minimapRef} />}
        </div>
      )}

      <div className="graph-mode-toggle">
        <button className={!entityMode ? "active" : ""} onClick={() => setEntityMode(false)}>NETWORK</button>
        <button className={entityMode ? "active" : ""} onClick={() => setEntityMode(true)} disabled={!focusPersonId}>ENTITY DETAIL</button>
      </div>

      <div className={`graph-context ${collapsedPanels.context ? "is-collapsed" : ""}`}>
        <div className="graph-panel-header">
          <div>
            <span className="context-kicker">{entityMode ? "ENTITY RELATIONSHIP MAP" : "INVESTIGATION NETWORK"}</span>
            <strong>{entityMode ? "People, records & relationships" : "Connections & relationships"}</strong>
          </div>
          <button
            type="button"
            className="graph-panel-toggle"
            onClick={() => togglePanel("context")}
            aria-label={collapsedPanels.context ? "Expand investigation network" : "Minimize investigation network"}
            title={collapsedPanels.context ? "Expand" : "Minimize"}
          >
            {collapsedPanels.context ? "+" : "−"}
          </button>
        </div>

        {!collapsedPanels.context && (entityMode ? (
          <small>Direct records around the selected person are shown with relationship types.</small>
        ) : (
          <>
            <div className="network-stat-grid">
              <div><b>{networkStats.people || "—"}</b><span>PEOPLE</span></div>
              <div><b>{networkStats.communities || "—"}</b><span>COMMUNITIES</span></div>
              <div><b>{networkStats.crossLinks || "—"}</b><span>CROSS-CASE LINKS</span></div>
            </div>
            <div className="network-key-people">
              <span>KEY CONNECTORS</span>
              {keyPeople.map((name) => <b key={name}>{name}</b>)}
            </div>
            <small>
              {contextType && contextPerson
                ? `${contextType} around ${contextPerson}. Focused connections are highlighted.`
                : "This view shows people and their connections across cases. Key individuals and cross-case links are highlighted to help identify patterns."}
            </small>
          </>
        ))}
      </div>

      <div className={`graph-legend entity-legend ${collapsedPanels.legend ? "is-collapsed" : ""}`}>
        <div className="graph-panel-header">
          <b>{entityMode ? "ENTITY TYPE" : "NODE TYPES"}</b>
          <button
            type="button"
            className="graph-panel-toggle"
            onClick={() => togglePanel("legend")}
            aria-label={collapsedPanels.legend ? "Expand node types" : "Minimize node types"}
            title={collapsedPanels.legend ? "Expand" : "Minimize"}
          >
            {collapsedPanels.legend ? "+" : "−"}
          </button>
        </div>
        {!collapsedPanels.legend && (entityMode ? (
          <>
            <span><i className="legend-dot person" /> Person</span>
            <span><i className="legend-dot phone" /> Phone</span>
            <span><i className="legend-dot account" /> Account</span>
            <span><i className="legend-dot vehicle" /> Vehicle</span>
            <span><i className="legend-dot device" /> Device</span>
            <span><i className="legend-dot location" /> Location</span>
            <span><i className="legend-dot event" /> Event</span>
            <span><i className="legend-dot org" /> Organization</span>
            <span><i className="legend-dot case" /> Case</span>
          </>
        ) : (
          <>
            <span><i className="legend-dot person-blue" /> Person</span>
            <span><i className="legend-dot key-gold" /> Key person (finding)</span>
            <span><i className="legend-dot cross-purple" /> Person (cross-case)</span>
            <span><i className="legend-dot centrality-pink" /> Person (high centrality)</span>
            <span><i className="legend-dot lead-ring" /> Investigation lead</span>
            <div className="legend-edge-title">EDGE TYPES</div>
            <span><i className="legend-line direct" /> Direct connection</span>
            <span><i className="legend-line cross-dashed" /> Cross-case connection</span>
          </>
        ))}
      </div>
    </div>
  );
}

