const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "Omega6.0 Waste Network";
pres.title = "Intelligent Waste Collection Network";

/* ---------------------------------------------------------------- palette */
const FOREST = "1B4332";
const FOREST_MID = "2D6A4F";
const MINT = "95D5B2";
const MINT_DEEP = "52B788";
const OFFWHITE = "F8F9FA";
const WHITE = "FFFFFF";
const GOLD = "E9C46A";
const GOLD_DEEP = "C98B18";
const INK = "22312A";
const MUTED_ON_DARK = "8FAF9E";
const MUTED_ON_LIGHT = "6B7C73";

const H = "Cambria";
const B = "Calibri";

const shadow = () => ({ type: "outer", color: "000000", blur: 8, offset: 2, angle: 90, opacity: 0.16 });

/* ================================================================ SLIDE 1 */
const s1 = pres.addSlide();
s1.background = { color: FOREST };

s1.addText("OMEGA6.0  ·  INTELLIGENT WASTE COLLECTION NETWORK", {
  x: 0.6, y: 0.50, w: 12.1, h: 0.24, margin: 0,
  fontFace: B, fontSize: 11, bold: true, color: MINT, charSpacing: 2,
});
s1.addText("What We Built", {
  x: 0.6, y: 0.80, w: 8, h: 0.72, margin: 0,
  fontFace: H, fontSize: 40, bold: true, color: WHITE,
});

/* ---- left: problem + solution ---- */
s1.addText("THE PROBLEM", {
  x: 0.6, y: 1.72, w: 5.6, h: 0.26, margin: 0,
  fontFace: B, fontSize: 12, bold: true, color: GOLD, charSpacing: 1.5,
});
s1.addText(
  "Overflowing bins get reported by phone, sorted by guesswork, and collected on fixed routes that ignore where the waste actually is.",
  { x: 0.6, y: 2.02, w: 5.6, h: 0.85, margin: 0,
    fontFace: B, fontSize: 14.5, color: "D8E8DF", lineSpacing: 21 }
);

s1.addText("THE SOLUTION", {
  x: 0.6, y: 3.05, w: 5.6, h: 0.26, margin: 0,
  fontFace: B, fontSize: 12, bold: true, color: GOLD, charSpacing: 1.5,
});

const solution = [
  ["01", "Citizens report", "Photo + location from any phone"],
  ["02", "AI classifies", "7 waste types with confidence scores"],
  ["03", "Nearest worker dispatched", "Routes sequenced, everyone notified"],
];
solution.forEach(([num, head, sub], i) => {
  const y = 3.42 + i * 0.78;
  s1.addShape(pres.ShapeType.ellipse, {
    x: 0.6, y: y + 0.04, w: 0.46, h: 0.46,
    fill: { color: FOREST_MID }, line: { color: MINT_DEEP, width: 1 },
  });
  s1.addText(num, {
    x: 0.6, y: y + 0.04, w: 0.46, h: 0.46, margin: 0,
    fontFace: B, fontSize: 12, bold: true, color: MINT, align: "center", valign: "middle",
  });
  s1.addText(head, {
    x: 1.22, y: y + 0.02, w: 5.0, h: 0.26, margin: 0,
    fontFace: B, fontSize: 14, bold: true, color: WHITE,
  });
  s1.addText(sub, {
    x: 1.22, y: y + 0.29, w: 5.0, h: 0.24, margin: 0,
    fontFace: B, fontSize: 11.5, color: MUTED_ON_DARK,
  });
});

/* ---- right: architecture grid ---- */
s1.addText("ARCHITECTURE — SIX INDEPENDENT SERVICES", {
  x: 6.85, y: 1.72, w: 5.9, h: 0.26, margin: 0,
  fontFace: B, fontSize: 12, bold: true, color: GOLD, charSpacing: 1.5,
});

