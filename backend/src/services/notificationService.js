import { db } from "../db.js";
import { generateId } from "../utils/idGen.js";

// In-app notification store. In production this would also fan out to
// push/SMS/email (the `channels` field below is where that integration
// would plug in); for the hackathon demo, "sent" means "visible in the UI".
export function pushNotification({ role, workerId = null, message, binId = null }) {
  const data = db.read();
  const notification = {
    id: generateId("notif"),
    role,
    workerId,
    binId,
    message,
    read: false,
    createdAt: new Date().toISOString(),
    channels: ["in-app"],
  };
  data.notifications.unshift(notification);
  db.write(data);
  return notification;
}
