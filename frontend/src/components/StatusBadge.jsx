const LABELS = {
  reported: "Reported",
  assigned: "Assigned",
  in_progress: "In Progress",
  cleared: "Cleared",
  available: "Available",
  busy: "Busy",
};

export default function StatusBadge({ status }) {
  return <span className={`badge ${status}`}>{LABELS[status] || status}</span>;
}