const modules = [
  ["bin_reporting", ":4101", "in-house"],
  ["waste_recognition", ":4102", "in-house"],
  ["route_optimizer", ":4103", "in-house"],
  ["analytics_dashboard", ":4104", "in-house"],
  ["notification_system", ":4105", "acquired"],
  ["worker_dashboard", ":4106", "acquired"],
];
modules.forEach(([name, port, origin], i) => {
  const col = i % 2;
  const row = Math.floor(i / 2);
  const x = 6.85 + col * 3.05;
  const y = 2.05 + row * 1.02;
  const acq = origin === "acquired";
  s1.addShape(pres.ShapeType.roundRect, {
    x, y, w: 2.85, h: 0.88, rectRadius: 0.08,
    fill: { color: acq ? "2A4F5E" : FOREST_MID },
    line: { color: acq ? "5FA8C7" : MINT_DEEP, width: 1 },
  });
  s1.addText(name, {
    x: x + 0.16, y: y + 0.12, w: 2.55, h: 0.28, margin: 0,
    fontFace: B, fontSize: 12.5, bold: true, color: WHITE,
  });
  s1.addText(`${port}   ·   ${origin}`, {
    x: x + 0.16, y: y + 0.44, w: 2.55, h: 0.26, margin: 0,
    fontFace: B, fontSize: 10.5, color: acq ? "A8D5E8" : MINT,
  });
});

s1.addText(
  "Acyclic mesh. No shared code, no shared database — each service owns its data and reaches the others over HTTP.",
  { x: 6.85, y: 5.18, w: 5.9, h: 0.55, margin: 0,
    fontFace: B, fontSize: 11.5, italic: true, color: MUTED_ON_DARK, lineSpacing: 16 }
);

/* ---- bottom stats ---- */
const s1stats = [
  ["6", "services"],
  ["41", "endpoints"],
  ["6,551", "lines of code"],
  ["47/47", "tests passing"],
];
s1stats.forEach(([v, l], i) => {
  const x = 0.6 + i * 3.06;
  s1.addText(v, {
    x, y: 6.15, w: 2.9, h: 0.55, margin: 0,
    fontFace: H, fontSize: 32, bold: true, color: MINT,
  });
  s1.addText(l, {
    x, y: 6.72, w: 2.9, h: 0.28, margin: 0,
    fontFace: B, fontSize: 11.5, color: MUTED_ON_DARK, charSpacing: 1,
  });
});

s1.addNotes(
  "Problem: bins are reported by phone, sorted by guesswork, collected on fixed routes. " +
  "Solution: photo-and-location intake, AI waste classification, nearest-worker dispatch, optimized routes. " +
  "Architecture: six independently deployable services, acyclic, no shared code or database. " +
  "6,551 lines, 41 endpoints, 47 integration checks all passing."
);

/* ================================================================ SLIDE 2 */
const s2 = pres.addSlide();
s2.background = { color: OFFWHITE };

s2.addText("MODULE MARKETPLACE", {
  x: 0.6, y: 0.50, w: 12.1, h: 0.24, margin: 0,
  fontFace: B, fontSize: 11, bold: true, color: GOLD_DEEP, charSpacing: 2,
});
s2.addText("What We Traded", {
  x: 0.6, y: 0.80, w: 8, h: 0.72, margin: 0,
  fontFace: H, fontSize: 40, bold: true, color: FOREST,
});

/* ---- divested ---- */
s2.addText("DIVESTED  —  3 MODULES", {
  x: 0.6, y: 1.72, w: 6.0, h: 0.26, margin: 0,
  fontFace: B, fontSize: 12, bold: true, color: FOREST_MID, charSpacing: 1.5,
});

