import "./GraphControls.css";

type View = "graph" | "timeline" | "map";

type Props = {
  view: View;
  onViewChange: (v: View) => void;
  hopDistance: 0 | 1 | 2;
  onHopChange: (hop: 0 | 1 | 2) => void;
};

export default function GraphControls({ view, onViewChange, hopDistance, onHopChange }: Props) {
  return (
    <div className="graph-controls">
      <div className="view-tabs">
        {(["graph", "timeline", "map"] as const).map((v) => (
          <button key={v} className={view === v ? "active" : ""} onClick={() => onViewChange(v)}>
            {v === "graph" ? "NETWORK" : v.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="graph-actions">
        <button className={hopDistance === 1 ? "active" : ""} onClick={() => onHopChange(1)}>1 HOP</button>
        <button className={hopDistance === 2 ? "active" : ""} onClick={() => onHopChange(2)}>2 HOPS</button>
        <button className={hopDistance === 0 ? "active" : ""} onClick={() => onHopChange(0)}>RESET</button>
      </div>
    </div>
  );
}
