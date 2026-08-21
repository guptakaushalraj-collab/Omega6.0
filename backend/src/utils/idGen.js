import crypto from "node:crypto";

export function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}