const sold = [
  ["waste_recognition", "$42,000", "Stateless, model-agnostic"],
  ["analytics_dashboard", "$35,000", "Push-based, vertical-agnostic"],
  ["route_optimizer", "$28,000", "Pure computation, no state"],
];
sold.forEach(([name, price, why], i) => {
  const y = 1.98 + i * 0.78;
  s2.addShape(pres.ShapeType.roundRect, {
    x: 0.6, y, w: 6.0, h: 0.68, rectRadius: 0.07,
    fill: { color: WHITE }, line: { color: "D9E4DD", width: 1 }, shadow: shadow(),
  });
  s2.addText(name, {
    x: 0.78, y: y + 0.08, w: 3.6, h: 0.26, margin: 0,
    fontFace: B, fontSize: 13, bold: true, color: INK,
  });
  s2.addText(why, {
    x: 0.78, y: y + 0.36, w: 3.9, h: 0.24, margin: 0,
    fontFace: B, fontSize: 10.5, color: MUTED_ON_LIGHT,
  });
  s2.addText(price, {
    x: 4.6, y: y + 0.17, w: 1.85, h: 0.36, margin: 0,
    fontFace: H, fontSize: 19, bold: true, color: GOLD_DEEP, align: "right",
  });
});

s2.addShape(pres.ShapeType.roundRect, {
  x: 0.6, y: 4.36, w: 6.0, h: 0.72, rectRadius: 0.07,
  fill: { color: FOREST }, line: { color: FOREST, width: 1 },
});
s2.addText("TOTAL DIVESTMENT", {
  x: 0.8, y: 4.54, w: 3.0, h: 0.36, margin: 0,
  fontFace: B, fontSize: 12, bold: true, color: MINT, charSpacing: 1.5, valign: "middle",
});
s2.addText("$105,000", {
  x: 3.9, y: 4.46, w: 2.5, h: 0.5, margin: 0,
  fontFace: H, fontSize: 25, bold: true, color: GOLD, align: "right", valign: "middle",
});

/* ---- retained ---- */
s2.addText("RETAINED  —  2 ACQUIRED MODULES", {
  x: 6.9, y: 1.72, w: 5.8, h: 0.26, margin: 0,
  fontFace: B, fontSize: 12, bold: true, color: FOREST_MID, charSpacing: 1.5,
});

const kept = [
  ["worker_dashboard", "FieldOps Crew · escrowed source", "Vertical-agnostic — resells beyond waste"],
  ["notification_system", "SignalPost Relay · perpetual", "Support window closes 2027-03-14"],
];
kept.forEach(([name, meta, why], i) => {
  const y = 1.98 + i * 0.92;
  s2.addShape(pres.ShapeType.roundRect, {
    x: 6.9, y, w: 5.8, h: 0.82, rectRadius: 0.07,
    fill: { color: WHITE }, line: { color: "C6DCE8", width: 1 }, shadow: shadow(),
  });
  s2.addText(name, {
    x: 7.08, y: y + 0.09, w: 5.4, h: 0.26, margin: 0,
    fontFace: B, fontSize: 13, bold: true, color: INK,
  });
  s2.addText(meta, {
    x: 7.08, y: y + 0.35, w: 5.4, h: 0.22, margin: 0,
    fontFace: B, fontSize: 10.5, color: "3E7B94",
  });
  s2.addText(why, {
    x: 7.08, y: y + 0.56, w: 5.4, h: 0.22, margin: 0,
    fontFace: B, fontSize: 10.5, italic: true, color: MUTED_ON_LIGHT,
  });
});

/* ---- consulting ---- */
s2.addShape(pres.ShapeType.roundRect, {
  x: 6.9, y: 3.82, w: 5.8, h: 1.26, rectRadius: 0.07,
  fill: { color: "FBF3DF" }, line: { color: GOLD, width: 1 },
});
s2.addShape(pres.ShapeType.ellipse, {
  x: 7.1, y: 4.06, w: 0.52, h: 0.52,
  fill: { color: GOLD_DEEP }, line: { color: GOLD_DEEP, width: 1 },
});
s2.addText("30", {
  x: 7.1, y: 4.06, w: 0.52, h: 0.52, margin: 0,
  fontFace: B, fontSize: 15, bold: true, color: WHITE, align: "center", valign: "middle",
});
s2.addText("Consulting slot — 30 minutes", {
  x: 7.8, y: 4.02, w: 4.7, h: 0.28, margin: 0,
  fontFace: B, fontSize: 13.5, bold: true, color: INK,
});
s2.addText(
  "Scoped to verification and risk sign-off, not implementation. 30 minutes does not buy integration work — it buys an independent go/no-go before money moves.",
  { x: 7.8, y: 4.31, w: 4.72, h: 0.68, margin: 0,
    fontFace: B, fontSize: 10.5, color: "6E5C2E", lineSpacing: 14 }
);

