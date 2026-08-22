const pptxgen = require('pptxgenjs');
const p = new pptxgen();
p.layout = 'LAYOUT_WIDE';           // 13.33 x 7.5
p.author = 'Team HYBRID';
p.title  = 'Intelligent Waste Collection Network';

const DARK  = '10402A';   // deep forest
const PANEL = '1B5637';   // card green
const PANEL2= '17493D';   // alt card
const MOSS  = '97BC62';
const MINT  = 'CBE5C8';
const GOLD  = 'E9B44C';
const CREAM = 'F4F6F1';
const HFONT = 'Cambria';
const BFONT = 'Calibri';

const W = 13.33;

function bg(s){ s.background = { color: DARK }; }
function eyebrow(s, t, y){
  s.addText(t, { x:0.7, y:y||0.42, w:11.9, h:0.3, fontFace:BFONT, fontSize:12, bold:true,
    color:MOSS, charSpacing:3, margin:0 });
}
function title(s, t, y){
  s.addText(t, { x:0.68, y:y||0.72, w:11.9, h:0.85, fontFace:HFONT, fontSize:40, bold:true,
    color:CREAM, margin:0 });
}
function card(s,o){
  s.addShape(p.ShapeType.roundRect, { x:o.x, y:o.y, w:o.w, h:o.h, rectRadius:0.08,
    fill:{ color:o.fill||PANEL }, line:{ color:o.line||PANEL, width:1 } });
}

/* ---------------- SLIDE 1 — TEAM ---------------- */
const s1 = p.addSlide(); bg(s1);
s1.addShape(p.ShapeType.roundRect, { x:-3.0, y:-3.0, w:8.2, h:11.6, rectRadius:0.5,
  fill:{ color:PANEL, transparency:55 }, line:{ color:PANEL, width:0, transparency:100 } });

s1.addText('TEAM HYBRID', { x:0.8, y:1.02, w:6.6, h:0.35, fontFace:BFONT, fontSize:13,
  bold:true, color:GOLD, charSpacing:4, margin:0 });
s1.addText('Intelligent Waste\nCollection Network', { x:0.76, y:1.45, w:6.4, h:1.9,
  fontFace:HFONT, fontSize:40, bold:true, color:CREAM, lineSpacing:44, margin:0 });
s1.addText('OMEGA6.0  ·  A six-module tradable platform that turns a\ncitizen photo into a completed pickup.',
  { x:0.8, y:3.45, w:6.2, h:0.9, fontFace:BFONT, fontSize:14, italic:true, color:MINT, margin:0 });
s1.addText('KIIT University  ·  Hackathon Submission 2026',
  { x:0.8, y:6.35, w:6.2, h:0.35, fontFace:BFONT, fontSize:12, color:MOSS, margin:0 });

const members = [
  ['Kaushal Raj Gupta', 'Team Leader',  'KG'],
  ['Shuvecha Chaudhary', 'Trader',      'SC'],
  ['Kanishka Chaudhari', 'Member',      'KC'],
  ['Antima Pathick Prachy', 'Member',   'AP'],
];
s1.addText('THE TEAM', { x:7.65, y:1.02, w:5, h:0.35, fontFace:BFONT, fontSize:13, bold:true,
  color:GOLD, charSpacing:4, margin:0 });
members.forEach((m,i)=>{
  const y = 1.5 + i*1.28;
  card(s1, { x:7.6, y:y, w:5.05, h:1.05, fill: i%2 ? PANEL2 : PANEL });
  s1.addShape(p.ShapeType.ellipse, { x:7.83, y:y+0.2, w:0.65, h:0.65, fill:{ color:MOSS } });
  s1.addText(m[2], { x:7.83, y:y+0.2, w:0.65, h:0.65, fontFace:BFONT, fontSize:13, bold:true,
    color:DARK, align:'center', valign:'middle', margin:0 });
  s1.addText(m[0], { x:8.65, y:y+0.2, w:3.85, h:0.34, fontFace:BFONT, fontSize:15, bold:true,
    color:CREAM, margin:0 });
  s1.addText(m[1], { x:8.65, y:y+0.55, w:3.85, h:0.3, fontFace:BFONT, fontSize:12,
    color: m[1]==='Team Leader'||m[1]==='Trader' ? GOLD : MINT, margin:0 });
});
s1.addNotes('Team HYBRID. Kaushal Raj Gupta leads, Shuvecha Chaudhary ran the trading session, Kanishka Chaudhari and Antima Pathick Prachy on build. Our project: an Intelligent Waste Collection Network built as six independently tradable modules.');

/* ---------------- SLIDE 2 — PROTOTYPE ---------------- */
const s2 = p.addSlide(); bg(s2);
eyebrow(s2, 'PROTOTYPE  ·  WHAT WE BUILT AND INTEGRATED');
title(s2, 'From a photo to a cleared bin');

