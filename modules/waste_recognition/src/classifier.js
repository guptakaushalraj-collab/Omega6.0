// The model boundary.
//
// `classify()` is a deterministic stub: it hashes the image bytes so the same
// photo always yields the same prediction. That keeps the API contract, the
// audit trail and every downstream integration exercisable without shipping a
// 20MB model artifact or requiring a GPU.
//
// To productionize, replace ONLY the marked section below with a real
// inference call (TensorFlow.js, ONNX Runtime, or a hosted vision API). The
// return shape is the module's published contract — keep it byte-identical
// and no consumer needs to change.

export const TAXONOMY = [
  { type: "plastic", label: "Plastic", color: "#2563eb", recyclable: true, hazardous: false },
  { type: "organic", label: "Organic", color: "#16a34a", recyclable: false, hazardous: false },
  { type: "paper", label: "Paper", color: "#ca8a04", recyclable: true, hazardous: false },
  { type: "metal", label: "Metal", color: "#64748b", recyclable: true, hazardous: false },
  { type: "glass", label: "Glass", color: "#0d9488", recyclable: true, hazardous: false },
  { type: "e-waste", label: "E-Waste", color: "#7c3aed", recyclable: true, hazardous: true },
  { type: "mixed", label: "Mixed", color: "#78716c", recyclable: false, hazardous: false },
];

const MODEL_VERSION = "stub-cv-1.0.0";

function fnv1a(buffer) {
  let hash = 2166136261;
  for (let i = 0; i < buffer.length; i += 1) {
    hash ^= buffer[i];
    hash = (hash * 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * @param {Buffer} imageBuffer raw image bytes
 * @returns {{type,label,color,recyclable,hazardous,confidence,alternatives,model_version}}
 */
export function classify(imageBuffer) {
  if (!imageBuffer || imageBuffer.length === 0) {
    throw new Error("image is empty");
  }

  // ---- replace from here for a real model -------------------------------
  const seed = fnv1a(imageBuffer);
  const primary = TAXONOMY[seed % TAXONOMY.length];
  const confidence = Number((0.7 + ((seed >> 8) % 26) / 100).toFixed(2));
  // ---- to here ----------------------------------------------------------

  // Runners-up, so consumers can implement their own review thresholds.
  // Drawn without replacement — a real classifier never ranks the same class
  // twice, and consumers reasonably assume these are distinct.
  const pool = TAXONOMY.filter((t) => t.type !== primary.type);
  const alternatives = [];
  for (let i = 0; i < 2 && pool.length > 0; i += 1) {
    const [candidate] = pool.splice((seed >> (4 * (i + 1))) % pool.length, 1);
    alternatives.push({
      type: candidate.type,
      label: candidate.label,
      confidence: Number((confidence * (0.45 - i * 0.15)).toFixed(2)),
    });
  }

  return {
    type: primary.type,
    label: primary.label,
    color: primary.color,
    recyclable: primary.recyclable,
    hazardous: primary.hazardous,
    confidence,
    alternatives,
    model_version: MODEL_VERSION,
  };
}

export { MODEL_VERSION };
