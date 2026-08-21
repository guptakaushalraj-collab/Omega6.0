import { Routes, Route } from "react-router-dom";
import NavBar from "./components/NavBar.jsx";
import ReportBin from "./pages/ReportBin.jsx";
import WorkerDashboard from "./pages/WorkerDashboard.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";
import NotificationsPage from "./pages/NotificationsPage.jsx";

export default function App() {
  return (
    <div className="app-shell">
      <NavBar />
      <main className="main">
        <Routes>
          <Route path="/" element={<ReportBin />} />
          <Route path="/worker" element={<WorkerDashboard />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/notifications" element={<NotificationsPage />} />
        </Routes>
      </main>
    </div>
  );
}
