// Waste-type recognizer.
//
// This is a deterministic stub standing in for a real computer-vision model
// (e.g. a fine-tuned MobileNet/EfficientNet served via TensorFlow.js, or a
// cloud vision API). It derives a "prediction" from the image bytes so the
// same photo always gets the same answer, which is enough to demo the full
// report -> classify -> assign -> collect pipeline end to end.
//
// Swap point: replace the body of `classifyWaste` with a call to your model
// or inference API. Keep the return shape ({ type, confidence, source }) so
// nothing downstream needs to change.

export const WASTE_TYPES = [
  { key: "plastic", label: "Plastic", binColor: "#2563eb" },
  { key: "organic", label: "Organic", binColor: "#16a34a" },
  { key: "paper", label: "Paper", binColor: "#ca8a04" },
  { key: "metal", label: "Metal", binColor: "#64748b" },
  { key: "glass", label: "Glass", binColor: "#0d9488" },
  { key: "e-waste", label: "E-Waste", binColor: "#7c3aed" },
  { key: "mixed", label: "Mixed", binColor: "#78716c" },
];

function hashBytes(buffer) {
  let hash = 2166136261;
  for (let i = 0; i < buffer.length; i += 1) {
    hash ^= buffer[i];
    hash = (hash * 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * @param {Buffer} imageBuffer - raw bytes of the uploaded photo
 * @param {string} [filename] - used as a fallback seed if no bytes given
 * @returns {{type: string, label: string, confidence: number, source: string}}
 */
export function classifyWaste(imageBuffer, filename = "unknown") {
  const seed =
    imageBuffer && imageBuffer.length > 0
      ? hashBytes(imageBuffer)
      : hashBytes(Buffer.from(filename));

  const wasteType = WASTE_TYPES[seed % WASTE_TYPES.length];
  const confidence = Number((0.7 + ((seed >> 8) % 26) / 100).toFixed(2));

  return {
    type: wasteType.key,
    label: wasteType.label,
    confidence,
    source: "stub-cv-model",
  };
}
