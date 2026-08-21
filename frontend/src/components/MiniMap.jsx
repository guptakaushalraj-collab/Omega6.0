// A dependency-free "map": projects lat/lng points onto an SVG canvas
// scaled to their bounding box. Good enough to visualize relative
// positions of bins/workers without pulling in a tile-server dependency.
const WIDTH = 100;
const HEIGHT = 100;
const PAD = 10;

function project(points) {
  if (points.length === 0) return [];
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = maxLat - minLat || 0.01;
  const lngRange = maxLng - minLng || 0.01;

  return points.map((p) => ({
    ...p,
    x: PAD + ((p.lng - minLng) / lngRange) * (WIDTH - PAD * 2),
    // Flip y so north (higher lat) renders toward the top.
    y: HEIGHT - PAD - ((p.lat - minLat) / latRange) * (HEIGHT - PAD * 2),
  }));
}

export default function MiniMap({ bins = [], workers = [], routeOrder = [] }) {
  const binPoints = bins.map((b) => ({
    ...b.location,
    color: b.wasteType?.binColor || "#78716c",
    kind: "bin",
    id: b.id,
  }));
  const workerPoints = workers.map((w) => ({
    ...w.location,
    color: w.status === "available" ? "#1f8a4c" : "#dc2626",
    kind: "worker",
    id: w.id,
    name: w.name,
  }));

  const all = project([...binPoints, ...workerPoints]);
  const binsProjected = all.filter((p) => p.kind === "bin");
  const workersProjected = all.filter((p) => p.kind === "worker");

  const routePoints = routeOrder
    .map((binId) => binsProjected.find((p) => p.id === binId))
    .filter(Boolean);

  if (all.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 20 }}>
        No location data yet.
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      style={{ width: "100%", height: "auto", background: "#eef3ee", borderRadius: 10, border: "1px solid var(--border)" }}
    >
      {routePoints.length > 1 && (
        <polyline
          points={routePoints.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="#166238"
          strokeWidth="0.8"
          strokeDasharray="2,1.5"
        />
      )}
      {binsProjected.map((p, i) => (
        <circle key={`bin-${p.id}-${i}`} cx={p.x} cy={p.y} r="2.4" fill={p.color} stroke="#fff" strokeWidth="0.5" />
      ))}
      {workersProjected.map((p, i) => (
        <rect
          key={`worker-${p.id}-${i}`}
          x={p.x - 2.5}
          y={p.y - 2.5}
          width="5"
          height="5"
          fill={p.color}
          stroke="#fff"
          strokeWidth="0.5"
        />
      ))}
    </svg>
  );
}
