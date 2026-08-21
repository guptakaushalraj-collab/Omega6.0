import { Router } from "express";
import { db } from "../db.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", (req, res) => {
  const { role, workerId } = req.query;
  const data = db.read();
  let list = data.notifications;
  if (role) list = list.filter((n) => n.role === role);
  if (workerId) list = list.filter((n) => n.workerId === workerId);
  res.json(list);
});

notificationsRouter.patch("/:id/read", (req, res) => {
  const data = db.read();
  const notif = data.notifications.find((n) => n.id === req.params.id);
  if (!notif) return res.status(404).json({ error: "Notification not found" });
  notif.read = true;
  db.write(data);
  res.json(notif);
});

notificationsRouter.post("/read-all", (req, res) => {
  const { role, workerId } = req.body;
  const data = db.read();
  data.notifications
    .filter((n) => (role ? n.role === role : true) && (workerId ? n.workerId === workerId : true))
    .forEach((n) => (n.read = true));
  db.write(data);
  res.json({ ok: true });
});
