import { useState, useEffect, useRef } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ─── Storage (Server + localStorage) ───
const LADDERS_KEY     = "lp_ladders";
const INSPECTIONS_KEY = "lp_inspections";
const PRUEFER_KEY     = "lp_pruefer";
const LOCATIONS_KEY   = "lp_locations";

function lsRead(key, fallback) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}

function saveData(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
  fetch("/api/data/" + key, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: data }),
  }).catch(() => {});
}

async function loadAllFromServer() {
  try {
    const r = await fetch("/api/data-all");
    if (r.ok) return await r.json();
  } catch {}
  return null;
}

// ─── Leitertypen & Materialien ───
const LADDER_TYPES = [
  { id: "stehleiter",      label: "Stehleiter",         icon: "⊼" },
  { id: "anlegeleiter",    label: "Anlegeleiter",        icon: "⟋" },
  { id: "mehrzweckleiter", label: "Mehrzweckleiter",     icon: "⋈" },
  { id: "trittleiter",     label: "Trittleiter / Tritt", icon: "⊥" },
  { id: "schiebeleiter",   label: "Schiebeleiter",       icon: "⇕" },
  { id: "podestleiter",    label: "Podestleiter",        icon: "⊓" },
];
const MATERIALS = ["Aluminium", "Stahl", "Holz", "GFK (Glasfaser)", "Kunststoff"];

// ─── Prüffragen ───
const BASE_QUESTIONS = [
  { id:"q_kennzeichnung",   section:"Kennzeichnung & Dokumentation", text:"Sind Typenschild, Betriebsanleitung und Sicherheitspiktogramme vollständig und lesbar?",               norm:"DIN EN 131-3",   critical:true  },
  { id:"q_gs_zeichen",      section:"Kennzeichnung & Dokumentation", text:"Ist das GS-Zeichen vorhanden und unbeschädigt?",                                                         norm:"ProdSG §21",     critical:false },
  { id:"q_holme_zustand",   section:"Holme / Wangen",                text:"Sind die Holme/Wangen frei von Verformungen, Rissen, Dellen, Knicken, Korrosion und Materialermüdung?", norm:"DGUV 208-016",   critical:true  },
  { id:"q_holme_verbindung",section:"Holme / Wangen",                text:"Sind alle Verbindungsstellen der Holme (Nieten, Schweißnähte, Schrauben) intakt?",                       norm:"BetrSichV §14",  critical:true  },
  { id:"q_sprossen_zustand",section:"Sprossen / Stufen",             text:"Sind alle Sprossen/Stufen vollständig vorhanden, fest befestigt und frei von Schäden?",                  norm:"DGUV 208-016",   critical:true  },
  { id:"q_sprossen_rutsch", section:"Sprossen / Stufen",             text:"Ist die Rutschhemmung der Sprossen/Stufen einwandfrei?",                                                  norm:"DIN EN 131-1",   critical:false },
  { id:"q_fuesse_zustand",  section:"Leiterfüße",                    text:"Sind die Leiterfüße vollständig, sicher befestigt und nicht übermäßig abgenutzt?",                       norm:"DGUV 208-016",   critical:true  },
  { id:"q_fuesse_rutsch",   section:"Leiterfüße",                    text:"Ist die Rutschhemmung der Leiterfüße ausreichend und funktionsfähig?",                                    norm:"DIN EN 131-2",   critical:true  },
  { id:"q_schrauben",       section:"Verbindungselemente",           text:"Sind alle Schrauben, Muttern und Bolzen fest angezogen und vollständig vorhanden?",                       norm:"BetrSichV §14",  critical:true  },
  { id:"q_oberflaeche",     section:"Oberfläche & Zustand",          text:"Ist die Oberfläche frei von scharfen Kanten, Graten oder Splittern?",                                    norm:"DGUV 208-016",   critical:true  },
  { id:"q_zustand",         section:"Oberfläche & Zustand",          text:"Ist die Leiter sauber, rutschfrei und die Oberflächenbeschichtung intakt?",                               norm:"DGUV 208-016",   critical:false },
];
const TYPE_SPECIFIC = {
  stehleiter:     [
    { id:"q_spreiz",          section:"Spreizsicherung",    text:"Ist die Spreizsicherung vorhanden, funktionsfähig und rastet sicher ein?",              norm:"DIN EN 131-2", critical:true  },
    { id:"q_plattform",       section:"Plattform",          text:"Ist die Plattform/obere Stufe vollständig und in gutem Zustand?",                       norm:"DIN EN 131-2", critical:true  },
  ],
  anlegeleiter:   [
    { id:"q_anlege_haken",    section:"Einhängevorrichtung",text:"Sind Einhängehaken oder Anlagevorrichtungen vorhanden und funktionsfähig?",             norm:"DIN EN 131-2", critical:false },
    { id:"q_anlege_fuss",     section:"Standsicherheit",    text:"Ist eine Fußverbreiterung oder Kopfanlage vorhanden und funktionsfähig?",               norm:"DGUV 208-016", critical:false },
  ],
  mehrzweckleiter:[
    { id:"q_mzw_gelenke",     section:"Gelenke & Scharniere",text:"Sind alle Gelenke/Scharniere funktionsfähig und rasten sicher ein?",                  norm:"DIN EN 131-4", critical:true  },
    { id:"q_mzw_schiebe",     section:"Schiebeführung",     text:"Funktioniert der Schiebeauszug leichtgängig und arretiert sicher?",                    norm:"DIN EN 131-2", critical:true  },
    { id:"q_mzw_spreiz",      section:"Spreizsicherung",    text:"Ist die Spreizsicherung (als Stehleiter) vorhanden und funktionsfähig?",               norm:"DIN EN 131-2", critical:true  },
  ],
  trittleiter:    [
    { id:"q_tritt_plattform", section:"Trittfläche",        text:"Ist die Trittfläche/Plattform rutschhemmend und unbeschädigt?",                        norm:"DIN EN 14183", critical:true  },
    { id:"q_tritt_klapp",     section:"Klappmechanismus",   text:"Funktioniert der Klappmechanismus einwandfrei und arretiert sicher?",                  norm:"DIN EN 14183", critical:true  },
  ],
  schiebeleiter:  [
    { id:"q_schiebe_fuehrung",section:"Schiebeführung",     text:"Gleiten die Leiterteile leichtgängig und ohne Verkanten in der Führung?",              norm:"DIN EN 131-2", critical:true  },
    { id:"q_schiebe_arret",   section:"Arretierung",        text:"Funktioniert die Höhenarretierung zuverlässig?",                                       norm:"DIN EN 131-2", critical:true  },
    { id:"q_schiebe_seil",    section:"Seilzug",            text:"Ist der Seilzug unbeschädigt und leichtgängig (falls vorhanden)?",                     norm:"DIN EN 131-2", critical:false },
  ],
  podestleiter:   [
    { id:"q_podest_plattform",section:"Plattform",          text:"Ist die Arbeitsplattform vollständig, rutschhemmend und tragfähig?",                   norm:"DIN EN 131-7", critical:true  },
    { id:"q_podest_gelaender",section:"Geländer",           text:"Ist das Sicherheitsgeländer vorhanden, vollständig und stabil?",                       norm:"DIN EN 131-7", critical:true  },
    { id:"q_podest_rollen",   section:"Rollen",             text:"Funktionieren die Rollen und deren Arretierung einwandfrei (falls vorhanden)?",        norm:"DIN EN 131-7", critical:false },
  ],
};
function getQuestionsForType(typeId) {
  return [...BASE_QUESTIONS, ...(TYPE_SPECIFIC[typeId] || [])];
}

