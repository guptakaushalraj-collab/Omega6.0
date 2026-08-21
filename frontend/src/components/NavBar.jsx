import { NavLink } from "react-router-dom";

const LINKS = [
  { to: "/", label: "Report a Bin", end: true },
  { to: "/worker", label: "Worker Dashboard" },
  { to: "/admin", label: "Admin Dashboard" },
  { to: "/notifications", label: "Notifications" },
];

export default function NavBar() {
  return (
    <header className="navbar">
      <div className="brand">🗑️ Intelligent Waste Collection Network</div>
      <nav>
        {LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end}>
            {link.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
