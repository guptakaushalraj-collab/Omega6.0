import { db } from "./db.js";
import { generateId } from "./utils/idGen.js";

// Seeds a handful of collection workers spread around a sample city center
// so the demo has someone to assign bins to on first run.
const CENTER = { lat: 12.9716, lng: 77.5946 }; // Bengaluru, as a default demo city

function jitter(base, spreadKm = 3) {
  const spreadDeg = spreadKm / 111; // ~111km per degree of latitude
  return base + (Math.random() * 2 - 1) * spreadDeg;
}

const SAMPLE_WORKERS = ["Asha Kumar", "Ravi Singh", "Meera Nair", "Farhan Ali"];

const data = db.read();

if (data.workers.length === 0) {
  for (const name of SAMPLE_WORKERS) {
    data.workers.push({
      id: generateId("worker"),
      name,
      phone: null,
      location: { lat: jitter(CENTER.lat), lng: jitter(CENTER.lng) },
      status: "available",
      createdAt: new Date().toISOString(),
    });
  }
  db.write(data);
  console.log(`Seeded ${SAMPLE_WORKERS.length} workers.`);
} else {
  console.log("Workers already exist, skipping seed.");
}