// pipeline strip
const steps = [['1','reportBin','photo + location'],['2','detectWasteType','AI classify'],
  ['3','assignWorker','nearest free'],['4','optimizeRoute','2-opt sequence'],
  ['5','notifyPickup','alert citizen'],['6','updateAnalytics','dashboard']];
const cw = 1.94, gap = 0.09, x0 = 0.7;
steps.forEach((st,i)=>{
  const x = x0 + i*(cw+gap);
  card(s2, { x:x, y:1.85, w:cw, h:1.45, fill:PANEL });
  s2.addShape(p.ShapeType.ellipse, { x:x+0.16, y:2.02, w:0.4, h:0.4, fill:{ color:MOSS } });
  s2.addText(st[0], { x:x+0.16, y:2.02, w:0.4, h:0.4, fontFace:BFONT, fontSize:11, bold:true,
    color:DARK, align:'center', valign:'middle', margin:0 });
  s2.addText(st[1], { x:x+0.16, y:2.52, w:cw-0.3, h:0.3, fontFace:BFONT, fontSize:12, bold:true,
    color:CREAM, margin:0 });
  s2.addText(st[2], { x:x+0.16, y:2.84, w:cw-0.3, h:0.28, fontFace:BFONT, fontSize:10,
    color:MINT, margin:0 });
  if(i<5) s2.addText('>', { x:x+cw-0.02, y:2.42, w:0.13, h:0.3, fontFace:BFONT, fontSize:12,
    color:MOSS, align:'center', margin:0 });
});

// left: architecture
s2.addText('ARCHITECTURE', { x:0.7, y:3.68, w:5.6, h:0.3, fontFace:BFONT, fontSize:12, bold:true,
  color:GOLD, charSpacing:3, margin:0 });
card(s2, { x:0.7, y:4.06, w:5.9, h:2.25, fill:PANEL2 });
s2.addText([
  { text:'Six independent services, one acyclic mesh.', options:{ bullet:true, breakLine:true, bold:true } },
  { text:'No shared code, no shared database — each service owns its data and reaches the others over HTTP.', options:{ bullet:true, breakLine:true } },
  { text:'Dependencies are declared as capabilities resolved from env vars, so any module can be sold or swapped without a code change.', options:{ bullet:true } },
], { x:0.92, y:4.26, w:5.5, h:1.9, fontFace:BFONT, fontSize:12.5, color:CREAM,
  paraSpaceAfter:7, margin:0 });

// right: proof
s2.addText('PROOF IT RUNS END TO END', { x:6.95, y:3.68, w:5.7, h:0.3, fontFace:BFONT, fontSize:12,
  bold:true, color:GOLD, charSpacing:3, margin:0 });
const stats = [['6','services'],['41','endpoints'],['241ms','full pipeline'],['47/47','tests passing']];
stats.forEach((st,i)=>{
  const x = 6.95 + (i%2)*2.95, y = 4.06 + Math.floor(i/2)*1.14;
  card(s2, { x:x, y:y, w:2.75, h:1.02, fill:PANEL });
  s2.addText(st[0], { x:x+0.18, y:y+0.12, w:2.4, h:0.5, fontFace:HFONT, fontSize:24, bold:true,
    color:GOLD, margin:0 });
  s2.addText(st[1], { x:x+0.18, y:y+0.64, w:2.4, h:0.28, fontFace:BFONT, fontSize:10.5,
    color:MINT, margin:0 });
});
s2.addText('Kill route_optimizer mid-flight and step 4 returns UNORDERED with a reason, step 5 drops its "stop 2 of 5" phrasing, and the run still completes — degradation is designed, not accidental.',
  { x:6.95, y:6.45, w:5.7, h:0.7, fontFace:BFONT, fontSize:11.5, italic:true, color:MINT, margin:0 });
s2.addText('npm run modules:start   ·   npm run workflow   ·   npm run compliance',
  { x:0.7, y:6.45, w:5.9, h:0.32, fontFace:'Courier New', fontSize:9.5, color:MOSS, margin:0 });
s2.addNotes('Six services, 41 endpoints, 47 of 47 tests green. The demo is traced, not simulated: full pipeline in 241ms with nothing skipped. Stop a dependency and the pipeline degrades gracefully instead of failing.');

/* ---------------- SLIDE 3 — TRADING ---------------- */
const s3 = p.addSlide(); bg(s3);
eyebrow(s3, 'TRADING SESSION  ·  SOLD & BOUGHT');
title(s3, 'What we traded');

// SOLD column
s3.addText('SOLD  —  $105,000', { x:0.7, y:1.78, w:3.9, h:0.3, fontFace:BFONT, fontSize:12,
  bold:true, color:GOLD, charSpacing:3, margin:0 });
