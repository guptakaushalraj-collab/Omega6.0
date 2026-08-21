import { Router } from "express";
import fs from "node:fs";
import { db } from "../db.js";
import { generateId } from "../utils/idGen.js";
import { upload } from "../middleware/upload.js";
import { classifyWaste, WASTE_TYPES } from "../services/classifier.js";
import { assignNearestWorker } from "../services/assignmentService.js";
import { pushNotification } from "../services/notificationService.js";

export const binsRouter = Router();

binsRouter.get("/waste-types", (_req, res) => {
  res.json(WASTE_TYPES);
});

binsRouter.get("/", (req, res) => {
  const { status } = req.query;
  const data = db.read();
  const bins = status ? data.bins.filter((b) => b.status === status) : data.bins;
  res.json(bins.slice().reverse());
});

binsRouter.get("/:id", (req, res) => {
  const data = db.read();
  const bin = data.bins.find((b) => b.id === req.params.id);
  if (!bin) return res.status(404).json({ error: "Bin not found" });
  res.json(bin);
});

binsRouter.post("/", upload.single("photo"), (req, res) => {
  const { lat, lng, address, notes, reporterName, autoAssign } = req.body;

  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  const location = { lat: Number(lat), lng: Number(lng) };
  if (Number.isNaN(location.lat) || Number.isNaN(location.lng)) {
    return res.status(400).json({ error: "lat and lng must be numbers" });
  }

  const imageBuffer = req.file ? fs.readFileSync(req.file.path) : null;
  const classification = classifyWaste(imageBuffer, req.file?.originalname);
  const wasteTypeMeta = WASTE_TYPES.find((w) => w.key === classification.type);

  const data = db.read();
  const bin = {
    id: generateId("bin"),
    photoUrl: req.file ? `/uploads/${req.file.filename}` : null,
    location,
    address: address || null,
    notes: notes || null,
    reporterName: reporterName || "Anonymous",
    wasteType: { ...classification, binColor: wasteTypeMeta?.binColor },
    status: "reported",
    assignedWorkerId: null,
    taskId: null,
    reportedAt: new Date().toISOString(),
    clearedAt: null,
  };

  data.bins.push(bin);
  db.write(data);

  pushNotification({
    role: "admin",
    message: `New ${bin.wasteType.label} bin reported${address ? ` at ${address}` : ""}.`,
    binId: bin.id,
  });

  let task = null;
  if (autoAssign === "true" || autoAssign === true) {
    try {
      task = assignNearestWorker(bin.id);
    } catch (err) {
      // No available worker yet — bin stays "reported" for later assignment.
    }
  }

  const fresh = db.read().bins.find((b) => b.id === bin.id);
  res.status(201).json({ bin: fresh, task });
});

binsRouter.delete("/:id", (req, res) => {
  const data = db.read();
  const idx = data.bins.findIndex((b) => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Bin not found" });
  const [removed] = data.bins.splice(idx, 1);
  data.tasks = data.tasks.filter((t) => t.binId !== removed.id);
  db.write(data);
  res.json({ ok: true });
});