/* ---- insight ---- */
s2.addShape(pres.ShapeType.roundRect, {
  x: 0.6, y: 5.42, w: 12.1, h: 1.28, rectRadius: 0.08,
  fill: { color: "E8F1EC" }, line: { color: "C3DACE", width: 1 },
});
s2.addText("The catch we had to solve", {
  x: 0.88, y: 5.6, w: 11.6, h: 0.28, margin: 0,
  fontFace: B, fontSize: 13, bold: true, color: FOREST,
});
s2.addText(
  "Both retained modules consume capabilities from all three we sold — an outright sale would have stopped the product on settlement day. Each deal conveys copyright, exploitation and resale rights while retaining a perpetual royalty-free licence-back for internal operation. Verified: repointing to buyer-hosted endpoints needs an environment variable, not a code change.",
  { x: 0.88, y: 5.9, w: 11.55, h: 0.72, margin: 0,
    fontFace: B, fontSize: 11.5, color: "2F473C", lineSpacing: 16 }
);

s2.addNotes(
  "Sold three MIT in-house modules for $105k total. Kept the two acquired proprietary ones. " +
  "The hard part: both retained modules depend on all three sold, so we structured each sale with a " +
  "perpetual royalty-free licence-back — we keep running them, we lose the right to resell. " +
  "Consulting slot deliberately scoped to verification, not build work."
);

/* ================================================================ SLIDE 3 */
const s3 = pres.addSlide();
s3.background = { color: FOREST };

s3.addText("END-TO-END PIPELINE", {
  x: 0.6, y: 0.50, w: 12.1, h: 0.24, margin: 0,
  fontFace: B, fontSize: 11, bold: true, color: MINT, charSpacing: 2,
});
s3.addText("What We Integrated", {
  x: 0.6, y: 0.80, w: 9, h: 0.72, margin: 0,
  fontFace: H, fontSize: 40, bold: true, color: WHITE,
});

const steps = [
  ["1", "reportBin", "photo + location"],
  ["2", "detectWasteType", "AI classify"],
  ["3", "assignWorker", "nearest free"],
  ["4", "optimizeRoute", "2-opt sequence"],
  ["5", "notifyPickup", "alert citizen"],
  ["6", "updateAnalytics", "dashboard"],
];
steps.forEach(([n, name, sub], i) => {
  const x = 0.6 + i * 2.05;
  s3.addShape(pres.ShapeType.roundRect, {
    x, y: 1.82, w: 1.9, h: 1.62, rectRadius: 0.08,
    fill: { color: FOREST_MID }, line: { color: MINT_DEEP, width: 1 },
  });
  s3.addShape(pres.ShapeType.ellipse, {
    x: x + 0.7, y: 2.0, w: 0.5, h: 0.5,
    fill: { color: MINT }, line: { color: MINT, width: 1 },
  });
  s3.addText(n, {
    x: x + 0.7, y: 2.0, w: 0.5, h: 0.5, margin: 0,
    fontFace: B, fontSize: 15, bold: true, color: FOREST, align: "center", valign: "middle",
  });
  s3.addText(name, {
    x: x + 0.08, y: 2.6, w: 1.74, h: 0.46, margin: 0,
    fontFace: B, fontSize: 11.5, bold: true, color: WHITE, align: "center",
  });
  s3.addText(sub, {
    x: x + 0.08, y: 3.04, w: 1.74, h: 0.28, margin: 0,
    fontFace: B, fontSize: 9.5, color: MUTED_ON_DARK, align: "center",
  });
  if (i < steps.length - 1) {
    s3.addText("›", {
      x: x + 1.9, y: 2.36, w: 0.15, h: 0.4, margin: 0,
      fontFace: B, fontSize: 20, bold: true, color: MINT_DEEP, align: "center", valign: "middle",
    });
  }
});

