/**
 * Flat verb-style alias endpoint.
 *
 *   POST /notifyPickup  { binId, ... }  ->  alert sent to the user
 *
 * Additive alias over the canonical POST /v1/messages. Writes the same
 * message record through the same store, so the two surfaces cannot drift.
 *
 * Convenience over the canonical route: it composes a sensible pickup message
 * for you and defaults the recipient to `citizen` — the person who reported
 * the bin — which is what "sends alert to user" means in this flow. Supply
 * `recipient_type` to alert a worker or admin instead.
 *
 * NOTE ON AUTH: this alias sits behind the same X-API-Key gate as every other
 * /v1 route. That is deliberate — an unauthenticated notification endpoint is
 * a spam vector, and exempting it would be a security regression, not a
 * convenience.
 */
import { Router } from "express";
import crypto from "node:crypto";
import { store } from "./store.js";

export const compatRouter = Router();

const MAX_BODY_CHARS = 1000;
const RECIPIENTS = ["citizen", "worker", "admin"];
const CHANNELS = ["in_app", "sms", "email", "push"];

const newId = (p) => `${p}_${crypto.randomBytes(6).toString("hex")}`;
const fail = (res, status, code, message) =>
  res.status(status).json({ error: { code, message } });

compatRouter.post("/notifyPickup", (req, res) => {
  const body = req.body || {};
  const binId = body.binId ?? body.bin_id ?? body.subject_ref;

  if (!binId) {
    return fail(res, 400, "missing_bin_id", "binId is required.");
  }

  const recipientType = body.recipient_type || "citizen";
  if (!RECIPIENTS.includes(recipientType)) {
    return fail(
      res,
      422,
      "unsupported_recipient",
      `recipient_type must be one of: ${RECIPIENTS.join(", ")}.`
    );
  }

  const channel = body.channel || "in_app";
  if (!CHANNELS.includes(channel)) {
    return fail(res, 422, "unsupported_channel", `channel must be one of: ${CHANNELS.join(", ")}.`);
  }

  // Compose a default message when the caller does not supply one.
  const defaultBody =
    recipientType === "citizen"
      ? "Good news — the bin you reported has been picked up. Thanks for helping keep the city clean!"
      : recipientType === "worker"
        ? `Pickup scheduled for ${binId}.`
        : `Pickup completed for ${binId}.`;

  const messageBody = String(body.message || body.body || defaultBody).trim();
  if (messageBody.length === 0) {
    return fail(res, 400, "missing_body", "message must not be empty.");
  }
  if (messageBody.length > MAX_BODY_CHARS) {
    return fail(res, 422, "body_too_long", `message exceeds ${MAX_BODY_CHARS} characters.`);
  }

  const message = {
    id: newId("msg"),
    recipient_type: recipientType,
    recipient_id: body.recipient_id ?? body.userId ?? null,
    channel,
    body: messageBody,
    subject_ref: String(binId),
    metadata: { ...(body.metadata || {}), trigger: "pickup" },
    // Only in_app actually delivers on this build — see the channel
    // limitation in the README.
    delivery_status: channel === "in_app" ? "delivered" : "queued",
    acknowledged: false,
    created_at: new Date().toISOString(),
    acknowledged_at: null,
  };

  const data = store.read();
  data.messages.unshift(message);
  store.write(data);

  res.status(201).json({
    sent: message.delivery_status === "delivered",
    messageId: message.id,
    binId: message.subject_ref,
    recipient: message.recipient_type,
    channel: message.channel,
    delivery_status: message.delivery_status,
    message: message.body,
  });
});
