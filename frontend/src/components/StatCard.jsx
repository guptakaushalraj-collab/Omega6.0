export default function StatCard({ label, value, hint }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="meta" style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