const sold = [['waste_recognition','$42,000'],['analytics_dashboard','$35,000'],['route_optimizer','$28,000']];
sold.forEach((m,i)=>{
  const y = 2.2 + i*0.8;
  card(s3, { x:0.7, y:y, w:3.95, h:0.66, fill:PANEL });
  s3.addText(m[0], { x:0.88, y:y+0.17, w:2.4, h:0.32, fontFace:BFONT, fontSize:12.5, bold:true,
    color:CREAM, margin:0 });
  s3.addText(m[1], { x:3.3, y:y+0.17, w:1.2, h:0.32, fontFace:BFONT, fontSize:12.5, bold:true,
    color:MOSS, align:'right', margin:0 });
});
s3.addText('Each sale conveys the copyright but retains a perpetual, royalty-free licence-back — we keep running the software, we just stop owning it.',
  { x:0.72, y:4.85, w:3.9, h:0.9, fontFace:BFONT, fontSize:11.5, italic:true, color:MINT, margin:0 });

// BOUGHT column
s3.addText('BOUGHT', { x:4.95, y:1.78, w:3.6, h:0.3, fontFace:BFONT, fontSize:12, bold:true,
  color:GOLD, charSpacing:3, margin:0 });
const bought = [['notification_system','SignalPost Relay 2.4.1'],
                ['worker_dashboard','FieldOps Crew 3.1.0'],
                ['AI assistant chatbot','the integration layer']];
bought.forEach((m,i)=>{
  const y = 2.2 + i*0.8;
  card(s3, { x:4.95, y:y, w:3.8, h:0.66, fill: i===2 ? '25604A' : PANEL2,
             line: i===2 ? MOSS : PANEL2 });
  s3.addText(m[0], { x:5.13, y:y+0.11, w:3.45, h:0.28, fontFace:BFONT, fontSize:12.5, bold:true,
    color: i===2 ? GOLD : CREAM, margin:0 });
  s3.addText(m[1], { x:5.13, y:y+0.38, w:3.45, h:0.25, fontFace:BFONT, fontSize:10.5,
    color:MINT, margin:0 });
});
s3.addText('Buying beat building: both acquired modules shipped a working API contract on day one, so the trading desk spent its budget on integration speed rather than on rewriting solved problems.',
  { x:4.97, y:4.85, w:3.75, h:1.0, fontFace:BFONT, fontSize:11.5, italic:true, color:MINT, margin:0 });

// AI chatbot panel
card(s3, { x:9.1, y:1.78, w:3.55, h:4.05, fill:'25604A', line:MOSS });
s3.addShape(p.ShapeType.ellipse, { x:9.35, y:2.02, w:0.52, h:0.52, fill:{ color:GOLD } });
s3.addText('AI', { x:9.35, y:2.02, w:0.52, h:0.52, fontFace:BFONT, fontSize:12, bold:true,
  color:DARK, align:'center', valign:'middle', margin:0 });
s3.addText('The AI chatbot we bought', { x:9.95, y:2.07, w:2.5, h:0.45, fontFace:BFONT,
  fontSize:13, bold:true, color:CREAM, margin:0 });
s3.addText([
  { text:'Sits above the mesh as a natural-language front door — "which ward is overflowing?" resolves into real calls across the six services.', options:{ bullet:true, breakLine:true } },
  { text:'Associates loose citizen reports with the right bin, ward and waste type, so duplicates collapse instead of becoming extra pickups.', options:{ bullet:true, breakLine:true } },
  { text:'Integrates: one conversation spans reporting, classification, routing and analytics without the user learning six APIs.', options:{ bullet:true } },
], { x:9.32, y:2.78, w:3.1, h:2.9, fontFace:BFONT, fontSize:11, color:CREAM,
  paraSpaceAfter:7, margin:0 });

// bottom band
card(s3, { x:0.7, y:6.22, w:11.95, h:0.95, fill:PANEL });
s3.addText('Net position:', { x:0.95, y:6.45, w:1.5, h:0.4, fontFace:BFONT, fontSize:12.5,
  bold:true, color:GOLD, valign:'middle', margin:0 });
s3.addText('three stateless modules divested for $105,000, two proven modules and an AI chatbot acquired — the network still runs end to end, and now it answers questions in plain English.',
  { x:2.4, y:6.45, w:10.05, h:0.5, fontFace:BFONT, fontSize:12.5, color:CREAM, valign:'middle', margin:0 });
s3.addNotes('Trading session: we sold the three stateless, vertical-agnostic modules for $105,000 total, keeping a royalty-free licence-back so the product keeps running. We bought notification_system and worker_dashboard rather than rebuilding them, plus an AI chatbot that acts as the association and integration layer over the whole mesh.');

p.writeFile({ fileName: process.argv[2] }).then(f=>console.log('wrote', f));