// ─── PDF Generierung (echtes DIN A4 PDF) ───
function buildPDF(inspection, ladder) {
  const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
  const W = 210, M = 12, cW = W - M * 2;
  let y = M;

  const questions = getQuestionsForType(ladder.type);
  const pass = inspection.result === "bestanden";
  const dateStr = new Date(inspection.date).toLocaleDateString("de-DE");
  const nextStr = new Date(inspection.nextDate).toLocaleDateString("de-DE");

  // ── Header ──
  doc.setFillColor(227, 6, 19);
  doc.rect(M, y, cW, 18, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12); doc.setFont("helvetica", "bold");
  doc.text("PRÜFPROTOKOLL — Leiterprüfung", M + 3, y + 7);
  doc.setFontSize(7); doc.setFont("helvetica", "normal");
  doc.text("Sicht- und Funktionsprüfung gem. DGUV 208-016 / BetrSichV §14 / DIN EN 131", M + 3, y + 12);
  doc.text("Nr.: " + inspection.id + "  ·  Erstellt: " + dateStr, M + 3, y + 16.5);
  y += 21;

  // ── Zwei Info-Boxen ──
  const bW = (cW - 3) / 2, bH = 33;
  const drawBox = (bx, title, rows) => {
    doc.setFillColor(249, 249, 249); doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.3);
    doc.rect(bx, y, bW, bH, "FD");
    doc.setFillColor(227, 6, 19); doc.rect(bx, y, bW, 5, "F");
    doc.setTextColor(255, 255, 255); doc.setFontSize(6.5); doc.setFont("helvetica", "bold");
    doc.text(title, bx + 2, y + 3.5);
    doc.setTextColor(40, 40, 40); let ry = y + 9;
    rows.forEach(([lbl, val]) => {
      doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text(lbl + ":", bx + 2, ry);
      doc.setFont("helvetica", "normal");
      doc.text((val || "—").substring(0, 32), bx + 24, ry);
      ry += 5;
    });
  };
  drawBox(M, "GEPRÜFTES ARBEITSMITTEL", [
    ["Inventar-Nr.", ladder.inventoryNr],
    ["Bezeichnung", ladder.name],
    ["Typ", LADDER_TYPES.find(t => t.id === ladder.type)?.label || ladder.type],
    ["Standort", ladder.location || "—"],
    ["Material", (ladder.material || "—") + (ladder.year ? " / Bj. " + ladder.year : "")],
  ]);
  drawBox(M + bW + 3, "PRÜFUNG", [
    ["Prüfdatum", dateStr],
    ["Prüfer", inspection.inspector || "—"],
    ["Nächste Prüfung", nextStr],
    ["Hersteller", ladder.manufacturer || "—"],
    ["Max. Belastung", ladder.maxLoad ? ladder.maxLoad + " kg" : "—"],
  ]);
  y += bH + 3;

  // ── Ergebnis-Banner ──
  if (pass) { doc.setFillColor(212, 237, 218); doc.setDrawColor(45, 106, 79); }
  else       { doc.setFillColor(248, 215, 218); doc.setDrawColor(193, 18, 31); }
  doc.setLineWidth(0.6); doc.rect(M, y, cW, 8, "FD");
  doc.setTextColor(pass ? 21 : 114, pass ? 87 : 28, pass ? 36 : 36);
  doc.setFontSize(9); doc.setFont("helvetica", "bold");
  doc.text(
    pass ? "✓  BESTANDEN — Leiter darf weiter verwendet werden"
         : "✗  NICHT BESTANDEN — Leiter gesperrt / Mängel beheben",
    W / 2, y + 5.5, { align: "center" }
  );
  y += 11;

  // ── Prüffragen-Tabelle ──
  const sectionMap = {};
  questions.forEach(q => { (sectionMap[q.section] = sectionMap[q.section] || []).push(q); });

  const body = [];
  Object.entries(sectionMap).forEach(([sec, qs]) => {
    body.push([{
      content: sec, colSpan: 4,
      styles: { fillColor:[227,6,19], textColor:[255,255,255], fontStyle:"bold", fontSize:6.5, cellPadding:2 }
    }]);
    qs.forEach(q => {
      const a = inspection.answers?.[q.id];
      const st = a==="ok"?"i.O.":a==="mangel"?"Mangel":a==="na"?"n.a.":"—";
      const sc = a==="ok"?[45,106,79]:a==="mangel"?[193,18,31]:[100,100,100];
      body.push([
        { content:(q.critical?"⚠ ":"")+q.text, styles:{fontSize:7} },
        { content:q.norm, styles:{fontSize:6, textColor:[130,130,130]} },
        { content:st, styles:{fontSize:7.5, fontStyle:"bold", textColor:sc, halign:"center"} },
        { content:inspection.notes?.[q.id]||"", styles:{fontSize:7} },
      ]);
    });
  });

  autoTable(doc, {
    startY: y,
    head: [[
      { content:"Prüfpunkt",  styles:{fillColor:[50,50,50],textColor:[255,255,255],fontSize:6.5,fontStyle:"bold"} },
      { content:"Norm",       styles:{fillColor:[50,50,50],textColor:[255,255,255],fontSize:6.5,fontStyle:"bold"} },
      { content:"Ergebnis",   styles:{fillColor:[50,50,50],textColor:[255,255,255],fontSize:6.5,fontStyle:"bold",halign:"center"} },
      { content:"Anmerkung",  styles:{fillColor:[50,50,50],textColor:[255,255,255],fontSize:6.5,fontStyle:"bold"} },
    ]],
    body,
    margin: { left:M, right:M },
    tableWidth: cW,
    columnStyles: {
      0: { cellWidth: cW * 0.50 },
      1: { cellWidth: cW * 0.15 },
      2: { cellWidth: cW * 0.10, halign:"center" },
      3: { cellWidth: cW * 0.25 },
    },
    styles: { cellPadding:1.8, lineColor:[225,225,225], lineWidth:0.2, fontSize:7, overflow:"linebreak" },
    rowPageBreak: "avoid",
  });

  y = doc.lastAutoTable.finalY + 3;

  // ── Allgemeine Bemerkungen ──
  if (inspection.generalNotes) {
    doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(50, 50, 50);
    doc.text("Allgemeine Bemerkungen:", M, y + 4);
    y += 6;
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(inspection.generalNotes, cW);
    doc.text(lines, M, y);
    y += lines.length * 4 + 2;
  }

  // ── Unterschrift ──
  if (inspection.signature) {
    doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.3);
    doc.line(M, y, M + cW, y); y += 2;
    doc.setFontSize(6.5); doc.setFont("helvetica", "bold"); doc.setTextColor(100, 100, 100);
    doc.text("UNTERSCHRIFT PRÜFER/IN", M, y + 4);
    try {
      doc.addImage(inspection.signature, "PNG", M, y + 5, 55, 16);
    } catch {}
    doc.setFont("helvetica", "normal");
    doc.text((inspection.inspector || "—") + " · " + dateStr, M, y + 24);
    y += 28;
  }

  // ── Footer ──
  const footY = 297 - 8;
  doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.2);
  doc.line(M, footY - 4, M + cW, footY - 4);
  doc.setFontSize(5.5); doc.setTextColor(160, 160, 160); doc.setFont("helvetica", "normal");
  doc.text(
    "Rechtsgrundlagen: ArbSchG, BetrSichV §3/§14, TRBS 1201, TRBS 2121-2, DGUV I 208-016, DIN EN 131-1 bis -4, DIN EN 14183, TRBS 1203",
    M, footY
  );

  return doc;
}

function downloadPDF(inspection, ladder) {
  const doc = buildPDF(inspection, ladder);
  const fn = `Pruefprotokoll_${ladder.inventoryNr}_${new Date(inspection.date).toISOString().slice(0,10)}.pdf`;
  doc.save(fn);
}

// Gibt Base64-String zurück (für E-Mail-Anhang)
function getPDFBase64(inspection, ladder) {
  return buildPDF(inspection, ladder).output("datauristring").split(",")[1];
}

