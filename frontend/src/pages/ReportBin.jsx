import { useState, useRef } from "react";
import { api } from "../api.js";
import Toast from "../components/Toast.jsx";

export default function ReportBin() {
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [location, setLocation] = useState({ lat: "", lng: "" });
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setToast({ type: "error", message: "Geolocation isn't supported by this browser." });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        });
        setLocating(false);
      },
      () => {
        setToast({ type: "error", message: "Couldn't get your location. Enter it manually." });
        setLocating(false);
      }
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!location.lat || !location.lng) {
      setToast({ type: "error", message: "Location is required — use 'Use my location' or enter coordinates." });
      return;
    }

    setSubmitting(true);
    setResult(null);
    try {
      const formData = new FormData();
      if (photo) formData.append("photo", photo);
      formData.append("lat", location.lat);
      formData.append("lng", location.lng);
      formData.append("address", address);
      formData.append("notes", notes);
      formData.append("reporterName", reporterName || "Anonymous");
      formData.append("autoAssign", "true");

      const { bin, task } = await api.reportBin(formData);
      setResult({ bin, task });
      setToast({ type: "success", message: "Bin reported! Thanks for helping keep the city clean." });

      setPhoto(null);
      setPreview(null);
      setAddress("");
      setNotes("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Report an Overflowing Bin</h1>
        <p>Add a photo and location — our AI will identify the waste type and a nearby worker gets assigned automatically.</p>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <form className="stack" onSubmit={handleSubmit}>
            <div>
              <label>Photo of the bin</label>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} />
              {preview && <img src={preview} alt="Preview" className="photo-preview" style={{ marginTop: 10 }} />}
            </div>

            <div>
              <label>Location</label>
              <div className="row">
                <input
                  type="number"
                  step="any"
                  placeholder="Latitude"
                  value={location.lat}
                  onChange={(e) => setLocation((l) => ({ ...l, lat: e.target.value }))}
                />
                <input
                  type="number"
                  step="any"
                  placeholder="Longitude"
                  value={location.lng}
                  onChange={(e) => setLocation((l) => ({ ...l, lng: e.target.value }))}
                />
              </div>
              <button type="button" className="secondary" style={{ marginTop: 8 }} onClick={useMyLocation} disabled={locating}>
                {locating ? "Locating…" : "📍 Use my location"}
              </button>
            </div>

            <div>
              <label>Address / landmark (optional)</label>
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. MG Road bus stop" />
            </div>

            <div>
              <label>Notes (optional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything workers should know?" />
            </div>

            <div>
              <label>Your name (optional)</label>
              <input type="text" value={reporterName} onChange={(e) => setReporterName(e.target.value)} placeholder="Anonymous" />
            </div>

            <button type="submit" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit Report"}
            </button>
          </form>
        </div>

        <div className="card">
          <h2 className="section-title">What happens next</h2>
          {!result && (
            <ol style={{ paddingLeft: 18, color: "var(--text-muted)", lineHeight: 1.8 }}>
              <li>Our AI classifier scans the photo to identify the waste type.</li>
              <li>The nearest available worker is auto-assigned.</li>
              <li>You'll see a confirmation with the predicted waste type below.</li>
              <li>Once collected, the status updates to "Cleared".</li>
            </ol>
          )}
          {result && (
            <div className="list-gap">
              <div>
                <span className="badge" style={{ background: result.bin.wasteType.binColor + "22", color: result.bin.wasteType.binColor }}>
                  {result.bin.wasteType.label} · {(result.bin.wasteType.confidence * 100).toFixed(0)}% confidence
                </span>
              </div>
              <p style={{ margin: 0, color: "var(--text-muted)" }}>Bin ID: <code>{result.bin.id}</code></p>
              {result.task ? (
                <p style={{ margin: 0 }}>✅ Assigned to a worker, {result.task.distanceKm} km away.</p>
              ) : (
                <p style={{ margin: 0 }}>⏳ Waiting for a worker to become available.</p>
              )}
            </div>
          )}
        </div>
      </div>

      <Toast message={toast?.message} type={toast?.type} onClose={() => setToast(null)} />
    </div>
  );
}