/* ---- demo results ---- */
s3.addText("LIVE DEMO — TRACED, NOT SIMULATED", {
  x: 0.6, y: 3.72, w: 12.1, h: 0.26, margin: 0,
  fontFace: B, fontSize: 12, bold: true, color: GOLD, charSpacing: 1.5,
});

const results = [
  ["241ms", "full pipeline", MINT],
  ["degraded: null", "nothing skipped", MINT],
  ["47/47", "integration checks", MINT],
  ["67", "compliance checks", GOLD],
];
results.forEach(([v, l, c], i) => {
  const x = 0.6 + i * 3.06;
  s3.addShape(pres.ShapeType.roundRect, {
    x, y: 4.06, w: 2.86, h: 1.02, rectRadius: 0.07,
    fill: { color: FOREST_MID }, line: { color: "3F7D63", width: 1 },
  });
  s3.addText(v, {
    x: x + 0.16, y: 4.2, w: 2.55, h: 0.42, margin: 0,
    fontFace: H, fontSize: v.length > 8 ? 17 : 23, bold: true, color: c,
  });
  s3.addText(l, {
    x: x + 0.16, y: 4.66, w: 2.55, h: 0.26, margin: 0,
    fontFace: B, fontSize: 10.5, color: MUTED_ON_DARK,
  });
});

/* ---- resilience + command ---- */
s3.addShape(pres.ShapeType.roundRect, {
  x: 0.6, y: 5.34, w: 6.0, h: 1.36, rectRadius: 0.07,
  fill: { color: "153A2A" }, line: { color: "2F6B4F", width: 1 },
});
s3.addText("Kill a dependency mid-flight", {
  x: 0.82, y: 5.5, w: 5.6, h: 0.28, margin: 0,
  fontFace: B, fontSize: 12.5, bold: true, color: WHITE,
});
s3.addText(
  "With route_optimizer stopped, step 4 returns UNORDERED with a reason, step 5 drops its “stop 2 of 5” phrasing, and the run still completes. Degradation is designed, not accidental.",
  { x: 0.82, y: 5.8, w: 5.58, h: 0.78, margin: 0,
    fontFace: B, fontSize: 10.5, color: "B9D4C6", lineSpacing: 14 }
);

s3.addShape(pres.ShapeType.roundRect, {
  x: 6.9, y: 5.34, w: 5.8, h: 1.36, rectRadius: 0.07,
  fill: { color: "153A2A" }, line: { color: "2F6B4F", width: 1 },
});
s3.addText("Run it yourself", {
  x: 7.12, y: 5.5, w: 5.4, h: 0.28, margin: 0,
  fontFace: B, fontSize: 12.5, bold: true, color: WHITE,
});
s3.addText("npm run modules:start", {
  x: 7.12, y: 5.82, w: 5.4, h: 0.26, margin: 0,
  fontFace: "Courier New", fontSize: 12, color: MINT,
});
s3.addText("npm run workflow", {
  x: 7.12, y: 6.08, w: 5.4, h: 0.26, margin: 0,
  fontFace: "Courier New", fontSize: 12, color: MINT,
});
s3.addText("npm run compliance", {
  x: 7.12, y: 6.34, w: 5.4, h: 0.26, margin: 0,
  fontFace: "Courier New", fontSize: 12, color: MINT,
});

s3.addNotes(
  "Six discrete steps, each traced with its call, result and timing. Full pipeline runs in 241ms. " +
  "degraded:null means classification and dispatch both completed. " +
  "Resilience is designed: kill route_optimizer and step 4 degrades to UNORDERED with a reason rather than failing. " +
  "47 integration checks and 67 compliance checks all pass. Everything on this slide is runnable from the repo."
);

pres.writeFile({ fileName: "/home/user/Omega6.0/docs/pitch-deck.pptx" }).then((f) => {
  console.log("wrote", f);
});