// E-Mail mit PDF-Anhang via SMTP
async function sendEmailAPI(inspection, ladder, emailTo, smtp) {
  const pdfBase64 = getPDFBase64(inspection, ladder);
  const fn = `Pruefprotokoll_${ladder.inventoryNr}_${new Date(inspection.date).toISOString().slice(0,10)}.pdf`;
  const pass = inspection.result === "bestanden";

  const bodyHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#E30613;color:#fff;padding:20px;border-radius:6px 6px 0 0;">
    <h2 style="margin:0;font-size:18px;">✚ DRK Leiterprüfung — Prüfprotokoll</h2>
  </div>
  <div style="padding:20px;background:#f9f9f9;border:1px solid #ddd;border-top:none;border-radius:0 0 6px 6px;">
    <p style="margin:0 0 16px;font-size:15px;">Das Prüfprotokoll für <strong>${ladder.inventoryNr} — ${ladder.name}</strong> ist als PDF-Anhang beigefügt.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 10px;font-weight:bold;background:#fff;border:1px solid #eee;">Leiter</td><td style="padding:6px 10px;background:#fff;border:1px solid #eee;">${ladder.inventoryNr} — ${ladder.name}</td></tr>
      <tr><td style="padding:6px 10px;font-weight:bold;background:#f5f5f5;border:1px solid #eee;">Standort</td><td style="padding:6px 10px;background:#f5f5f5;border:1px solid #eee;">${ladder.location || "—"}</td></tr>
      <tr><td style="padding:6px 10px;font-weight:bold;background:#fff;border:1px solid #eee;">Prüfdatum</td><td style="padding:6px 10px;background:#fff;border:1px solid #eee;">${new Date(inspection.date).toLocaleDateString("de-DE")}</td></tr>
      <tr><td style="padding:6px 10px;font-weight:bold;background:#f5f5f5;border:1px solid #eee;">Prüfer</td><td style="padding:6px 10px;background:#f5f5f5;border:1px solid #eee;">${inspection.inspector || "—"}</td></tr>
      <tr><td style="padding:6px 10px;font-weight:bold;background:#fff;border:1px solid #eee;">Ergebnis</td><td style="padding:6px 10px;background:#fff;border:1px solid #eee;color:${pass?"#2d6a4f":"#c1121f"};font-weight:bold;">${pass?"✓ BESTANDEN":"✗ NICHT BESTANDEN"}</td></tr>
      <tr><td style="padding:6px 10px;font-weight:bold;background:#f5f5f5;border:1px solid #eee;">Nächste Prüfung</td><td style="padding:6px 10px;background:#f5f5f5;border:1px solid #eee;">${new Date(inspection.nextDate).toLocaleDateString("de-DE")}</td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:12px;color:#888;">Das vollständige Prüfprotokoll finden Sie im PDF-Anhang.</p>
  </div>
</div>`;

  const resp = await fetch("/api/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: emailTo, subject: `Prüfprotokoll ${ladder.inventoryNr} – ${new Date(inspection.date).toLocaleDateString("de-DE")}`, bodyHtml, pdfBase64, pdfFilename: fn, smtp }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return true;
}

// mailto-Fallback
function sendEmailMailto(inspection, ladder, emailTo) {
  const subject = encodeURIComponent(`Prüfprotokoll ${ladder.inventoryNr} – ${new Date(inspection.date).toLocaleDateString("de-DE")}`);
  const body = encodeURIComponent(`Prüfprotokoll: ${ladder.inventoryNr} — ${ladder.name}\nDatum: ${new Date(inspection.date).toLocaleDateString("de-DE")}\nPrüfer: ${inspection.inspector||"—"}\nErgebnis: ${inspection.result==="bestanden"?"BESTANDEN":"NICHT BESTANDEN"}`);
  window.location.href = `mailto:${emailTo}?subject=${subject}&body=${body}`;
}

// ─── App ───
const VIEWS = { DASHBOARD:0, LADDERS:1, INSPECTION:2, HISTORY:3, SETTINGS:4 };
const EMPTY_SETTINGS = {
  inspector: "", company: "BRK Bereitschaft Großheubach", interval: 12, email: "",
  smtp: { host:"", port:"587", user:"", pass:"", secure:false },
};

export default function App() {
  const [view, setView]               = useState(VIEWS.DASHBOARD);
  const [ladders, setLadders]         = useState([]);
  const [inspections, setInspections] = useState([]);
  const [locations, setLocations]     = useState([]);
  const [settings, setSettings]       = useState(EMPTY_SETTINGS);
  const [loading, setLoading]         = useState(true);
  const [selectedLadder, setSelectedLadder]   = useState(null);
  const [inspectionState, setInspectionState] = useState(null);
  const [menuOpen, setMenuOpen]       = useState(false);
  const [toast, setToast]             = useState(null);
  const [highlightedInspId, setHighlightedInspId] = useState(null);

  const showToast = (msg, type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),2800); };

  useEffect(() => {
    (async () => {
      const server = await loadAllFromServer();
      const get = (key, fallback) => {
        if (server && server[key] != null) return server[key];
        return lsRead(key, fallback);
      };
      const ladrs = get(LADDERS_KEY, []);
      const insps = get(INSPECTIONS_KEY, []);
      const locs  = get(LOCATIONS_KEY, []);
      const sett  = get(PRUEFER_KEY, EMPTY_SETTINGS);
      // Erstmalig localStorage → Server hochladen falls Server leer
      if (server) {
        if (!server[LADDERS_KEY] && ladrs.length)  saveData(LADDERS_KEY, ladrs);
        if (!server[INSPECTIONS_KEY] && insps.length) saveData(INSPECTIONS_KEY, insps);
        if (!server[LOCATIONS_KEY] && locs.length) saveData(LOCATIONS_KEY, locs);
        if (!server[PRUEFER_KEY] && sett.inspector) saveData(PRUEFER_KEY, sett);
      }
      setLadders(ladrs);
      setInspections(insps);
      setLocations(locs);
      setSettings({ ...EMPTY_SETTINGS, ...sett, smtp:{...EMPTY_SETTINGS.smtp,...(sett.smtp||{})} });
      setLoading(false);
    })();
  }, []);

  const saveLadders    = l => { setLadders(l);    saveData(LADDERS_KEY,    l); };
  const saveInspections= i => { setInspections(i);saveData(INSPECTIONS_KEY,i); };
  const saveLocations  = l => { setLocations(l);  saveData(LOCATIONS_KEY,  l); };
  const saveSettings   = s => { setSettings(s);   saveData(PRUEFER_KEY,    s); };

  const getLastInspection = id => inspections.filter(i=>i.ladderId===id).sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
  const getNextDue = id => { const l=getLastInspection(id); return l?new Date(l.nextDate):null; };
  const isOverdue  = id => { const n=getNextDue(id); return n&&n<new Date(); };

  const activeLadders = ladders.filter(l=>!l.retired);
  const stats = {
    total:   activeLadders.length,
    overdue: activeLadders.filter(l=>isOverdue(l.id)).length,
    ok:      activeLadders.filter(l=>{ const li=getLastInspection(l.id); return li&&li.result==="bestanden"&&!isOverdue(l.id); }).length,
    never:   activeLadders.filter(l=>!getLastInspection(l.id)).length,
  };

  if (loading) return (
    <div style={S.loadScreen}>
      <div style={{fontSize:64,marginBottom:16}}>✚</div>
      <div style={{fontSize:16,letterSpacing:1}}>Leiterprüfung wird geladen…</div>
    </div>
  );

  const navItems = [
    { v:VIEWS.DASHBOARD, icon:"◉", label:"Home"     },
    { v:VIEWS.LADDERS,   icon:"⊼", label:"Leitern"  },
    { v:VIEWS.INSPECTION,icon:"☑", label:"Prüfung"  },
    { v:VIEWS.HISTORY,   icon:"⏱", label:"Historie" },
    { v:VIEWS.SETTINGS,  icon:"⚙", label:"Mehr"     },
  ];

  return (
    <div style={S.shell}>
      {toast && <div style={{...S.toast,background:toast.type==="success"?"#2d6a4f":"#c1121f"}}>{toast.msg}</div>}

      <header style={S.header}>
        <div style={S.headerLeft}>
          <div style={S.logo}>✚</div>
          <div>
            <div style={S.headerTitle}>DRK Leiterprüfung</div>
            <div style={S.headerSub}>DGUV 208-016 · BetrSichV · DIN EN 131</div>
          </div>
        </div>
        <button style={S.menuBtn} onClick={()=>setMenuOpen(!menuOpen)}>{menuOpen?"✕":"☰"}</button>
      </header>

      {menuOpen && <div style={S.overlay} onClick={()=>setMenuOpen(false)} />}
      <nav style={{...S.mobileNav,transform:menuOpen?"translateX(0)":"translateX(-100%)"}}>
        {navItems.map(n=>(
          <button key={n.v} style={{...S.navItem,...(view===n.v?S.navItemActive:{})}}
            onClick={()=>{setView(n.v);setMenuOpen(false);}}>
            <span style={S.navIcon}>{n.icon}</span>
            {n.label==="Home"?"Dashboard":n.label==="Leitern"?"Leiterdatenbank":n.label==="Prüfung"?"Neue Prüfung":n.label==="Historie"?"Prüfhistorie":"Einstellungen"}
          </button>
        ))}
      </nav>

      <nav style={S.tabBar}>
        {navItems.map(n=>(
          <button key={n.v} style={{...S.tabItem,...(view===n.v?S.tabItemActive:{})}} onClick={()=>setView(n.v)}>
            <span style={{fontSize:22}}>{n.icon}</span>
            <span style={{fontSize:11,marginTop:2}}>{n.label}</span>
          </button>
        ))}
      </nav>

      <main style={S.main}>
        {view===VIEWS.DASHBOARD  && <DashboardView stats={stats} ladders={activeLadders} inspections={inspections} locations={locations} getLastInspection={getLastInspection} isOverdue={isOverdue} getNextDue={getNextDue} onStartInspection={l=>{setSelectedLadder(l);setView(VIEWS.INSPECTION);}} setView={setView} onInspectionClick={insp=>{setHighlightedInspId(insp.id);setView(VIEWS.HISTORY);}} />}
        {view===VIEWS.LADDERS    && <LaddersView ladders={ladders} saveLadders={saveLadders} locations={locations} inspections={inspections} getLastInspection={getLastInspection} isOverdue={isOverdue} showToast={showToast} settings={settings} />}
        {view===VIEWS.INSPECTION && <InspectionView ladders={activeLadders} selectedLadder={selectedLadder} setSelectedLadder={setSelectedLadder} inspectionState={inspectionState} setInspectionState={setInspectionState} inspections={inspections} saveInspections={saveInspections} settings={settings} showToast={showToast} setView={setView} />}
        {view===VIEWS.HISTORY    && <HistoryView inspections={inspections} ladders={ladders} saveInspections={saveInspections} showToast={showToast} settings={settings} highlightedId={highlightedInspId} clearHighlight={()=>setHighlightedInspId(null)} />}
        {view===VIEWS.SETTINGS   && <SettingsView settings={settings} saveSettings={saveSettings} locations={locations} saveLocations={saveLocations} ladders={ladders} saveLadders={saveLadders} showToast={showToast} />}
      </main>
    </div>
  );
}

// ─── Dashboard ───
function DashboardView({ stats, ladders, inspections, locations, getLastInspection, isOverdue, getNextDue, onStartInspection, setView, onInspectionClick }) {
  const [locFilter, setLocFilter] = useState("");
  const [filterPanel, setFilterPanel] = useState(null);

  const filtered = locFilter ? ladders.filter(l=>l.location===locFilter) : ladders;
  const overdueLadders = filtered.filter(l=>isOverdue(l.id));
  const neverLadders   = filtered.filter(l=>!getLastInspection(l.id));
  const upcoming = filtered.filter(l=>{const n=getNextDue(l.id);return n&&n>=new Date();})
    .sort((a,b)=>getNextDue(a.id)-getNextDue(b.id)).slice(0,5);
  const recent = [...inspections].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,3);

  const toggle = key => setFilterPanel(p=>p===key?null:key);
  const panelItems = filterPanel==="overdue" ? overdueLadders : filterPanel==="never" ? neverLadders : [];

  return (
    <div style={S.page}>
      <h2 style={S.pageTitle}>Dashboard</h2>

      <div style={S.quickActions}>
        {[
          {icon:"☑",label:"Neue Prüfung",  action:()=>setView(VIEWS.INSPECTION)},
          {icon:"+",label:"Leiter erfassen",action:()=>setView(VIEWS.LADDERS)},
          {icon:"⏱",label:"Prüfhistorie",  action:()=>setView(VIEWS.HISTORY)},
          {icon:"⚙",label:"Einstellungen", action:()=>setView(VIEWS.SETTINGS)},
        ].map(b=>(
          <button key={b.label} style={S.quickActionBtn} onClick={b.action}>
            <span style={S.qaIcon}>{b.icon}</span>
            <span style={S.qaLabel}>{b.label}</span>
          </button>
        ))}
      </div>

      {locations.length>0 && (
        <select style={{...S.select,marginBottom:16}} value={locFilter}
          onChange={e=>{setLocFilter(e.target.value);setFilterPanel(null);}}>
          <option value="">Alle Standorte</option>
          {locations.map(l=><option key={l} value={l}>{l}</option>)}
        </select>
      )}

      <div style={S.statGrid}>
        <div style={{...S.statCard,borderLeft:"4px solid #E30613",cursor:"pointer"}} onClick={()=>setView(VIEWS.LADDERS)}>
          <div style={S.statNum}>{stats.total}</div><div style={S.statLabel}>Leitern gesamt</div>
        </div>
        <div style={{...S.statCard,borderLeft:"4px solid #2d6a4f",cursor:"pointer"}} onClick={()=>setView(VIEWS.HISTORY)}>
          <div style={{...S.statNum,color:"#2d6a4f"}}>{stats.ok}</div><div style={S.statLabel}>Geprüft & i.O.</div>
        </div>
        <div style={{...S.statCard,borderLeft:"4px solid #c1121f",cursor:"pointer",outline:filterPanel==="overdue"?"2px solid #c1121f":"none",outlineOffset:2}}
          onClick={()=>toggle("overdue")}>
          <div style={{...S.statNum,color:"#c1121f"}}>{overdueLadders.length}</div>
          <div style={S.statLabel}>Überfällig {filterPanel==="overdue"?"▲":""}</div>
        </div>
        <div style={{...S.statCard,borderLeft:"4px solid #e09f3e",cursor:"pointer",outline:filterPanel==="never"?"2px solid #e09f3e":"none",outlineOffset:2}}
          onClick={()=>toggle("never")}>
          <div style={{...S.statNum,color:"#e09f3e"}}>{neverLadders.length}</div>
          <div style={S.statLabel}>Nie geprüft {filterPanel==="never"?"▲":""}</div>
        </div>
      </div>

      {filterPanel && (
        <div style={{background:"#fff",border:`1px solid ${filterPanel==="overdue"?"#f5c6cb":"#fde8b8"}`,borderRadius:12,padding:16,marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <h3 style={{margin:0,fontSize:15,fontWeight:700,color:filterPanel==="overdue"?"#c1121f":"#b45309"}}>
              {filterPanel==="overdue"?`⚠ Überfällig (${overdueLadders.length})`:`⊙ Nie geprüft (${neverLadders.length})`}
            </h3>
            <button style={{...S.iconBtn}} onClick={()=>setFilterPanel(null)}>✕</button>
          </div>
          {panelItems.length===0
            ? <div style={{fontSize:14,color:"#888"}}>Keine Leitern in dieser Kategorie.</div>
            : panelItems.map(l=>(
              <div key={l.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0",borderTop:"1px solid #eee"}}>
                <div>
                  <span style={{fontWeight:700,color:filterPanel==="overdue"?"#c1121f":"#b45309",fontSize:15}}>{l.inventoryNr}</span>
                  {" — "}<span style={{fontSize:15}}>{l.name}</span>
                  <span style={S.locTag}>{l.location||"—"}</span>
                  {filterPanel==="overdue"&&<div style={{fontSize:13,color:"#666",marginTop:2}}>Überfällig seit {getNextDue(l.id)?.toLocaleDateString("de-DE")}</div>}
                </div>
                <button style={S.alertBtn} onClick={()=>onStartInspection(l)}>Jetzt prüfen</button>
              </div>
            ))
          }
        </div>
      )}

      {upcoming.length>0 && (
        <div style={S.section}>
          <h3 style={S.sectionTitle}>Nächste Prüfungen</h3>
          {upcoming.map(l=>{
            const nd=getNextDue(l.id);
            const days=Math.ceil((nd-new Date())/86400000);
            return (
              <div key={l.id} style={{...S.listRow,cursor:"pointer"}} onClick={()=>onStartInspection(l)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontSize:15}}><strong>{l.inventoryNr}</strong> — {l.name}<span style={S.locTag}>{l.location||"—"}</span></div>
                  <div style={{fontSize:13,color:days<30?"#e09f3e":"#666",flexShrink:0}}>{nd.toLocaleDateString("de-DE")} ({days}d)</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {recent.length>0 && (
        <div style={S.section}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <h3 style={{...S.sectionTitle,margin:0}}>Letzte Prüfungen</h3>
            <button style={S.linkBtn} onClick={()=>setView(VIEWS.HISTORY)}>Alle →</button>
          </div>
          {recent.map(insp=>{
            const lad=ladders.find(l=>l.id===insp.ladderId);
            const pass=insp.result==="bestanden";
            return (
              <div key={insp.id} style={{...S.listRow,borderLeft:`3px solid ${pass?"#2d6a4f":"#c1121f"}`,cursor:"pointer"}}
                onClick={()=>onInspectionClick(insp)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <span style={{fontWeight:700,fontSize:15}}>{lad?.inventoryNr||"?"}</span>{" — "}{lad?.name||"gelöscht"}
                    <span style={S.locTag}>{lad?.location||""}</span>
                    <div style={{fontSize:13,color:"#888",marginTop:3}}>{new Date(insp.date).toLocaleDateString("de-DE")} · {insp.inspector}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                    <span style={{fontSize:13,fontWeight:700,color:pass?"#2d6a4f":"#c1121f"}}>{pass?"✓ Best.":"✗ Nicht best."}</span>
                    <span style={{color:"#bbb"}}>›</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {ladders.length===0 && (
        <div style={S.emptyState}>
          <div style={{fontSize:52,marginBottom:12}}>✚</div>
          <div style={{fontWeight:700,fontSize:17,marginBottom:6}}>Noch keine Leitern erfasst</div>
          <div style={{fontSize:14,color:"#888",marginBottom:20}}>Starte mit der Leiterdatenbank.</div>
          <button style={{...S.primaryBtn,maxWidth:280,margin:"0 auto"}} onClick={()=>setView(VIEWS.LADDERS)}>+ Erste Leiter erfassen</button>
        </div>
      )}
    </div>
  );
}

// ─── Leiterdatenbank ───
function LaddersView({ ladders, saveLadders, locations, inspections, getLastInspection, isOverdue, showToast, settings }) {
  const [search, setSearch]         = useState("");
  const [form, setForm]             = useState(null);
  const [detailLadder, setDetailLadder] = useState(null);
  const [showRetired, setShowRetired]   = useState(false);

  const activeLadders  = ladders.filter(l=>!l.retired);
  const retiredLadders = ladders.filter(l=>l.retired);
  const filtered = (showRetired?retiredLadders:activeLadders).filter(l=>
    `${l.inventoryNr} ${l.name} ${l.location} ${l.manufacturer}`.toLowerCase().includes(search.toLowerCase())
  );

  const handlePhoto = e => {
    const f=e.target.files[0]; if(!f) return;
    if(f.size>2*1024*1024){showToast("Foto max. 2 MB","error");return;}
    const r=new FileReader(); r.onload=ev=>setForm(f=>({...f,photo:ev.target.result})); r.readAsDataURL(f);
  };

  const handleSave = () => {
    if(!form.inventoryNr||!form.name){showToast("Inventar-Nr. und Bezeichnung sind Pflicht!","error");return;}
    if(!form.location&&locations.length>0){showToast("Bitte einen Standort auswählen!","error");return;}
    const isNew=!form.id;
    const entry=isNew?{...form,id:"L"+Date.now(),retired:false}:form;
    saveLadders(isNew?[...ladders,entry]:ladders.map(l=>l.id===entry.id?entry:l));
    setForm(null); showToast(isNew?"Leiter hinzugefügt":"Leiter aktualisiert");
  };

  const handleDelete = id => {
    if(!confirm("Leiter wirklich löschen?")) return;
    saveLadders(ladders.filter(l=>l.id!==id)); setDetailLadder(null); showToast("Leiter gelöscht");
  };

  const handleRetire = l => {
    const retiring=!l.retired;
    if(retiring&&!confirm(`Leiter ${l.inventoryNr} ausmustern?`)) return;
    const upd=ladders.map(x=>x.id===l.id?{...x,retired:retiring}:x);
    saveLadders(upd); setDetailLadder(upd.find(x=>x.id===l.id));
    showToast(retiring?"Leiter ausgemustert":"Leiter reaktiviert");
  };

  const emptyForm={id:"",inventoryNr:"",name:"",type:"stehleiter",manufacturer:"",material:"Aluminium",year:"",location:"",maxLoad:"",length:"",notes:"",photo:"",retired:false};

  if (form) return (
    <div style={S.page}>
      <div style={S.formHeader}>
        <button style={S.backBtn} onClick={()=>setForm(null)}>← Zurück</button>
        <h2 style={S.pageTitle}>{form.id?"Leiter bearbeiten":"Neue Leiter"}</h2>
      </div>
      <div style={S.formGrid}>
        <Field label="Inventar-Nr. *" value={form.inventoryNr} onChange={v=>setForm(f=>({...f,inventoryNr:v}))} placeholder="z.B. L-001" />
        <Field label="Bezeichnung *"  value={form.name}        onChange={v=>setForm(f=>({...f,name:v}))}        placeholder="z.B. Alu-Stehleiter" />
        <div style={S.fieldWrap}>
          <label style={S.fieldLabel}>Leitertyp</label>
          <select style={S.select} value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
            {LADDER_TYPES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div style={S.fieldWrap}>
          <label style={S.fieldLabel}>Material</label>
          <select style={S.select} value={form.material} onChange={e=>setForm(f=>({...f,material:e.target.value}))}>
            {MATERIALS.map(m=><option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <Field label="Hersteller"     value={form.manufacturer} onChange={v=>setForm(f=>({...f,manufacturer:v}))} placeholder="z.B. ZARGES" />
        <Field label="Baujahr"        value={form.year}         onChange={v=>setForm(f=>({...f,year:v}))}         placeholder="z.B. 2020" />
        <Field label="Max. Last (kg)" value={form.maxLoad}      onChange={v=>setForm(f=>({...f,maxLoad:v}))}      placeholder="z.B. 150" />
        <Field label="Länge / Höhe"   value={form.length}       onChange={v=>setForm(f=>({...f,length:v}))}       placeholder="z.B. 2,40m" />
      </div>
      <div style={S.fieldWrap}>
        <label style={S.fieldLabel}>Standort *</label>
        {locations.length>0
          ? <select style={S.select} value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))}>
              <option value="">— Standort wählen —</option>
              {form.location&&!locations.includes(form.location)&&<option value={form.location}>{form.location}</option>}
              {locations.map(loc=><option key={loc} value={loc}>{loc}</option>)}
            </select>
          : <div style={S.hintBox}>Bitte zuerst unter <strong>Mehr → Standorte</strong> Standorte anlegen.</div>
        }
      </div>
      <div style={S.fieldWrap}>
        <label style={S.fieldLabel}>Bemerkungen</label>
        <textarea style={S.textarea} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={3} placeholder="Besonderheiten, Zubehör…" />
      </div>
      <div style={S.fieldWrap}>
        <label style={S.fieldLabel}>Foto</label>
        {form.photo&&(
          <div style={{position:"relative",marginBottom:10}}>
            <img src={form.photo} alt="" style={{width:"100%",maxHeight:220,objectFit:"contain",borderRadius:10,border:"1px solid #ddd"}} />
            <button style={{position:"absolute",top:6,right:6,background:"#c1121f",color:"#fff",border:"none",borderRadius:20,width:30,height:30,cursor:"pointer",fontSize:14,fontWeight:700}} onClick={()=>setForm(f=>({...f,photo:""}))}>✕</button>
          </div>
        )}
        <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{fontSize:14,width:"100%",padding:"8px 0"}} />
      </div>
      <button style={S.primaryBtn} onClick={handleSave}>💾 Speichern</button>
    </div>
  );

  if (detailLadder) {
    const lad = ladders.find(l=>l.id===detailLadder.id)||detailLadder;
    const ladInsp = inspections.filter(i=>i.ladderId===lad.id).sort((a,b)=>new Date(b.date)-new Date(a.date));
    const typeObj = LADDER_TYPES.find(t=>t.id===lad.type);
    const smtpOk = !!(settings.smtp?.host&&settings.smtp?.user&&settings.smtp?.pass&&settings.email);
    return (
      <div style={S.page}>
        <div style={S.formHeader}>
          <button style={S.backBtn} onClick={()=>setDetailLadder(null)}>← Zurück</button>
          <h2 style={S.pageTitle}>{lad.inventoryNr}</h2>
        </div>
        {lad.retired&&<div style={S.retiredBanner}>⚠ Ausgemustert — nicht mehr im Prüfzyklus</div>}
        <div style={{display:"flex",gap:14,marginBottom:18}}>
          {lad.photo&&<img src={lad.photo} alt="" style={{width:96,height:96,objectFit:"cover",borderRadius:12,border:"1px solid #ddd",flexShrink:0}} />}
          <div style={{flex:1}}>
            <div style={{fontSize:17,fontWeight:700,marginBottom:5}}>{lad.name}</div>
            <div style={{fontSize:14,color:"#666",lineHeight:1.8}}>
              {typeObj?.label} · {lad.material}<br/>
              Standort: <strong>{lad.location||"—"}</strong><br/>
              {lad.manufacturer&&`Hersteller: ${lad.manufacturer}`}{lad.year&&` · Bj. ${lad.year}`}<br/>
              {lad.maxLoad&&`Max. ${lad.maxLoad} kg`}{lad.length&&` · ${lad.length}`}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:22}}>
          <button style={S.actionBtn} onClick={()=>{setForm({...lad});setDetailLadder(null);}}>✏ Bearbeiten</button>
          <button style={{...S.actionBtn,color:lad.retired?"#2d6a4f":"#e09f3e",borderColor:lad.retired?"#2d6a4f":"#e09f3e"}} onClick={()=>handleRetire(lad)}>
            {lad.retired?"✓ Reaktivieren":"⊘ Ausmustern"}
          </button>
          <button style={{...S.actionBtn,color:"#c1121f",borderColor:"#c1121f"}} onClick={()=>handleDelete(lad.id)}>🗑 Löschen</button>
        </div>
        <h3 style={S.sectionTitle}>Prüfhistorie ({ladInsp.length})</h3>
        {ladInsp.length===0
          ? <div style={{fontSize:14,color:"#888",padding:"14px 0"}}>Noch keine Prüfungen.</div>
          : ladInsp.map(insp=>{
              const pass=insp.result==="bestanden";
              return (
                <div key={insp.id} style={{...S.historyCard,borderLeft:`4px solid ${pass?"#2d6a4f":"#c1121f"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:16}}>{new Date(insp.date).toLocaleDateString("de-DE")}</div>
                      <div style={{fontSize:13,color:"#666",marginTop:3}}>Prüfer: {insp.inspector} · {insp.id}</div>
                      <div style={{fontSize:13,color:"#888"}}>Nächste Prüfung: {new Date(insp.nextDate).toLocaleDateString("de-DE")}</div>
                    </div>
                    <div style={{...S.statusBadge,background:pass?"#d4edda":"#f8d7da",color:pass?"#2d6a4f":"#c1121f"}}>{pass?"Bestanden":"Nicht best."}</div>
                  </div>
                  <div style={{display:"flex",gap:10,marginTop:12,flexWrap:"wrap"}}>
                    <button style={S.actionBtn} onClick={()=>downloadPDF(insp,lad)}>📄 PDF</button>
                    {smtpOk&&<button style={S.actionBtn} onClick={()=>sendEmailAPI(insp,lad,settings.email,settings.smtp).then(()=>showToast("E-Mail gesendet")).catch(e=>showToast("Fehler: "+e.message,"error"))}>✉ E-Mail</button>}
                    {settings.email&&!smtpOk&&<button style={S.actionBtn} onClick={()=>sendEmailMailto(insp,lad,settings.email)}>✉ E-Mail</button>}
                  </div>
                </div>
              );
            })
        }
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:4}}>
        <h2 style={{...S.pageTitle,marginBottom:0}}>Leiterdatenbank ({activeLadders.length})</h2>
        <button style={{...S.primaryBtn,width:"auto",marginTop:0,padding:"12px 20px"}} onClick={()=>setForm({...emptyForm})}>+ Neue Leiter</button>
      </div>
      <input style={S.searchInput} placeholder="🔍 Suche nach Nr., Name, Standort…" value={search} onChange={e=>setSearch(e.target.value)} />
      {retiredLadders.length>0&&(
        <button style={{...S.linkBtn,marginBottom:14,display:"block"}} onClick={()=>setShowRetired(!showRetired)}>
          {showRetired?"← Aktive Leitern anzeigen":`Ausgemusterte Leitern (${retiredLadders.length})`}
        </button>
      )}
      {filtered.length===0&&<div style={S.emptyState}><div style={{fontSize:40}}>📋</div><div style={{fontSize:15}}>Keine Leitern gefunden</div></div>}
      {filtered.map(l=>{
        const li=getLastInspection(l.id); const od=isOverdue(l.id);
        const typeObj=LADDER_TYPES.find(t=>t.id===l.type);
        return (
          <div key={l.id} style={{...S.ladderCard,borderLeft:`4px solid ${l.retired?"#aaa":od?"#c1121f":li?"#2d6a4f":"#e09f3e"}`,opacity:l.retired?0.7:1,cursor:"pointer"}}
            onClick={()=>setDetailLadder(l)}>
            <div style={S.ladderTop}>
              <div style={{flex:1}}>
                <div style={S.ladderNr}>{l.inventoryNr}</div>
                <div style={S.ladderName}>{l.name}</div>
                <div style={S.ladderMeta}>{typeObj?.label} · {l.material} · {l.location||"—"}</div>
              </div>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                {l.photo&&<img src={l.photo} alt="" style={{width:52,height:52,objectFit:"cover",borderRadius:8,border:"1px solid #ddd",flexShrink:0}} />}
                <div style={{...S.statusBadge,background:l.retired?"#eee":od?"#fce4e4":li?"#d4edda":"#fff3cd",color:l.retired?"#666":od?"#c1121f":li?"#2d6a4f":"#856404"}}>
                  {l.retired?"Ausgemustert":od?"Überfällig":li?"Geprüft":"Offen"}
                </div>
              </div>
            </div>
            {li&&<div style={S.ladderLastCheck}>Letzte Prüfung: {new Date(li.date).toLocaleDateString("de-DE")} — {li.result==="bestanden"?"✓ Bestanden":"✗ Nicht bestanden"}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ─── Prüfung ───
function InspectionView({ ladders, selectedLadder, setSelectedLadder, inspectionState, setInspectionState, inspections, saveInspections, settings, showToast, setView }) {
  const [step, setStep]           = useState(selectedLadder?1:0);
  const [answers, setAnswers]     = useState({});
  const [notes, setNotes]         = useState({});
  const [generalNotes, setGeneralNotes] = useState("");
  const [autoSendEmail, setAutoSendEmail] = useState(true);
  const [emailStatus, setEmailStatus]     = useState(null);
  const [emailError, setEmailError]       = useState("");

  const questions    = selectedLadder ? getQuestionsForType(selectedLadder.type) : [];
  const sections     = [...new Set(questions.map(q=>q.section))];
  const sectionQs    = sections.map(s=>questions.filter(q=>q.section===s));
  const answered     = Object.keys(answers).length;
  const allAnswered  = questions.every(q=>answers[q.id]);
  const hasCritFail  = questions.some(q=>q.critical&&answers[q.id]==="mangel");
  const hasAnyFail   = questions.some(q=>answers[q.id]==="mangel");
  const progress     = questions.length>0 ? Math.round((answered/questions.length)*100) : 0;
  const smtpOk       = !!(settings.smtp?.host&&settings.smtp?.user&&settings.smtp?.pass&&settings.email);

  const triggerEmail = (insp, lad) => {
    if (!smtpOk||!autoSendEmail) return;
    setEmailStatus("sending");
    sendEmailAPI(insp, lad, settings.email, settings.smtp)
      .then(()=>setEmailStatus("sent"))
      .catch(e=>{setEmailStatus("error");setEmailError(e.message);});
  };

  const handleFinish = sig => {
    const now=new Date(), nextDate=new Date(now);
    nextDate.setMonth(nextDate.getMonth()+(settings.interval||12));
    const insp={
      id:"P"+Date.now(), ladderId:selectedLadder.id,
      date:now.toISOString(), nextDate:nextDate.toISOString(),
      inspector:settings.inspector||"—", answers, notes, generalNotes, signature:sig,
      result:hasCritFail||hasAnyFail?"nicht_bestanden":"bestanden",
    };
    saveInspections([...inspections,insp]);
    showToast("Prüfung gespeichert!");
    setInspectionState(insp); setStep(4);
    triggerEmail(insp, selectedLadder);
  };

  const reset = () => { setSelectedLadder(null);setAnswers({});setNotes({});setGeneralNotes("");setStep(0);setInspectionState(null);setEmailStatus(null);setEmailError(""); };

  // Schritt 0
  if (step===0) return (
    <div style={S.page}>
      <h2 style={S.pageTitle}>Neue Prüfung starten</h2>
      <p style={{color:"#666",marginBottom:18,fontSize:15}}>Leiter auswählen:</p>
      {ladders.length===0
        ? <div style={S.emptyState}><div style={{fontSize:40}}>⊼</div><div>Bitte zuerst Leitern erfassen.</div></div>
        : ladders.map(l=>(
          <button key={l.id} style={S.selectLadderBtn} onClick={()=>{setSelectedLadder(l);setStep(1);setAnswers({});setNotes({});}}>
            <div style={{fontWeight:700,fontSize:16}}>{l.inventoryNr} — {l.name}</div>
            <div style={{fontSize:13,color:"#888",marginTop:4}}>{LADDER_TYPES.find(t=>t.id===l.type)?.label} · {l.location||"—"}</div>
          </button>
        ))
      }
    </div>
  );

  // Schritt 2: Zusammenfassung
  if (step===2) {
    const result = hasCritFail||hasAnyFail?"nicht_bestanden":"bestanden";
    return (
      <div style={S.page}>
        <button style={S.backBtn} onClick={()=>setStep(1)}>← Zurück zur Prüfung</button>
        <h2 style={S.pageTitle}>Zusammenfassung</h2>
        <div style={{...S.resultBox,background:result==="bestanden"?"#d4edda":"#f8d7da",borderColor:result==="bestanden"?"#2d6a4f":"#c1121f",color:result==="bestanden"?"#155724":"#721c24"}}>
          {result==="bestanden"?"✓ BESTANDEN":"✗ NICHT BESTANDEN"}
        </div>
        <div style={S.summaryInfo}>
          <div style={{fontSize:15}}><strong>Leiter:</strong> {selectedLadder.inventoryNr} — {selectedLadder.name}</div>
          <div style={{fontSize:15}}><strong>Standort:</strong> {selectedLadder.location||"—"}</div>
          <div style={{fontSize:15}}><strong>Prüfer:</strong> {settings.inspector||"—"}</div>
          <div style={{fontSize:15}}><strong>Mängel:</strong> {questions.filter(q=>answers[q.id]==="mangel").length} von {questions.length}</div>
        </div>
        {questions.filter(q=>answers[q.id]==="mangel").length>0&&(
          <div style={S.section}>
            <h3 style={S.sectionTitle}>Festgestellte Mängel</h3>
            {questions.filter(q=>answers[q.id]==="mangel").map(q=>(
              <div key={q.id} style={S.mangelItem}>
                <div style={{fontWeight:600,color:"#c1121f",fontSize:14}}>{q.critical?"⚠ Kritisch: ":""}{q.text}</div>
                {notes[q.id]&&<div style={{fontSize:13,color:"#666",marginTop:4}}>Anmerkung: {notes[q.id]}</div>}
              </div>
            ))}
          </div>
        )}
        <div style={S.fieldWrap}>
          <label style={S.fieldLabel}>Allgemeine Bemerkungen</label>
          <textarea style={S.textarea} value={generalNotes} onChange={e=>setGeneralNotes(e.target.value)} rows={3} placeholder="Ergänzende Hinweise…" />
        </div>
        {smtpOk&&(
          <div style={S.emailOptOut}>
            <label style={{display:"flex",alignItems:"flex-start",gap:12,cursor:"pointer"}}>
              <input type="checkbox" checked={autoSendEmail} onChange={e=>setAutoSendEmail(e.target.checked)}
                style={{marginTop:3,accentColor:"#E30613",width:20,height:20,flexShrink:0}} />
              <span style={{fontSize:15,lineHeight:1.4}}>
                <strong>E-Mail nach Abschluss automatisch versenden</strong>
                <br/><span style={{fontSize:13,color:"#888"}}>Empfänger: {settings.email}</span>
              </span>
            </label>
          </div>
        )}
        <button style={{...S.primaryBtn,marginTop:16}} onClick={()=>setStep(3)}>✍ Weiter zur Unterschrift →</button>
      </div>
    );
  }

  // Schritt 3: Unterschrift
  if (step===3) return (
    <div style={S.page}>
      <button style={S.backBtn} onClick={()=>setStep(2)}>← Zurück</button>
      <h2 style={S.pageTitle}>Unterschrift</h2>
      <p style={{color:"#666",fontSize:15,marginBottom:20}}>Bitte Prüfung durch Unterschrift bestätigen.</p>
      <SignaturePad onConfirm={sig=>handleFinish(sig)} />
    </div>
  );

  // Schritt 4: Fertig
  if (step===4) {
    const pass = inspectionState?.result==="bestanden";
    return (
      <div style={S.page}>
        <div style={S.doneBox}>
          <div style={{fontSize:64,marginBottom:14}}>{pass?"✅":"❌"}</div>
          <h2 style={{margin:"0 0 8px 0",fontSize:22}}>{pass?"Prüfung bestanden":"Prüfung nicht bestanden"}</h2>
          <p style={{color:"#666",fontSize:15}}>Nächste Prüfung: {new Date(inspectionState?.nextDate).toLocaleDateString("de-DE")}</p>

          {smtpOk&&(
            <div style={{...S.emailStatusBox,
              background:emailStatus==="sent"?"#d4edda":emailStatus==="error"?"#f8d7da":emailStatus==="sending"?"#e8f4fd":"#f5f5f5",
              borderColor:emailStatus==="sent"?"#2d6a4f":emailStatus==="error"?"#c1121f":emailStatus==="sending"?"#1a6fa8":"#ddd"}}>
              {emailStatus==="sending"&&<span style={{fontSize:14}}>✉ E-Mail wird gesendet an <strong>{settings.email}</strong>…</span>}
              {emailStatus==="sent"&&<span style={{color:"#2d6a4f",fontSize:14}}>✓ E-Mail mit PDF gesendet an <strong>{settings.email}</strong></span>}
              {emailStatus==="error"&&(
                <div>
                  <div style={{color:"#c1121f",fontSize:14,marginBottom:8}}>✗ Fehler: {emailError}</div>
                  <button style={S.actionBtn} onClick={()=>triggerEmail(inspectionState,selectedLadder)}>Erneut senden</button>
                </div>
              )}
              {!emailStatus&&!autoSendEmail&&<span style={{color:"#888",fontSize:14}}>E-Mail-Versand für diese Prüfung deaktiviert</span>}
            </div>
          )}

          <div style={{display:"flex",gap:12,marginTop:22,flexWrap:"wrap",justifyContent:"center"}}>
            <button style={S.primaryBtn} onClick={()=>downloadPDF(inspectionState,selectedLadder)}>📄 PDF herunterladen</button>
            <button style={S.secondaryBtn} onClick={reset}>Neue Prüfung</button>
            <button style={S.secondaryBtn} onClick={()=>{reset();setView(VIEWS.DASHBOARD);}}>Dashboard</button>
          </div>
        </div>
      </div>
    );
  }

  // Schritt 1: Alle Fragen
  return (
    <div style={{...S.page,paddingBottom:100}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <button style={S.backBtn} onClick={()=>{if(confirm("Prüfung abbrechen?"))reset();}}>✕ Abbrechen</button>
        <div style={{fontSize:14,fontWeight:600}}>{selectedLadder.inventoryNr} — {selectedLadder.name}</div>
      </div>
      <div style={{fontSize:13,color:"#888",marginBottom:6}}>{selectedLadder.location||"—"} · {LADDER_TYPES.find(t=>t.id===selectedLadder.type)?.label}</div>
      <div style={S.progressWrap}>
        <div style={S.progressBar}><div style={{...S.progressFill,width:`${progress}%`}} /></div>
        <div style={S.progressText}>{progress}% · {answered}/{questions.length} Prüfpunkte beantwortet</div>
      </div>
      {sections.map((sec,si)=>(
        <div key={sec}>
          <div style={S.sectionDivider}>{sec}</div>
          {sectionQs[si].map(q=>(
            <div key={q.id} style={{...S.questionCard,borderLeft:`3px solid ${answers[q.id]==="ok"?"#2d6a4f":answers[q.id]==="mangel"?"#c1121f":answers[q.id]==="na"?"#888":"#ddd"}`}}>
              <div style={S.qText}>
                {q.critical&&<span style={S.critBadge}>Kritisch</span>}
                {q.text}
              </div>
              <div style={S.qNorm}>{q.norm}</div>
              <div style={S.answerRow}>
                {[
                  {val:"ok",    label:"i.O.",  color:"#2d6a4f",bg:"#d4edda"},
                  {val:"mangel",label:"Mangel",color:"#c1121f",bg:"#f8d7da"},
                  {val:"na",    label:"n.a.",  color:"#666",   bg:"#e9ecef"},
                ].map(opt=>(
                  <button key={opt.val} style={{...S.answerBtn,...(answers[q.id]===opt.val?{background:opt.bg,color:opt.color,borderColor:opt.color,fontWeight:700}:{})}}
                    onClick={()=>setAnswers(a=>({...a,[q.id]:opt.val}))}>
                    {opt.label}
                  </button>
                ))}
              </div>
              {answers[q.id]==="mangel"&&(
                <input style={S.noteInput} placeholder="Mangel beschreiben…" value={notes[q.id]||""} onChange={e=>setNotes(n=>({...n,[q.id]:e.target.value}))} />
              )}
            </div>
          ))}
        </div>
      ))}
      <div style={{position:"fixed",bottom:72,left:0,right:0,zIndex:50,display:"flex",justifyContent:"center",pointerEvents:"none"}}>
        <div style={{width:"100%",maxWidth:680,padding:"12px 16px",background:"#fff",borderTop:"2px solid #E30613",pointerEvents:"all"}}>
          <button style={{...S.primaryBtn,marginTop:0,opacity:allAnswered?1:0.5}}
            onClick={()=>{if(allAnswered)setStep(2);else showToast(`Noch ${questions.length-answered} Fragen offen`,"error");}}>
            {allAnswered?"Zur Zusammenfassung →":`${questions.length-answered} Fragen noch offen`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Unterschrift (Unterschrift ist Pflicht) ───
function SignaturePad({ onConfirm }) {
  const canvasRef = useRef(null);
  const drawing   = useRef(false);
  const lastPos   = useRef(null);
  const [hasSig, setHasSig] = useState(false);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const getPos=e=>{
      const r=canvas.getBoundingClientRect();
      const sx=canvas.width/r.width, sy=canvas.height/r.height;
      const src=e.touches?e.touches[0]:e;
      return {x:(src.clientX-r.left)*sx,y:(src.clientY-r.top)*sy};
    };
    const onStart=e=>{e.preventDefault();drawing.current=true;setHasSig(true);lastPos.current=getPos(e);const ctx=canvas.getContext("2d");const p=lastPos.current;ctx.beginPath();ctx.arc(p.x,p.y,1.5,0,Math.PI*2);ctx.fillStyle="#1A1A1A";ctx.fill();};
    const onMove=e=>{e.preventDefault();if(!drawing.current)return;const ctx=canvas.getContext("2d");const p=getPos(e);ctx.beginPath();ctx.moveTo(lastPos.current.x,lastPos.current.y);ctx.lineTo(p.x,p.y);ctx.strokeStyle="#1A1A1A";ctx.lineWidth=2.5;ctx.lineCap="round";ctx.lineJoin="round";ctx.stroke();lastPos.current=p;};
    const onEnd=e=>{e?.preventDefault();drawing.current=false;};
    canvas.addEventListener("mousedown",onStart);canvas.addEventListener("mousemove",onMove);canvas.addEventListener("mouseup",onEnd);canvas.addEventListener("mouseleave",onEnd);
    canvas.addEventListener("touchstart",onStart,{passive:false});canvas.addEventListener("touchmove",onMove,{passive:false});canvas.addEventListener("touchend",onEnd,{passive:false});
    return()=>{canvas.removeEventListener("mousedown",onStart);canvas.removeEventListener("mousemove",onMove);canvas.removeEventListener("mouseup",onEnd);canvas.removeEventListener("mouseleave",onEnd);canvas.removeEventListener("touchstart",onStart);canvas.removeEventListener("touchmove",onMove);canvas.removeEventListener("touchend",onEnd);};
  },[]);

  const clear=()=>{canvasRef.current.getContext("2d").clearRect(0,0,640,200);setHasSig(false);};

  return (
    <div>
      <div style={{position:"relative",border:"2px solid #1A1A1A",borderRadius:12,background:"#fff",overflow:"hidden"}}>
        <canvas ref={canvasRef} width={640} height={200} style={{display:"block",width:"100%",height:180,cursor:"crosshair",touchAction:"none"}} />
        {!hasSig&&<div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",color:"#ccc",fontSize:15,pointerEvents:"none",whiteSpace:"nowrap"}}>Hier unterschreiben</div>}
      </div>
      <div style={{display:"flex",gap:10,marginTop:14}}>
        <button style={{...S.secondaryBtn,flex:1}} onClick={clear}>✕ Löschen</button>
        <button style={{...S.primaryBtn,flex:2,marginTop:0,opacity:hasSig?1:0.4}} onClick={()=>{if(!hasSig)return;onConfirm(canvasRef.current.toDataURL("image/png"));}}>✓ Unterschrift bestätigen</button>
      </div>
      <p style={{fontSize:13,color:"#aaa",textAlign:"center",marginTop:10}}>Unterschrift erforderlich — Prüfprotokoll wird mit Ihrer Unterschrift gespeichert.</p>
    </div>
  );
}

// ─── Prüfhistorie ───
function HistoryView({ inspections, ladders, saveInspections, showToast, settings, highlightedId, clearHighlight }) {
  const sorted = [...inspections].sort((a,b)=>new Date(b.date)-new Date(a.date));
  const highlightRef = useRef(null);
  const smtpOk = !!(settings.smtp?.host&&settings.smtp?.user&&settings.smtp?.pass&&settings.email);

  useEffect(()=>{
    if(highlightedId&&highlightRef.current){
      setTimeout(()=>highlightRef.current?.scrollIntoView({behavior:"smooth",block:"center"}),150);
    }
  },[highlightedId]);

  const del = id => {
    if(confirm("Protokoll löschen?")){ saveInspections(inspections.filter(i=>i.id!==id)); showToast("Protokoll gelöscht"); if(id===highlightedId)clearHighlight(); }
  };

  return (
    <div style={S.page}>
      <h2 style={S.pageTitle}>Prüfhistorie ({inspections.length})</h2>
      {sorted.length===0&&<div style={S.emptyState}><div style={{fontSize:40}}>📋</div><div style={{fontSize:15}}>Noch keine Prüfungen.</div></div>}
      {sorted.map(insp=>{
        const lad=ladders.find(l=>l.id===insp.ladderId);
        const pass=insp.result==="bestanden";
        const hl=insp.id===highlightedId;
        return (
          <div key={insp.id} ref={hl?highlightRef:null}
            style={{...S.historyCard,borderLeft:`4px solid ${pass?"#2d6a4f":"#c1121f"}`,
              ...(hl?{boxShadow:"0 0 0 2px #E30613",background:"#fff8f8"}:{})}}>
            {hl&&<div style={{fontSize:11,color:"#E30613",fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Ausgewählt</div>}
            <div style={S.historyTop}>
              <div>
                <div style={S.historyDate}>{new Date(insp.date).toLocaleDateString("de-DE")}</div>
                <div style={S.historyLadder}>{lad?`${lad.inventoryNr} — ${lad.name}`:"Leiter gelöscht"}{lad?.location?<span style={S.locTag}>{lad.location}</span>:""}</div>
                <div style={S.historyMeta}>Prüfer: {insp.inspector} · {insp.id}</div>
              </div>
              <div style={{...S.statusBadge,background:pass?"#d4edda":"#f8d7da",color:pass?"#2d6a4f":"#c1121f"}}>{pass?"Bestanden":"Nicht best."}</div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:12,flexWrap:"wrap"}}>
              <button style={S.actionBtn} onClick={()=>downloadPDF(insp,lad||{inventoryNr:"?",name:"Gelöscht",type:"stehleiter",manufacturer:"",material:"",year:"",location:""})}>📄 PDF</button>
              {smtpOk&&lad&&<button style={S.actionBtn} onClick={()=>sendEmailAPI(insp,lad,settings.email,settings.smtp).then(()=>showToast("E-Mail gesendet")).catch(e=>showToast("Fehler: "+e.message,"error"))}>✉ E-Mail</button>}
              {settings.email&&!smtpOk&&lad&&<button style={S.actionBtn} onClick={()=>sendEmailMailto(insp,lad,settings.email)}>✉ E-Mail</button>}
              <button style={{...S.actionBtn,color:"#c1121f",borderColor:"#ffcdd2"}} onClick={()=>del(insp.id)}>🗑 Löschen</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Einstellungen ───
function SettingsView({ settings, saveSettings, locations, saveLocations, ladders, saveLadders, showToast }) {
  const [form, setForm] = useState({...EMPTY_SETTINGS,...settings,smtp:{...EMPTY_SETTINGS.smtp,...(settings.smtp||{})}});
  const [newLoc, setNewLoc]       = useState("");
  const [editingLoc, setEditingLoc] = useState(null);
  const [editLocVal, setEditLocVal] = useState("");
  const [activeTab, setActiveTab] = useState("allgemein");
  const [smtpTest, setSmtpTest]   = useState(null);
  const [smtpTestMsg, setSmtpTestMsg] = useState("");

  const save = () => { saveSettings(form); showToast("Einstellungen gespeichert"); };

  const addLoc = () => {
    const l=newLoc.trim(); if(!l) return;
    if(locations.includes(l)){showToast("Standort bereits vorhanden","error");return;}
    saveLocations([...locations,l]); setNewLoc(""); showToast("Standort hinzugefügt");
  };

  const removeLoc = loc => {
    if(!confirm(`Standort "${loc}" entfernen?`)) return;
    saveLocations(locations.filter(l=>l!==loc)); showToast("Standort entfernt");
  };

  const saveRename = oldName => {
    const n=editLocVal.trim();
    if(!n||n===oldName){setEditingLoc(null);return;}
    if(locations.includes(n)){showToast("Name bereits vergeben","error");return;}
    saveLocations(locations.map(l=>l===oldName?n:l));
    saveLadders(ladders.map(l=>l.location===oldName?{...l,location:n}:l));
    setEditingLoc(null); showToast(`"${oldName}" → "${n}" umbenannt`);
  };

  const testSmtp = async () => {
    if(!form.smtp?.host||!form.smtp?.user||!form.smtp?.pass||!form.email){
      setSmtpTestMsg("Bitte E-Mail-Adresse, SMTP Host, Benutzername und Passwort eingeben.");
      setSmtpTest("error"); return;
    }
    setSmtpTest("testing"); setSmtpTestMsg("");
    try {
      const testInsp={id:"TEST",ladderId:"X",date:new Date().toISOString(),nextDate:new Date().toISOString(),inspector:"Test",answers:{},notes:{},generalNotes:"SMTP-Testmail.",signature:null,result:"bestanden"};
      const testLad={inventoryNr:"TEST-001",name:"SMTP Test",type:"stehleiter",manufacturer:"",material:"",year:"",location:""};
      await sendEmailAPI(testInsp,testLad,form.email,form.smtp);
      setSmtpTest("ok"); setSmtpTestMsg(`Test-E-Mail erfolgreich an ${form.email} gesendet!`);
    } catch(e){ setSmtpTest("error"); setSmtpTestMsg(e.message); }
  };

  const TABS=[
    {id:"allgemein",  label:"Allgemein",  icon:"⚙"},
    {id:"email",      label:"E-Mail",     icon:"✉"},
    {id:"standorte",  label:"Standorte",  icon:"📍"},
    {id:"rechtliches",label:"Recht",      icon:"⚖"},
  ];

  return (
    <div style={S.page}>
      <h2 style={S.pageTitle}>Einstellungen</h2>

      <div style={S.settingsTabs}>
        {TABS.map(t=>(
          <button key={t.id} style={{...S.settingsTab,...(activeTab===t.id?S.settingsTabActive:{})}} onClick={()=>setActiveTab(t.id)}>
            <span style={{fontSize:20,marginBottom:2}}>{t.icon}</span>
            <span style={{fontSize:12,fontWeight:600}}>{t.label}</span>
          </button>
        ))}
      </div>

      {activeTab==="allgemein"&&(
        <div style={S.settingsSection}>
          <h3 style={S.sectionTitle}>Prüfer & Organisation</h3>
          <Field label="Name des Prüfers / Befähigte Person" value={form.inspector} onChange={v=>setForm(f=>({...f,inspector:v}))} placeholder="Vor- und Nachname" />
          <Field label="Organisation / Unternehmen" value={form.company} onChange={v=>setForm(f=>({...f,company:v}))} placeholder="z.B. BRK Bereitschaft Großheubach" />
          <div style={S.fieldWrap}>
            <label style={S.fieldLabel}>Standard-Prüfintervall</label>
            <select style={S.select} value={form.interval} onChange={e=>setForm(f=>({...f,interval:parseInt(e.target.value)}))}>
              {[3,6,9,12,18,24].map(m=><option key={m} value={m}>{m} Monate</option>)}
            </select>
          </div>
          <button style={S.primaryBtn} onClick={save}>💾 Speichern</button>
        </div>
      )}

      {activeTab==="email"&&(
        <div style={S.settingsSection}>
          <h3 style={S.sectionTitle}>Empfänger</h3>
          <Field label="E-Mail-Empfänger" value={form.email||""} onChange={v=>setForm(f=>({...f,email:v}))} placeholder="pruefung@example.de" type="email" />

          <h3 style={{...S.sectionTitle,marginTop:20}}>SMTP-Server</h3>
          <p style={{fontSize:14,color:"#888",marginBottom:14,lineHeight:1.5}}>
            Mit SMTP wird das PDF-Prüfprotokoll automatisch nach jeder Prüfung als E-Mail-Anhang versendet.
          </p>
          <div style={S.formGrid}>
            <Field label="SMTP Host" value={form.smtp?.host||""} onChange={v=>setForm(f=>({...f,smtp:{...f.smtp,host:v}}))} placeholder="smtp.example.de" />
            <Field label="SMTP Port" value={form.smtp?.port||"587"} onChange={v=>setForm(f=>({...f,smtp:{...f.smtp,port:v}}))} placeholder="587" />
          </div>
          <Field label="SMTP Benutzername" value={form.smtp?.user||""} onChange={v=>setForm(f=>({...f,smtp:{...f.smtp,user:v}}))} placeholder="nutzer@example.de" />
          <Field label="SMTP Passwort" value={form.smtp?.pass||""} onChange={v=>setForm(f=>({...f,smtp:{...f.smtp,pass:v}}))} placeholder="••••••••" type="password" />
          <div style={{...S.fieldWrap,marginBottom:16}}>
            <label style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer",fontSize:15,padding:"12px 14px",background:"#f5f5f5",borderRadius:10}}>
              <input type="checkbox" checked={form.smtp?.secure||false}
                onChange={e=>setForm(f=>({...f,smtp:{...f.smtp,secure:e.target.checked}}))}
                style={{accentColor:"#E30613",width:20,height:20}} />
              SSL/TLS (Port 465)
            </label>
          </div>
          <button style={{...S.secondaryBtn,width:"100%",marginBottom:10}} onClick={testSmtp} disabled={smtpTest==="testing"}>
            {smtpTest==="testing"?"⏳ Test-E-Mail wird gesendet…":"✉ SMTP-Verbindung testen"}
          </button>
          {smtpTest&&smtpTest!=="testing"&&(
            <div style={{padding:"12px 14px",borderRadius:10,fontSize:14,marginBottom:14,background:smtpTest==="ok"?"#d4edda":"#f8d7da",color:smtpTest==="ok"?"#2d6a4f":"#c1121f"}}>
              {smtpTest==="ok"?"✓ ":"✗ "}{smtpTestMsg}
            </div>
          )}
          <button style={S.primaryBtn} onClick={save}>💾 E-Mail-Einstellungen speichern</button>
          <div style={{marginTop:14,padding:"12px 14px",background:"#f5f5f5",borderRadius:10,fontSize:13,color:"#888",lineHeight:1.7}}>
            <strong style={{color:"#555"}}>Hinweise:</strong><br/>
            • Gmail: smtp.gmail.com, Port 587, App-Passwort<br/>
            • Office 365: smtp.office365.com, Port 587<br/>
            • Port 465 = SSL/TLS · Port 587 = STARTTLS
          </div>
        </div>
      )}

      {activeTab==="standorte"&&(
        <div style={S.settingsSection}>
          <h3 style={S.sectionTitle}>Standorte verwalten</h3>
          <div style={{display:"flex",gap:10,marginBottom:14}}>
            <input style={{...S.input,flex:1}} placeholder="Neuer Standort…" value={newLoc}
              onChange={e=>setNewLoc(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addLoc()} />
            <button style={{...S.primaryBtn,width:"auto",marginTop:0,padding:"12px 18px",flexShrink:0}} onClick={addLoc}>+ Hinzufügen</button>
          </div>
          {locations.length===0
            ? <div style={{fontSize:14,color:"#888"}}>Noch keine Standorte definiert.</div>
            : locations.map(loc=>(
              <div key={loc} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",background:"#f8f8f8",borderRadius:10,marginBottom:8,border:"1px solid #eee"}}>
                {editingLoc===loc
                  ? <input style={{...S.input,flex:1,marginRight:10}} value={editLocVal}
                      onChange={e=>setEditLocVal(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter")saveRename(loc);if(e.key==="Escape")setEditingLoc(null);}}
                      autoFocus />
                  : <span style={{fontSize:15}}>{loc}</span>
                }
                <div style={{display:"flex",gap:8}}>
                  {editingLoc===loc
                    ? <><button style={{...S.actionBtn,color:"#2d6a4f",borderColor:"#2d6a4f"}} onClick={()=>saveRename(loc)}>✓</button>
                         <button style={S.actionBtn} onClick={()=>setEditingLoc(null)}>✕</button></>
                    : <><button style={S.actionBtn} onClick={()=>{setEditingLoc(loc);setEditLocVal(loc);}}>✏ Umbenennen</button>
                         <button style={{...S.actionBtn,color:"#c1121f",borderColor:"#ffcdd2"}} onClick={()=>removeLoc(loc)}>✕</button></>
                  }
                </div>
              </div>
            ))
          }
          <p style={{fontSize:13,color:"#aaa",marginTop:8}}>Umbenennen aktualisiert alle zugehörigen Leitern automatisch.</p>
        </div>
      )}

      {activeTab==="rechtliches"&&(
        <div style={S.legalBox}>
          <h3 style={{margin:"0 0 14px",fontSize:14,color:"#E30613"}}>Rechtsgrundlagen</h3>
          {[
            ["https://www.gesetze-im-internet.de/arbschg/","Arbeitsschutzgesetz (ArbSchG)","Grundlegende Pflichten des Arbeitgebers"],
            ["https://www.gesetze-im-internet.de/betrsichv_2015/","Betriebssicherheitsverordnung (BetrSichV) §3, §14","Bereitstellung und Prüfung von Arbeitsmitteln"],
            ["https://www.baua.de","TRBS 1201","Prüfungen von Arbeitsmitteln (baua.de)"],
            ["https://www.baua.de","TRBS 2121 Teil 2","Gefährdung bei der Verwendung von Leitern (baua.de)"],
            ["https://publikationen.dguv.de","DGUV Information 208-016","Handlungsanleitung Leitern und Tritte"],
            ["https://www.baua.de","TRBS 1203","Befähigte Personen (baua.de)"],
          ].map(([href,label,sub])=>(
            <div key={label} style={S.legalItem}>
              <a href={href} target="_blank" rel="noopener noreferrer" style={{color:"#1A1A1A",fontWeight:600,textDecoration:"none",fontSize:14}}>
                {label} <span style={{color:"#E30613"}}>↗</span>
              </a>
              <div style={{fontSize:12,color:"#888",marginTop:2}}>{sub}</div>
            </div>
          ))}
          {[["DIN EN 131-1 bis -4","Leitern: Benennungen, Bauarten, Anforderungen","Kostenpflichtig via din.de"],
            ["DIN EN 14183","Tritte","Kostenpflichtig via din.de"]].map(([t,s,n])=>(
            <div key={t} style={S.legalItem}>
              <strong style={{fontSize:14}}>{t}</strong> — {s}
              <div style={{fontSize:12,color:"#aaa",marginTop:2}}>{n}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type="text" }) {
  return (
    <div style={S.fieldWrap}>
      <label style={S.fieldLabel}>{label}</label>
      <input style={S.input} type={type} value={value||""} onChange={e=>onChange(e.target.value)}
        placeholder={placeholder} autoComplete={type==="password"?"current-password":"off"} />
    </div>
  );
}

// ─── Styles ───
const DRK = "#E30613";

const S = {
  shell:      { fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif", minHeight:"100vh", background:"#F2F2F2", color:"#1A1A1A", position:"relative", paddingBottom:72 },
  loadScreen: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100vh", background:DRK, color:"#fff" },

  header:      { background:DRK, color:"#fff", padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:100, boxShadow:"0 2px 12px rgba(227,6,19,0.3)" },
  headerLeft:  { display:"flex", alignItems:"center", gap:12 },
  logo:        { fontSize:24, width:42, height:42, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(255,255,255,0.2)", borderRadius:10, fontWeight:700, flexShrink:0 },
  headerTitle: { fontSize:17, fontWeight:700, letterSpacing:0.3 },
  headerSub:   { fontSize:10, opacity:0.8 },
  menuBtn:     { background:"none", border:"none", color:"#fff", cursor:"pointer", padding:10, fontSize:24, lineHeight:1, minWidth:44, minHeight:44 },

  overlay:      { position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:200 },
  mobileNav:    { position:"fixed", top:0, left:0, bottom:0, width:270, background:"#1A1A1A", zIndex:300, transition:"transform 0.25s ease", paddingTop:64, display:"flex", flexDirection:"column", gap:2 },
  navItem:      { display:"flex", alignItems:"center", gap:14, padding:"16px 24px", background:"none", border:"none", color:"#fff", fontSize:16, cursor:"pointer", textAlign:"left", width:"100%", minHeight:52 },
  navItemActive:{ background:"rgba(227,6,19,0.2)", borderRight:`3px solid ${DRK}` },
  navIcon:      { fontSize:20, width:26, textAlign:"center" },

  tabBar:      { position:"fixed", bottom:0, left:0, right:0, background:"#fff", display:"flex", zIndex:100, boxShadow:"0 -2px 8px rgba(0,0,0,0.1)", borderTop:`2px solid ${DRK}`, paddingBottom:"env(safe-area-inset-bottom,0px)" },
  tabItem:     { flex:1, display:"flex", flexDirection:"column", alignItems:"center", padding:"10px 0", background:"none", border:"none", color:"#999", cursor:"pointer", minHeight:58 },
  tabItemActive:{ color:DRK },

  main:      { maxWidth:680, margin:"0 auto" },
  page:      { padding:"20px 16px" },
  pageTitle: { margin:"0 0 18px", fontSize:22, fontWeight:700, letterSpacing:0.2 },

  toast: { position:"fixed", top:78, left:"50%", transform:"translateX(-50%)", color:"#fff", padding:"12px 28px", borderRadius:10, fontSize:14, fontWeight:600, zIndex:999, boxShadow:"0 4px 16px rgba(0,0,0,0.2)", whiteSpace:"nowrap" },

  quickActions:  { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:20 },
  quickActionBtn:{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:"16px 6px", background:"#fff", border:"1px solid #E8E8E8", borderRadius:14, cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", minHeight:80 },
  qaIcon:        { fontSize:24, color:DRK },
  qaLabel:       { fontSize:11, fontWeight:600, color:"#555", textAlign:"center" },
  linkBtn:       { background:"none", border:"none", color:DRK, cursor:"pointer", fontSize:14, fontWeight:600, padding:"4px 0", minHeight:44 },
  iconBtn:       { background:"none", border:"1px solid #ddd", borderRadius:8, color:"#666", cursor:"pointer", padding:"6px 12px", fontSize:16, minWidth:40, minHeight:40 },
  locTag:        { display:"inline-block", background:"#EBEBEB", color:"#666", fontSize:11, padding:"2px 8px", borderRadius:12, marginLeft:6 },

  statGrid:  { display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 },
  statCard:  { background:"#fff", borderRadius:12, padding:"18px 14px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" },
  statNum:   { fontSize:32, fontWeight:800, lineHeight:1 },
  statLabel: { fontSize:12, color:"#888", marginTop:5, letterSpacing:0.2 },

  alertBtn:  { background:DRK, color:"#fff", border:"none", borderRadius:8, padding:"10px 16px", fontSize:13, fontWeight:600, cursor:"pointer", flexShrink:0, minHeight:44 },

  section:      { marginBottom:22 },
  sectionTitle: { fontSize:15, fontWeight:700, margin:"0 0 12px" },
  listRow:      { padding:"12px 14px", background:"#fff", borderRadius:10, marginBottom:8, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" },
  emptyState:   { textAlign:"center", padding:"48px 20px", color:"#888" },

  settingsTabs:    { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:18 },
  settingsTab:     { display:"flex", flexDirection:"column", alignItems:"center", gap:4, padding:"12px 4px", background:"#fff", border:"1px solid #ddd", borderRadius:12, cursor:"pointer", color:"#888", minHeight:64 },
  settingsTabActive:{ background:DRK, color:"#fff", borderColor:DRK },
  settingsSection: { background:"#fff", borderRadius:14, padding:18, marginBottom:16, border:"1px solid #eee" },

  emailOptOut:  { background:"#f0f8ff", border:"1px solid #b8d9f0", borderRadius:10, padding:"14px 16px", marginBottom:4 },
  emailStatusBox:{ border:"1px solid", borderRadius:10, padding:"14px 16px", marginTop:14, fontSize:14, textAlign:"left" },

  ladderCard:     { background:"#fff", borderRadius:12, padding:16, marginBottom:12, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" },
  ladderTop:      { display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 },
  ladderNr:       { fontSize:12, fontWeight:700, color:DRK, letterSpacing:0.5 },
  ladderName:     { fontSize:16, fontWeight:700, margin:"3px 0" },
  ladderMeta:     { fontSize:13, color:"#888" },
  ladderLastCheck:{ fontSize:12, color:"#666", marginTop:10, padding:"8px 0", borderTop:"1px solid #eee" },
  statusBadge:    { fontSize:12, fontWeight:700, padding:"5px 12px", borderRadius:20, whiteSpace:"nowrap" },

  retiredBanner:{ background:"#f0f0f0", borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:14, color:"#666", fontWeight:600 },
  hintBox:      { fontSize:13, color:"#e09f3e", padding:"10px 14px", background:"#fff8f0", borderRadius:10, border:"1px solid #f0c78e" },

  searchInput:{ width:"100%", padding:"13px 16px", border:"1px solid #ddd", borderRadius:10, fontSize:15, marginBottom:16, background:"#fff", boxSizing:"border-box", outline:"none", minHeight:48 },
  formHeader: { display:"flex", alignItems:"center", gap:12, marginBottom:18, flexWrap:"wrap" },
  formGrid:   { display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 },
  fieldWrap:  { marginBottom:14 },
  fieldLabel: { display:"block", fontSize:12, fontWeight:700, marginBottom:6, color:"#555", letterSpacing:0.4, textTransform:"uppercase" },
  input:      { width:"100%", padding:"13px 14px", border:"1px solid #ddd", borderRadius:10, fontSize:15, background:"#fff", boxSizing:"border-box", outline:"none", minHeight:48 },
  select:     { width:"100%", padding:"13px 14px", border:"1px solid #ddd", borderRadius:10, fontSize:15, background:"#fff", boxSizing:"border-box", outline:"none", minHeight:48 },
  textarea:   { width:"100%", padding:"13px 14px", border:"1px solid #ddd", borderRadius:10, fontSize:15, background:"#fff", boxSizing:"border-box", resize:"vertical", outline:"none", fontFamily:"inherit" },

  primaryBtn:  { background:DRK, color:"#fff", border:"none", borderRadius:10, padding:"15px 24px", fontSize:16, fontWeight:700, cursor:"pointer", width:"100%", marginTop:10, letterSpacing:0.2, minHeight:52 },
  secondaryBtn:{ background:"#fff", color:DRK, border:`2px solid ${DRK}`, borderRadius:10, padding:"13px 22px", fontSize:15, fontWeight:600, cursor:"pointer", minHeight:50 },
  actionBtn:   { background:"none", border:"1px solid #ddd", borderRadius:8, padding:"10px 16px", fontSize:13, cursor:"pointer", color:"#555", minHeight:44, fontWeight:500 },
  backBtn:     { background:"none", border:"none", color:DRK, cursor:"pointer", fontSize:16, fontWeight:600, padding:"8px 0", minHeight:44 },

  selectLadderBtn:{ display:"block", width:"100%", textAlign:"left", background:"#fff", border:"1px solid #ddd", borderRadius:12, padding:"16px 18px", marginBottom:10, cursor:"pointer", minHeight:72 },

  progressWrap: { marginBottom:18 },
  progressBar:  { height:8, background:"#E8E8E8", borderRadius:4, overflow:"hidden" },
  progressFill: { height:"100%", background:`linear-gradient(90deg,${DRK},#B5000F)`, borderRadius:4, transition:"width 0.3s ease" },
  progressText: { fontSize:13, color:"#888", marginTop:5 },

  sectionDivider:{ background:DRK, color:"#fff", fontWeight:700, padding:"10px 14px", borderRadius:10, fontSize:13, letterSpacing:0.5, textTransform:"uppercase", marginBottom:10, marginTop:18 },

  questionCard:{ background:"#fff", borderRadius:12, padding:16, boxShadow:"0 1px 3px rgba(0,0,0,0.04)", marginBottom:10 },
  qText:       { fontSize:14, lineHeight:1.5, fontWeight:500, marginBottom:6 },
  qNorm:       { fontSize:11, color:"#999", marginBottom:12 },
  critBadge:   { display:"inline-block", background:"#f8d7da", color:"#c1121f", fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:6, marginRight:8, verticalAlign:"middle" },
  answerRow:   { display:"flex", gap:8 },
  answerBtn:   { flex:1, padding:"13px 0", border:"2px solid #ddd", borderRadius:10, background:"#fff", cursor:"pointer", fontSize:14, fontWeight:500, minHeight:48, textAlign:"center" },
  noteInput:   { width:"100%", marginTop:10, padding:"11px 13px", border:"1px solid #f0c78e", borderRadius:8, fontSize:14, background:"#fff8f0", boxSizing:"border-box", outline:"none", minHeight:44 },

  resultBox:  { textAlign:"center", padding:22, borderRadius:12, border:"2px solid", fontSize:18, fontWeight:800, marginBottom:22 },
  summaryInfo:{ background:"#fff", borderRadius:12, padding:18, marginBottom:18, display:"flex", flexDirection:"column", gap:8 },
  mangelItem: { padding:"12px 14px", background:"#fff8f0", borderRadius:10, marginBottom:8, borderLeft:"3px solid #c1121f" },
  doneBox:    { textAlign:"center", padding:"44px 20px" },

  historyCard:   { background:"#fff", borderRadius:12, padding:16, marginBottom:12, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" },
  historyTop:    { display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 },
  historyDate:   { fontSize:17, fontWeight:700 },
  historyLadder: { fontSize:14, marginTop:3 },
  historyMeta:   { fontSize:12, color:"#888", marginTop:5 },

  legalBox:  { background:"#fff", borderRadius:14, padding:18, border:"1px solid #ddd" },
  legalItem: { padding:"8px 0", borderBottom:"1px solid #f0f0f0" },
};
