import { useState, useEffect } from "react";

// ─── Persistent Storage via localStorage ───
const LADDERS_KEY = "lp_ladders";
const INSPECTIONS_KEY = "lp_inspections";
const PRUEFER_KEY = "lp_pruefer";

function loadData(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function saveData(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.error(e); }
}

// ─── Inspection questions per DGUV 208-016 / BetrSichV / DIN EN 131 ───
const LADDER_TYPES = [
  { id: "stehleiter", label: "Stehleiter", icon: "⊼" },
  { id: "anlegeleiter", label: "Anlegeleiter", icon: "⟋" },
  { id: "mehrzweckleiter", label: "Mehrzweckleiter", icon: "⋈" },
  { id: "trittleiter", label: "Trittleiter / Tritt", icon: "⊥" },
  { id: "schiebeleiter", label: "Schiebeleiter", icon: "⇕" },
  { id: "podestleiter", label: "Podestleiter", icon: "⊓" },
];

const MATERIALS = ["Aluminium", "Stahl", "Holz", "GFK (Glasfaser)", "Kunststoff"];

const BASE_QUESTIONS = [
  { id: "q_betriebsanleitung", section: "Kennzeichnung & Dokumentation", text: "Ist die Betriebsanleitung (Gebrauchsanweisung) dauerhaft lesbar am Produkt angebracht?", norm: "DIN EN 131-3", critical: true },
  { id: "q_gs_zeichen", section: "Kennzeichnung & Dokumentation", text: "Ist das GS-Zeichen (Geprüfte Sicherheit) vorhanden und unbeschädigt?", norm: "ProdSG §21", critical: false },
  { id: "q_typenschild", section: "Kennzeichnung & Dokumentation", text: "Ist das Typenschild mit Herstellerangaben, Typ und max. Belastung lesbar vorhanden?", norm: "DIN EN 131-3", critical: true },
  { id: "q_piktogramme", section: "Kennzeichnung & Dokumentation", text: "Sind die Sicherheitspiktogramme zur richtigen Nutzung vollständig und lesbar?", norm: "DIN EN 131-3", critical: false },
  { id: "q_holme_verformung", section: "Holme / Wangen", text: "Sind die Holme/Wangen frei von Verformungen, Rissen, Dellen und Knicken?", norm: "DGUV 208-016", critical: true },
  { id: "q_holme_korrosion", section: "Holme / Wangen", text: "Sind die Holme frei von Korrosion, Materialermüdung oder Abnutzung?", norm: "DGUV 208-016", critical: true },
  { id: "q_holme_verbindung", section: "Holme / Wangen", text: "Sind alle Verbindungsstellen der Holme (Nieten, Schweißnähte, Schrauben) intakt?", norm: "BetrSichV §14", critical: true },
  { id: "q_sprossen_zustand", section: "Sprossen / Stufen", text: "Sind alle Sprossen/Stufen vollständig vorhanden und unbeschädigt?", norm: "DGUV 208-016", critical: true },
  { id: "q_sprossen_befestigung", section: "Sprossen / Stufen", text: "Sind die Sprossen/Stufen fest mit den Holmen verbunden (kein Spiel, keine Lockerung)?", norm: "DIN EN 131-2", critical: true },
  { id: "q_sprossen_rutsch", section: "Sprossen / Stufen", text: "Ist die Rutschhemmung der Sprossen/Stufen (Riffelung, Gummi) in einwandfreiem Zustand?", norm: "DIN EN 131-1", critical: false },
  { id: "q_fuesse_zustand", section: "Leiterfüße", text: "Sind die Leiterfüße vollständig vorhanden und unbeschädigt?", norm: "DGUV 208-016", critical: true },
  { id: "q_fuesse_rutsch", section: "Leiterfüße", text: "Ist die Rutschhemmung der Leiterfüße (Gummi-/Kunststoffkappen) ausreichend?", norm: "DIN EN 131-2", critical: true },
  { id: "q_fuesse_befestigung", section: "Leiterfüße", text: "Sind die Leiterfüße sicher befestigt und nicht abgenutzt?", norm: "DGUV 208-016", critical: false },
  { id: "q_schrauben", section: "Verbindungselemente", text: "Sind alle Schrauben, Muttern und Bolzen fest angezogen und vollständig?", norm: "BetrSichV §14", critical: true },
  { id: "q_oberflaeche", section: "Oberfläche & Zustand", text: "Ist die Oberfläche frei von scharfen Kanten, Graten oder Splittern?", norm: "DGUV 208-016", critical: true },
  { id: "q_sauberkeit", section: "Oberfläche & Zustand", text: "Ist die Leiter sauber und frei von Öl, Fett oder anderen rutschigen Substanzen?", norm: "DGUV 208-016", critical: false },
  { id: "q_lack", section: "Oberfläche & Zustand", text: "Ist die Oberflächenbeschichtung (Lack, Eloxierung) intakt und schützend?", norm: "DGUV 208-016", critical: false },
];

const TYPE_SPECIFIC = {
  stehleiter: [
    { id: "q_spreiz_sicherung", section: "Spreizsicherung", text: "Ist die Spreizsicherung (Ketten, Gurte, Scheren) vorhanden und funktionsfähig?", norm: "DIN EN 131-2", critical: true },
    { id: "q_spreiz_arretierung", section: "Spreizsicherung", text: "Rastet die Spreizsicherung sicher ein und verhindert unbeabsichtigtes Zusammenklappen?", norm: "DIN EN 131-2", critical: true },
    { id: "q_plattform", section: "Plattform", text: "Ist die Plattform/obere Stufe vollständig und in gutem Zustand (falls vorhanden)?", norm: "DIN EN 131-2", critical: true },
  ],
  anlegeleiter: [
    { id: "q_anlege_haken", section: "Einhängevorrichtung", text: "Sind Einhängehaken oder Anlagevorrichtungen vorhanden und funktionsfähig (falls vorhanden)?", norm: "DIN EN 131-2", critical: false },
    { id: "q_anlege_fuss", section: "Standsicherheit", text: "Ist eine Fußverbreiterung oder Kopfanlage vorhanden und funktionsfähig (falls erforderlich)?", norm: "DGUV 208-016", critical: false },
  ],
  mehrzweckleiter: [
    { id: "q_mzw_gelenke", section: "Gelenke & Scharniere", text: "Sind alle Gelenke und Scharniere funktionsfähig und leichtgängig?", norm: "DGUV 208-016", critical: true },
    { id: "q_mzw_arretierung", section: "Gelenke & Scharniere", text: "Rasten die Gelenke in allen vorgesehenen Positionen sicher ein?", norm: "DIN EN 131-4", critical: true },
    { id: "q_mzw_schiebe", section: "Schiebeführung", text: "Funktioniert der Schiebeauszug leichtgängig und arretiert sicher?", norm: "DIN EN 131-2", critical: true },
    { id: "q_mzw_spreiz", section: "Spreizsicherung", text: "Ist die Spreizsicherung (bei Nutzung als Stehleiter) vorhanden und funktionsfähig?", norm: "DIN EN 131-2", critical: true },
  ],
  trittleiter: [
    { id: "q_tritt_plattform", section: "Trittfläche", text: "Ist die Trittfläche/Plattform rutschhemmend und unbeschädigt?", norm: "DIN EN 14183", critical: true },
    { id: "q_tritt_klapp", section: "Klappmechanismus", text: "Funktioniert der Klappmechanismus einwandfrei und arretiert sicher?", norm: "DIN EN 14183", critical: true },
  ],
  schiebeleiter: [
    { id: "q_schiebe_fuehrung", section: "Schiebeführung", text: "Gleiten die Leiterteile leichtgängig und ohne Verkanten in der Führung?", norm: "DIN EN 131-2", critical: true },
    { id: "q_schiebe_arret", section: "Arretierung", text: "Funktioniert die Höhenarretierung (Fallhaken/Rastmechanik) zuverlässig?", norm: "DIN EN 131-2", critical: true },
    { id: "q_schiebe_seil", section: "Seilzug", text: "Ist der Seilzug (falls vorhanden) unbeschädigt und leichtgängig?", norm: "DIN EN 131-2", critical: false },
  ],
  podestleiter: [
    { id: "q_podest_plattform", section: "Plattform", text: "Ist die Arbeitsplattform vollständig, rutschhemmend und tragfähig?", norm: "DIN EN 131-7", critical: true },
    { id: "q_podest_gelaender", section: "Geländer", text: "Ist das Sicherheitsgeländer vorhanden, vollständig und stabil?", norm: "DIN EN 131-7", critical: true },
    { id: "q_podest_rollen", section: "Rollen", text: "Funktionieren die Rollen und deren Arretierung einwandfrei (falls vorhanden)?", norm: "DIN EN 131-7", critical: false },
  ],
};

function getQuestionsForType(typeId) {
  return [...BASE_QUESTIONS, ...(TYPE_SPECIFIC[typeId] || [])];
}

// ─── PDF Generation ───
function generatePDFContent(inspection, ladder, questions) {
  const pass = inspection.result === "bestanden";
  const d = new Date(inspection.date);
  const dateStr = d.toLocaleDateString("de-DE");
  const nextDate = new Date(inspection.nextDate).toLocaleDateString("de-DE");

  const sectionMap = {};
  questions.forEach(q => {
    if (!sectionMap[q.section]) sectionMap[q.section] = [];
    sectionMap[q.section].push(q);
  });

  let rows = "";
  Object.entries(sectionMap).forEach(([section, qs]) => {
    rows += `<tr><td colspan="4" style="background:#1a2332;color:#e8dcc8;font-weight:700;padding:10px 12px;font-size:11px;letter-spacing:0.5px;text-transform:uppercase;">${section}</td></tr>`;
    qs.forEach(q => {
      const a = inspection.answers[q.id];
      const status = a === "ok" ? "✓ i.O." : a === "mangel" ? "✗ Mangel" : a === "na" ? "— n.z." : "—";
      const color = a === "ok" ? "#2d6a4f" : a === "mangel" ? "#c1121f" : "#666";
      const note = inspection.notes[q.id] || "";
      rows += `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #ddd;font-size:10px;width:45%;">${q.text}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #ddd;font-size:9px;color:#888;width:15%;">${q.norm}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd;font-size:10px;color:${color};font-weight:700;text-align:center;width:12%;">${status}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #ddd;font-size:10px;width:28%;">${note}</td>
      </tr>`;
    });
  });

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 11px; line-height: 1.4; }
  .header { background: linear-gradient(135deg, #1a2332 0%, #2c3e50 100%); color: #e8dcc8; padding: 24px 28px; border-radius: 6px; margin-bottom: 20px; }
  .header h1 { margin: 0 0 4px 0; font-size: 20px; letter-spacing: 1px; }
  .header p { margin: 2px 0; font-size: 10px; opacity: 0.8; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .meta-box { border: 1px solid #ddd; border-radius: 6px; padding: 14px 16px; }
  .meta-box h3 { margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #1a2332; border-bottom: 2px solid #c9a96e; padding-bottom: 4px; }
  .meta-box p { margin: 3px 0; font-size: 10px; }
  .meta-box span { font-weight: 700; }
  .result-box { text-align: center; padding: 16px; border-radius: 6px; margin-bottom: 20px; font-size: 16px; font-weight: 700; }
  .result-pass { background: #d4edda; color: #155724; border: 2px solid #2d6a4f; }
  .result-fail { background: #f8d7da; color: #721c24; border: 2px solid #c1121f; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  .footer { margin-top: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .sig-line { border-top: 1px solid #333; padding-top: 6px; font-size: 10px; margin-top: 50px; }
  .legal { font-size: 8px; color: #888; margin-top: 20px; border-top: 1px solid #ddd; padding-top: 8px; }
</style></head><body>
<div class="header">
  <h1>PRÜFPROTOKOLL — Leiterprüfung</h1>
  <p>Sicht- und Funktionsprüfung gem. DGUV Information 208-016 / BetrSichV §14 / DIN EN 131</p>
  <p>Protokoll-Nr.: ${inspection.id} | Erstellt: ${dateStr}</p>
</div>
<div class="meta-grid">
  <div class="meta-box">
    <h3>Geprüftes Arbeitsmittel</h3>
    <p>Inventar-Nr.: <span>${ladder.inventoryNr}</span></p>
    <p>Bezeichnung: <span>${ladder.name}</span></p>
    <p>Typ: <span>${LADDER_TYPES.find(t=>t.id===ladder.type)?.label||ladder.type}</span></p>
    <p>Hersteller: <span>${ladder.manufacturer||"—"}</span></p>
    <p>Material: <span>${ladder.material||"—"}</span></p>
    <p>Baujahr: <span>${ladder.year||"—"}</span></p>
    <p>Standort: <span>${ladder.location||"—"}</span></p>
  </div>
  <div class="meta-box">
    <h3>Prüfung</h3>
    <p>Prüfdatum: <span>${dateStr}</span></p>
    <p>Prüfer: <span>${inspection.inspector||"—"}</span></p>
    <p>Nächste Prüfung: <span>${nextDate}</span></p>
    <p>Prüfgrundlage: <span>DGUV I 208-016, BetrSichV, DIN EN 131</span></p>
    <p>Prüfart: <span>Sicht- und Funktionsprüfung</span></p>
  </div>
</div>
<div class="result-box ${pass?"result-pass":"result-fail"}">
  Prüfergebnis: ${pass ? "BESTANDEN — Leiter darf weiter verwendet werden" : "NICHT BESTANDEN — Leiter ist gesperrt / Mängel beheben"}
</div>
<table>${rows}</table>
${inspection.generalNotes ? `<div class="meta-box"><h3>Allgemeine Bemerkungen</h3><p>${inspection.generalNotes}</p></div>` : ""}
<div class="footer">
  <div><div class="sig-line">Unterschrift Prüfer/in</div></div>
  <div><div class="sig-line">Unterschrift Verantwortliche/r</div></div>
</div>
<div class="legal">
  Prüfgrundlagen: Arbeitsschutzgesetz (ArbSchG), Betriebssicherheitsverordnung (BetrSichV) §3 Abs. 3, §14, TRBS 1201, TRBS 2121 Teil 2, DGUV Information 208-016, DIN EN 131-1 bis -4, DIN EN 14183.<br/>
  Dieses Protokoll dient als Nachweis der wiederkehrenden Prüfung gem. §14 BetrSichV und ist Bestandteil des Leiterprüfbuches. Aufbewahrungsfrist: Mindestens bis zur nächsten Prüfung, empfohlen: gesamte Lebensdauer des Arbeitsmittels.
</div>
</body></html>`;
}

// ─── Main App ───
const VIEWS = { DASHBOARD: 0, LADDERS: 1, INSPECTION: 2, HISTORY: 3, SETTINGS: 4 };

export default function App() {
  const [view, setView] = useState(VIEWS.DASHBOARD);
  const [ladders, setLadders] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [settings, setSettings] = useState({ inspector: "", company: "BRK Bereitschaft Großheubach", interval: 12 });
  const [loading, setLoading] = useState(true);
  const [selectedLadder, setSelectedLadder] = useState(null);
  const [editLadder, setEditLadder] = useState(null);
  const [inspectionState, setInspectionState] = useState(null);
  const [viewInspection, setViewInspection] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    setLadders(loadData(LADDERS_KEY, []));
    setInspections(loadData(INSPECTIONS_KEY, []));
    setSettings(loadData(PRUEFER_KEY, { inspector: "", company: "BRK Bereitschaft Großheubach", interval: 12 }));
    setLoading(false);
  }, []);

  const saveLadders = (l) => { setLadders(l); saveData(LADDERS_KEY, l); };
  const saveInspections = (i) => { setInspections(i); saveData(INSPECTIONS_KEY, i); };
  const saveSettings = (s) => { setSettings(s); saveData(PRUEFER_KEY, s); };

  const getLastInspection = (ladderId) => {
    return inspections.filter(i => i.ladderId === ladderId).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  };

  const getNextDue = (ladderId) => {
    const last = getLastInspection(ladderId);
    if (!last) return null;
    return new Date(last.nextDate);
  };

  const isOverdue = (ladderId) => {
    const next = getNextDue(ladderId);
    return next && next < new Date();
  };

  const stats = {
    total: ladders.length,
    overdue: ladders.filter(l => isOverdue(l.id)).length,
    ok: ladders.filter(l => { const li = getLastInspection(l.id); return li && li.result === "bestanden" && !isOverdue(l.id); }).length,
    never: ladders.filter(l => !getLastInspection(l.id)).length,
  };

  if (loading) return (
    <div style={styles.loadScreen}>
      <div style={styles.loadIcon}>⊼</div>
      <div style={styles.loadText}>Leiterprüfung wird geladen...</div>
    </div>
  );

  return (
    <div style={styles.shell}>
      {toast && <div style={{ ...styles.toast, background: toast.type === "success" ? "#2d6a4f" : "#c1121f" }}>{toast.msg}</div>}

      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>⊼</div>
          <div>
            <div style={styles.headerTitle}>Leiterprüfung</div>
            <div style={styles.headerSub}>DGUV 208-016 · BetrSichV · DIN EN 131</div>
          </div>
        </div>
        <button style={styles.menuBtn} onClick={() => setMenuOpen(!menuOpen)}>
          <span style={styles.menuIcon}>{menuOpen ? "✕" : "☰"}</span>
        </button>
      </header>

      {menuOpen && <div style={styles.overlay} onClick={() => setMenuOpen(false)} />}
      <nav style={{ ...styles.mobileNav, transform: menuOpen ? "translateX(0)" : "translateX(-100%)" }}>
        {[
          { v: VIEWS.DASHBOARD, icon: "◉", label: "Dashboard" },
          { v: VIEWS.LADDERS, icon: "⊼", label: "Leiterdatenbank" },
          { v: VIEWS.INSPECTION, icon: "☑", label: "Neue Prüfung" },
          { v: VIEWS.HISTORY, icon: "⏱", label: "Prüfhistorie" },
          { v: VIEWS.SETTINGS, icon: "⚙", label: "Einstellungen" },
        ].map(n => (
          <button key={n.v} style={{ ...styles.navItem, ...(view === n.v ? styles.navItemActive : {}) }} onClick={() => { setView(n.v); setMenuOpen(false); }}>
            <span style={styles.navIcon}>{n.icon}</span>{n.label}
          </button>
        ))}
      </nav>

      <nav style={styles.tabBar}>
        {[
          { v: VIEWS.DASHBOARD, icon: "◉", label: "Home" },
          { v: VIEWS.LADDERS, icon: "⊼", label: "Leitern" },
          { v: VIEWS.INSPECTION, icon: "☑", label: "Prüfung" },
          { v: VIEWS.HISTORY, icon: "⏱", label: "Historie" },
          { v: VIEWS.SETTINGS, icon: "⚙", label: "Mehr" },
        ].map(n => (
          <button key={n.v} style={{ ...styles.tabItem, ...(view === n.v ? styles.tabItemActive : {}) }} onClick={() => setView(n.v)}>
            <span style={{ fontSize: 20 }}>{n.icon}</span>
            <span style={{ fontSize: 10, marginTop: 2 }}>{n.label}</span>
          </button>
        ))}
      </nav>

      <main style={styles.main}>
        {view === VIEWS.DASHBOARD && <DashboardView stats={stats} ladders={ladders} inspections={inspections} getLastInspection={getLastInspection} isOverdue={isOverdue} getNextDue={getNextDue} onStartInspection={(l) => { setSelectedLadder(l); setView(VIEWS.INSPECTION); }} />}
        {view === VIEWS.LADDERS && <LaddersView ladders={ladders} saveLadders={saveLadders} editLadder={editLadder} setEditLadder={setEditLadder} getLastInspection={getLastInspection} isOverdue={isOverdue} showToast={showToast} />}
        {view === VIEWS.INSPECTION && <InspectionView ladders={ladders} selectedLadder={selectedLadder} setSelectedLadder={setSelectedLadder} inspectionState={inspectionState} setInspectionState={setInspectionState} inspections={inspections} saveInspections={saveInspections} settings={settings} showToast={showToast} setView={setView} />}
        {view === VIEWS.HISTORY && <HistoryView inspections={inspections} ladders={ladders} viewInspection={viewInspection} setViewInspection={setViewInspection} saveInspections={saveInspections} showToast={showToast} />}
        {view === VIEWS.SETTINGS && <SettingsView settings={settings} saveSettings={saveSettings} showToast={showToast} />}
      </main>
    </div>
  );
}

// ─── Dashboard ───
function DashboardView({ stats, ladders, getLastInspection, isOverdue, getNextDue, onStartInspection }) {
  const overdueLadders = ladders.filter(l => isOverdue(l.id));
  const neverInspected = ladders.filter(l => !getLastInspection(l.id));
  const upcoming = ladders
    .filter(l => { const n = getNextDue(l.id); return n && n >= new Date(); })
    .sort((a, b) => getNextDue(a.id) - getNextDue(b.id))
    .slice(0, 5);

  return (
    <div style={styles.page}>
      <h2 style={styles.pageTitle}>Dashboard</h2>
      <div style={styles.statGrid}>
        <div style={{ ...styles.statCard, borderLeft: "4px solid #2d6a4f" }}><div style={styles.statNum}>{stats.total}</div><div style={styles.statLabel}>Leitern gesamt</div></div>
        <div style={{ ...styles.statCard, borderLeft: "4px solid #2d6a4f" }}><div style={{ ...styles.statNum, color: "#2d6a4f" }}>{stats.ok}</div><div style={styles.statLabel}>Geprüft & i.O.</div></div>
        <div style={{ ...styles.statCard, borderLeft: "4px solid #c1121f" }}><div style={{ ...styles.statNum, color: "#c1121f" }}>{stats.overdue}</div><div style={styles.statLabel}>Überfällig</div></div>
        <div style={{ ...styles.statCard, borderLeft: "4px solid #e09f3e" }}><div style={{ ...styles.statNum, color: "#e09f3e" }}>{stats.never}</div><div style={styles.statLabel}>Nie geprüft</div></div>
      </div>

      {(overdueLadders.length > 0 || neverInspected.length > 0) && (
        <div style={styles.alertBox}>
          <div style={styles.alertTitle}>⚠ Handlungsbedarf</div>
          {overdueLadders.map(l => (
            <div key={l.id} style={styles.alertItem}>
              <span style={{ color: "#c1121f", fontWeight: 700 }}>{l.inventoryNr}</span> — {l.name} — Prüfung überfällig seit {getNextDue(l.id)?.toLocaleDateString("de-DE")}
              <button style={styles.alertBtn} onClick={() => onStartInspection(l)}>Jetzt prüfen</button>
            </div>
          ))}
          {neverInspected.map(l => (
            <div key={l.id} style={styles.alertItem}>
              <span style={{ color: "#e09f3e", fontWeight: 700 }}>{l.inventoryNr}</span> — {l.name} — Noch nie geprüft
              <button style={styles.alertBtn} onClick={() => onStartInspection(l)}>Jetzt prüfen</button>
            </div>
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Nächste Prüfungen</h3>
          {upcoming.map(l => {
            const nd = getNextDue(l.id);
            const days = Math.ceil((nd - new Date()) / 86400000);
            return (
              <div key={l.id} style={styles.listRow}>
                <div><strong>{l.inventoryNr}</strong> — {l.name}</div>
                <div style={{ fontSize: 12, color: days < 30 ? "#e09f3e" : "#666" }}>{nd.toLocaleDateString("de-DE")} ({days} Tage)</div>
              </div>
            );
          })}
        </div>
      )}

      {ladders.length === 0 && (
        <div style={styles.emptyState}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⊼</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Noch keine Leitern erfasst</div>
          <div style={{ fontSize: 13, color: "#888" }}>Starte mit der Leiterdatenbank und erfasse deine Leitern und Tritte.</div>
        </div>
      )}
    </div>
  );
}

// ─── Ladders Database ───
function LaddersView({ ladders, saveLadders, getLastInspection, isOverdue, showToast }) {
  const [search, setSearch] = useState("");
  const empty = { id: "", inventoryNr: "", name: "", type: "stehleiter", manufacturer: "", material: "Aluminium", year: "", location: "", maxLoad: "", length: "", notes: "" };
  const [form, setForm] = useState(null);

  const filtered = ladders.filter(l =>
    `${l.inventoryNr} ${l.name} ${l.location} ${l.manufacturer}`.toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = () => {
    if (!form.inventoryNr || !form.name) { showToast("Inventar-Nr. und Bezeichnung sind Pflicht!", "error"); return; }
    let updated;
    if (form.id) {
      updated = ladders.map(l => l.id === form.id ? form : l);
    } else {
      form.id = "L" + Date.now();
      updated = [...ladders, form];
    }
    saveLadders(updated);
    setForm(null);
    showToast(form.id ? "Leiter aktualisiert" : "Leiter hinzugefügt");
  };

  const handleDelete = (id) => {
    if (confirm("Leiter wirklich löschen? Prüfhistorie bleibt erhalten.")) {
      saveLadders(ladders.filter(l => l.id !== id));
      showToast("Leiter gelöscht");
    }
  };

  if (form) return (
    <div style={styles.page}>
      <div style={styles.formHeader}>
        <button style={styles.backBtn} onClick={() => setForm(null)}>← Zurück</button>
        <h2 style={styles.pageTitle}>{form.id ? "Leiter bearbeiten" : "Neue Leiter erfassen"}</h2>
      </div>
      <div style={styles.formGrid}>
        <Field label="Inventar-Nr. *" value={form.inventoryNr} onChange={v => setForm({ ...form, inventoryNr: v })} placeholder="z.B. L-001" />
        <Field label="Bezeichnung *" value={form.name} onChange={v => setForm({ ...form, name: v })} placeholder="z.B. Alu-Stehleiter 6 Stufen" />
        <div style={styles.fieldWrap}>
          <label style={styles.fieldLabel}>Leitertyp</label>
          <select style={styles.select} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            {LADDER_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <Field label="Hersteller" value={form.manufacturer} onChange={v => setForm({ ...form, manufacturer: v })} placeholder="z.B. ZARGES" />
        <div style={styles.fieldWrap}>
          <label style={styles.fieldLabel}>Material</label>
          <select style={styles.select} value={form.material} onChange={e => setForm({ ...form, material: e.target.value })}>
            {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <Field label="Baujahr" value={form.year} onChange={v => setForm({ ...form, year: v })} placeholder="z.B. 2020" />
        <Field label="Standort" value={form.location} onChange={v => setForm({ ...form, location: v })} placeholder="z.B. Fahrzeughalle" />
        <Field label="Max. Belastung (kg)" value={form.maxLoad} onChange={v => setForm({ ...form, maxLoad: v })} placeholder="z.B. 150" />
        <Field label="Länge / Höhe" value={form.length} onChange={v => setForm({ ...form, length: v })} placeholder="z.B. 2,40m" />
      </div>
      <div style={styles.fieldWrap}>
        <label style={styles.fieldLabel}>Bemerkungen</label>
        <textarea style={styles.textarea} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Besonderheiten, Zubehör, etc." />
      </div>
      <button style={styles.primaryBtn} onClick={handleSave}>💾 Speichern</button>
    </div>
  );

  return (
    <div style={styles.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 style={styles.pageTitle}>Leiterdatenbank ({ladders.length})</h2>
        <button style={styles.primaryBtn} onClick={() => setForm({ ...empty })}>+ Neue Leiter</button>
      </div>
      <input style={styles.searchInput} placeholder="🔍 Suchen nach Nr., Name, Standort..." value={search} onChange={e => setSearch(e.target.value)} />

      {filtered.length === 0 && <div style={styles.emptyState}><div style={{ fontSize: 36 }}>📋</div><div>Keine Leitern gefunden</div></div>}

      {filtered.map(l => {
        const li = getLastInspection(l.id);
        const od = isOverdue(l.id);
        const typeObj = LADDER_TYPES.find(t => t.id === l.type);
        return (
          <div key={l.id} style={{ ...styles.ladderCard, borderLeft: `4px solid ${od ? "#c1121f" : li ? "#2d6a4f" : "#e09f3e"}` }}>
            <div style={styles.ladderTop}>
              <div>
                <div style={styles.ladderNr}>{l.inventoryNr}</div>
                <div style={styles.ladderName}>{l.name}</div>
                <div style={styles.ladderMeta}>{typeObj?.label} · {l.material} · {l.location || "—"}</div>
              </div>
              <div style={{ ...styles.statusBadge, background: od ? "#fce4e4" : li ? "#d4edda" : "#fff3cd", color: od ? "#c1121f" : li ? "#2d6a4f" : "#856404" }}>
                {od ? "Überfällig" : li ? "Geprüft" : "Offen"}
              </div>
            </div>
            {li && <div style={styles.ladderLastCheck}>Letzte Prüfung: {new Date(li.date).toLocaleDateString("de-DE")} — {li.result === "bestanden" ? "✓ Bestanden" : "✗ Nicht bestanden"}</div>}
            <div style={styles.ladderActions}>
              <button style={styles.smallBtn} onClick={() => setForm({ ...l })}>✏ Bearbeiten</button>
              <button style={{ ...styles.smallBtn, color: "#c1121f" }} onClick={() => handleDelete(l.id)}>🗑 Löschen</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Inspection ───
function InspectionView({ ladders, selectedLadder, setSelectedLadder, inspectionState, setInspectionState, inspections, saveInspections, settings, showToast, setView }) {
  const [step, setStep] = useState(selectedLadder ? 1 : 0);
  const [answers, setAnswers] = useState({});
  const [notes, setNotes] = useState({});
  const [generalNotes, setGeneralNotes] = useState("");
  const [currentSection, setCurrentSection] = useState(0);

  const questions = selectedLadder ? getQuestionsForType(selectedLadder.type) : [];
  const sections = [...new Set(questions.map(q => q.section))];
  const sectionQuestions = sections.map(s => questions.filter(q => q.section === s));

  const allAnswered = questions.every(q => answers[q.id]);
  const hasCriticalFail = questions.some(q => q.critical && answers[q.id] === "mangel");
  const hasAnyFail = questions.some(q => answers[q.id] === "mangel");
  const result = hasCriticalFail ? "nicht_bestanden" : (hasAnyFail ? "bedingt" : "bestanden");
  const progress = questions.length > 0 ? Math.round((Object.keys(answers).length / questions.length) * 100) : 0;

  const handleFinish = () => {
    const now = new Date();
    const nextDate = new Date(now);
    nextDate.setMonth(nextDate.getMonth() + (settings.interval || 12));

    const inspection = {
      id: "P" + Date.now(),
      ladderId: selectedLadder.id,
      date: now.toISOString(),
      nextDate: nextDate.toISOString(),
      inspector: settings.inspector || "—",
      answers,
      notes,
      generalNotes,
      result: hasCriticalFail || hasAnyFail ? "nicht_bestanden" : "bestanden",
    };
    saveInspections([...inspections, inspection]);
    showToast("Prüfung gespeichert!");
    setStep(3);
    setInspectionState(inspection);
  };

  const handlePDF = () => {
    const html = generatePDFContent(inspectionState, selectedLadder, questions);
    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  const reset = () => {
    setSelectedLadder(null);
    setAnswers({});
    setNotes({});
    setGeneralNotes("");
    setCurrentSection(0);
    setStep(0);
    setInspectionState(null);
  };

  if (step === 0) {
    return (
      <div style={styles.page}>
        <h2 style={styles.pageTitle}>Neue Prüfung starten</h2>
        <p style={{ color: "#666", marginBottom: 16, fontSize: 14 }}>Wähle die zu prüfende Leiter aus:</p>
        {ladders.length === 0 ? (
          <div style={styles.emptyState}><div style={{ fontSize: 36 }}>⊼</div><div>Bitte zuerst Leitern in der Datenbank erfassen.</div></div>
        ) : (
          ladders.map(l => {
            const typeObj = LADDER_TYPES.find(t => t.id === l.type);
            return (
              <button key={l.id} style={styles.selectLadderBtn} onClick={() => { setSelectedLadder(l); setStep(1); setAnswers({}); setNotes({}); setCurrentSection(0); }}>
                <div style={{ fontWeight: 700 }}>{l.inventoryNr} — {l.name}</div>
                <div style={{ fontSize: 12, color: "#888" }}>{typeObj?.label} · {l.location || "—"}</div>
              </button>
            );
          })
        )}
      </div>
    );
  }

  if (step === 3) {
    return (
      <div style={styles.page}>
        <div style={styles.doneBox}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>{inspectionState?.result === "bestanden" ? "✅" : "❌"}</div>
          <h2 style={{ margin: "0 0 8px 0" }}>{inspectionState?.result === "bestanden" ? "Prüfung bestanden" : "Prüfung nicht bestanden"}</h2>
          <p style={{ color: "#666", fontSize: 14 }}>Nächste Prüfung: {new Date(inspectionState?.nextDate).toLocaleDateString("de-DE")}</p>
          <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap", justifyContent: "center" }}>
            <button style={styles.primaryBtn} onClick={handlePDF}>📄 PDF Protokoll</button>
            <button style={styles.secondaryBtn} onClick={reset}>Neue Prüfung</button>
            <button style={styles.secondaryBtn} onClick={() => { reset(); setView(VIEWS.DASHBOARD); }}>Zum Dashboard</button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div style={styles.page}>
        <button style={styles.backBtn} onClick={() => setStep(1)}>← Zurück zur Prüfung</button>
        <h2 style={styles.pageTitle}>Zusammenfassung</h2>
        <div style={{ ...styles.resultBox, background: result === "bestanden" ? "#d4edda" : "#f8d7da", borderColor: result === "bestanden" ? "#2d6a4f" : "#c1121f", color: result === "bestanden" ? "#155724" : "#721c24" }}>
          {result === "bestanden" ? "✓ BESTANDEN" : "✗ NICHT BESTANDEN"}
        </div>
        <div style={styles.summaryInfo}>
          <div><strong>Leiter:</strong> {selectedLadder.inventoryNr} — {selectedLadder.name}</div>
          <div><strong>Prüfer:</strong> {settings.inspector || "—"}</div>
          <div><strong>Mängel:</strong> {questions.filter(q => answers[q.id] === "mangel").length} von {questions.length} Prüfpunkten</div>
        </div>
        {questions.filter(q => answers[q.id] === "mangel").length > 0 && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Festgestellte Mängel</h3>
            {questions.filter(q => answers[q.id] === "mangel").map(q => (
              <div key={q.id} style={styles.mangelItem}>
                <div style={{ fontWeight: 600, color: "#c1121f" }}>{q.critical ? "⚠ Kritisch: " : ""}{q.text}</div>
                {notes[q.id] && <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Anmerkung: {notes[q.id]}</div>}
              </div>
            ))}
          </div>
        )}
        <div style={styles.fieldWrap}>
          <label style={styles.fieldLabel}>Allgemeine Bemerkungen</label>
          <textarea style={styles.textarea} value={generalNotes} onChange={e => setGeneralNotes(e.target.value)} rows={3} placeholder="Ergänzende Hinweise zur Prüfung..." />
        </div>
        <button style={styles.primaryBtn} onClick={handleFinish}>✓ Prüfung abschließen & speichern</button>
      </div>
    );
  }

  const curQuestions = sectionQuestions[currentSection] || [];

  return (
    <div style={styles.page}>
      <div style={styles.inspHeader}>
        <button style={styles.backBtn} onClick={() => { if (confirm("Prüfung abbrechen?")) reset(); }}>✕ Abbrechen</button>
        <div style={styles.inspMeta}><strong>{selectedLadder.inventoryNr}</strong> — {selectedLadder.name}</div>
      </div>

      <div style={styles.progressWrap}>
        <div style={styles.progressBar}><div style={{ ...styles.progressFill, width: `${progress}%` }} /></div>
        <div style={styles.progressText}>{progress}% · {Object.keys(answers).length}/{questions.length} Prüfpunkte</div>
      </div>

      <div style={styles.sectionTabs}>
        {sections.map((s, i) => {
          const sqCount = sectionQuestions[i].length;
          const sqDone = sectionQuestions[i].filter(q => answers[q.id]).length;
          const hasMangel = sectionQuestions[i].some(q => answers[q.id] === "mangel");
          return (
            <button key={s} style={{ ...styles.sectionTab, ...(i === currentSection ? styles.sectionTabActive : {}), ...(hasMangel ? { borderColor: "#c1121f" } : sqDone === sqCount && sqCount > 0 ? { borderColor: "#2d6a4f" } : {}) }} onClick={() => setCurrentSection(i)}>
              <span style={{ fontSize: 11 }}>{s}</span>
              <span style={{ fontSize: 10, color: "#888" }}>{sqDone}/{sqCount}</span>
            </button>
          );
        })}
      </div>

      <div style={styles.questionList}>
        {curQuestions.map(q => (
          <div key={q.id} style={{ ...styles.questionCard, borderLeft: `3px solid ${answers[q.id] === "ok" ? "#2d6a4f" : answers[q.id] === "mangel" ? "#c1121f" : answers[q.id] === "na" ? "#888" : "#ddd"}` }}>
            <div style={styles.qText}>
              {q.critical && <span style={styles.critBadge}>Kritisch</span>}
              {q.text}
            </div>
            <div style={styles.qNorm}>{q.norm}</div>
            <div style={styles.answerRow}>
              {[
                { val: "ok", label: "i.O.", color: "#2d6a4f", bg: "#d4edda" },
                { val: "mangel", label: "Mangel", color: "#c1121f", bg: "#f8d7da" },
                { val: "na", label: "n.z.", color: "#666", bg: "#e9ecef" },
              ].map(opt => (
                <button key={opt.val} style={{ ...styles.answerBtn, ...(answers[q.id] === opt.val ? { background: opt.bg, color: opt.color, borderColor: opt.color, fontWeight: 700 } : {}) }} onClick={() => setAnswers({ ...answers, [q.id]: opt.val })}>
                  {opt.label}
                </button>
              ))}
            </div>
            {answers[q.id] === "mangel" && (
              <input style={styles.noteInput} placeholder="Mangel beschreiben..." value={notes[q.id] || ""} onChange={e => setNotes({ ...notes, [q.id]: e.target.value })} />
            )}
          </div>
        ))}
      </div>

      <div style={styles.inspNav}>
        {currentSection > 0 && <button style={styles.secondaryBtn} onClick={() => setCurrentSection(currentSection - 1)}>← Zurück</button>}
        {currentSection < sections.length - 1 ? (
          <button style={styles.primaryBtn} onClick={() => setCurrentSection(currentSection + 1)}>Weiter →</button>
        ) : (
          <button style={{ ...styles.primaryBtn, opacity: allAnswered ? 1 : 0.5 }} onClick={() => { if (allAnswered) setStep(2); else showToast("Bitte alle Prüfpunkte beantworten", "error"); }}>
            Zur Zusammenfassung →
          </button>
        )}
      </div>
    </div>
  );
}

// ─── History ───
function HistoryView({ inspections, ladders, saveInspections, showToast }) {
  const sorted = [...inspections].sort((a, b) => new Date(b.date) - new Date(a.date));

  const handlePDF = (insp) => {
    const ladder = ladders.find(l => l.id === insp.ladderId) || { inventoryNr: "?", name: "Gelöscht", type: "stehleiter", manufacturer: "", material: "", year: "", location: "" };
    const questions = getQuestionsForType(ladder.type);
    const html = generatePDFContent(insp, ladder, questions);
    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  const handleDelete = (id) => {
    if (confirm("Prüfprotokoll wirklich löschen?")) {
      saveInspections(inspections.filter(i => i.id !== id));
      showToast("Protokoll gelöscht");
    }
  };

  return (
    <div style={styles.page}>
      <h2 style={styles.pageTitle}>Prüfhistorie ({inspections.length})</h2>
      {sorted.length === 0 && <div style={styles.emptyState}><div style={{ fontSize: 36 }}>📋</div><div>Noch keine Prüfungen durchgeführt.</div></div>}
      {sorted.map(insp => {
        const ladder = ladders.find(l => l.id === insp.ladderId);
        const pass = insp.result === "bestanden";
        return (
          <div key={insp.id} style={{ ...styles.historyCard, borderLeft: `4px solid ${pass ? "#2d6a4f" : "#c1121f"}` }}>
            <div style={styles.historyTop}>
              <div>
                <div style={styles.historyDate}>{new Date(insp.date).toLocaleDateString("de-DE")}</div>
                <div style={styles.historyLadder}>{ladder ? `${ladder.inventoryNr} — ${ladder.name}` : "Leiter gelöscht"}</div>
                <div style={styles.historyMeta}>Prüfer: {insp.inspector} · Protokoll: {insp.id}</div>
              </div>
              <div style={{ ...styles.statusBadge, background: pass ? "#d4edda" : "#f8d7da", color: pass ? "#2d6a4f" : "#c1121f" }}>
                {pass ? "Bestanden" : "Nicht best."}
              </div>
            </div>
            <div style={styles.historyActions}>
              <button style={styles.smallBtn} onClick={() => handlePDF(insp)}>📄 PDF</button>
              <button style={{ ...styles.smallBtn, color: "#c1121f" }} onClick={() => handleDelete(insp.id)}>🗑</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Settings ───
function SettingsView({ settings, saveSettings, showToast }) {
  const [form, setForm] = useState({ ...settings });

  const handleSave = () => {
    saveSettings(form);
    showToast("Einstellungen gespeichert");
  };

  return (
    <div style={styles.page}>
      <h2 style={styles.pageTitle}>Einstellungen</h2>
      <Field label="Name des Prüfers / Befähigte Person" value={form.inspector} onChange={v => setForm({ ...form, inspector: v })} placeholder="Vor- und Nachname" />
      <Field label="Organisation / Unternehmen" value={form.company} onChange={v => setForm({ ...form, company: v })} placeholder="z.B. BRK Bereitschaft Großheubach" />
      <div style={styles.fieldWrap}>
        <label style={styles.fieldLabel}>Standard-Prüfintervall (Monate)</label>
        <select style={styles.select} value={form.interval} onChange={e => setForm({ ...form, interval: parseInt(e.target.value) })}>
          {[3, 6, 9, 12, 18, 24].map(m => <option key={m} value={m}>{m} Monate</option>)}
        </select>
      </div>
      <button style={styles.primaryBtn} onClick={handleSave}>💾 Speichern</button>

      <div style={styles.legalBox}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: 13 }}>Rechtsgrundlagen</h3>
        <div style={{ fontSize: 11, lineHeight: 1.6, color: "#666" }}>
          <strong>Arbeitsschutzgesetz (ArbSchG)</strong> — Grundlegende Pflichten des Arbeitgebers<br />
          <strong>Betriebssicherheitsverordnung (BetrSichV)</strong> §3, §14 — Bereitstellung und Prüfung von Arbeitsmitteln<br />
          <strong>TRBS 1201</strong> — Prüfungen von Arbeitsmitteln<br />
          <strong>TRBS 2121 Teil 2</strong> — Gefährdung bei der Verwendung von Leitern<br />
          <strong>DGUV Information 208-016</strong> — Handlungsanleitung Leitern und Tritte<br />
          <strong>DIN EN 131-1 bis -4</strong> — Leitern: Benennungen, Bauarten, Anforderungen<br />
          <strong>DIN EN 14183</strong> — Tritte<br />
          <strong>TRBS 1203</strong> — Befähigte Personen
        </div>
      </div>
    </div>
  );
}

// ─── Shared Components ───
function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div style={styles.fieldWrap}>
      <label style={styles.fieldLabel}>{label}</label>
      <input style={styles.input} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// ─── Styles ───
const styles = {
  shell: { fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif", minHeight: "100vh", background: "#f5f0e8", color: "#1a2332", position: "relative", paddingBottom: 72 },
  loadScreen: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#1a2332", color: "#e8dcc8" },
  loadIcon: { fontSize: 64, marginBottom: 16 },
  loadText: { fontSize: 14, letterSpacing: 1 },

  header: { background: "linear-gradient(135deg, #1a2332 0%, #2c3e50 100%)", color: "#e8dcc8", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(0,0,0,0.15)" },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  logo: { fontSize: 28, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(201,169,110,0.15)", borderRadius: 10 },
  headerTitle: { fontSize: 17, fontWeight: 700, letterSpacing: 0.5 },
  headerSub: { fontSize: 10, opacity: 0.6, letterSpacing: 0.5 },
  menuBtn: { background: "none", border: "none", color: "#e8dcc8", cursor: "pointer", padding: 8 },
  menuIcon: { fontSize: 22 },

  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200 },
  mobileNav: { position: "fixed", top: 0, left: 0, bottom: 0, width: 260, background: "#1a2332", zIndex: 300, transition: "transform 0.25s ease", paddingTop: 60, display: "flex", flexDirection: "column", gap: 2 },
  navItem: { display: "flex", alignItems: "center", gap: 12, padding: "14px 24px", background: "none", border: "none", color: "#e8dcc8", fontSize: 14, cursor: "pointer", textAlign: "left", width: "100%", transition: "background 0.15s" },
  navItemActive: { background: "rgba(201,169,110,0.15)", borderRight: "3px solid #c9a96e" },
  navIcon: { fontSize: 18, width: 24, textAlign: "center" },

  tabBar: { position: "fixed", bottom: 0, left: 0, right: 0, background: "#1a2332", display: "flex", zIndex: 100, boxShadow: "0 -2px 12px rgba(0,0,0,0.15)", paddingBottom: "env(safe-area-inset-bottom, 0px)" },
  tabItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0", background: "none", border: "none", color: "#e8dcc899", cursor: "pointer", transition: "color 0.15s" },
  tabItemActive: { color: "#c9a96e" },

  main: { maxWidth: 680, margin: "0 auto", padding: "0 0 20px 0" },
  page: { padding: "20px 16px" },
  pageTitle: { margin: "0 0 16px 0", fontSize: 20, fontWeight: 700, color: "#1a2332", letterSpacing: 0.3 },

  toast: { position: "fixed", top: 76, left: "50%", transform: "translateX(-50%)", color: "#fff", padding: "10px 24px", borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 999, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", animation: "slideDown 0.3s ease" },

  statGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 },
  statCard: { background: "#fff", borderRadius: 10, padding: "16px 14px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" },
  statNum: { fontSize: 28, fontWeight: 800, lineHeight: 1 },
  statLabel: { fontSize: 11, color: "#888", marginTop: 4, letterSpacing: 0.3 },

  alertBox: { background: "#fff8f0", border: "1px solid #f0c78e", borderRadius: 10, padding: 16, marginBottom: 20 },
  alertTitle: { fontWeight: 700, fontSize: 14, marginBottom: 8, color: "#b45309" },
  alertItem: { fontSize: 12, padding: "8px 0", borderTop: "1px solid #f0c78e", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  alertBtn: { background: "#c9a96e", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", marginLeft: "auto" },

  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: 700, margin: "0 0 10px 0", color: "#1a2332" },
  listRow: { padding: "10px 12px", background: "#fff", borderRadius: 8, marginBottom: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },

  emptyState: { textAlign: "center", padding: "40px 20px", color: "#888" },

  ladderCard: { background: "#fff", borderRadius: 10, padding: 16, marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" },
  ladderTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  ladderNr: { fontSize: 11, fontWeight: 700, color: "#c9a96e", letterSpacing: 0.5 },
  ladderName: { fontSize: 15, fontWeight: 700, margin: "2px 0" },
  ladderMeta: { fontSize: 12, color: "#888" },
  ladderLastCheck: { fontSize: 11, color: "#666", marginTop: 8, padding: "6px 0", borderTop: "1px solid #eee" },
  ladderActions: { display: "flex", gap: 8, marginTop: 8 },

  statusBadge: { fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap" },

  searchInput: { width: "100%", padding: "10px 14px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, marginBottom: 16, background: "#fff", boxSizing: "border-box", outline: "none" },

  formHeader: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  fieldWrap: { marginBottom: 12 },
  fieldLabel: { display: "block", fontSize: 11, fontWeight: 600, marginBottom: 4, color: "#555", letterSpacing: 0.3, textTransform: "uppercase" },
  input: { width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, background: "#fff", boxSizing: "border-box", outline: "none" },
  select: { width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, background: "#fff", boxSizing: "border-box", outline: "none" },
  textarea: { width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, background: "#fff", boxSizing: "border-box", resize: "vertical", outline: "none", fontFamily: "inherit" },

  primaryBtn: { background: "linear-gradient(135deg, #1a2332, #2c3e50)", color: "#e8dcc8", border: "none", borderRadius: 8, padding: "12px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%", marginTop: 8, letterSpacing: 0.3 },
  secondaryBtn: { background: "#fff", color: "#1a2332", border: "2px solid #1a2332", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  smallBtn: { background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", color: "#555" },
  backBtn: { background: "none", border: "none", color: "#c9a96e", cursor: "pointer", fontSize: 14, fontWeight: 600, padding: 0 },

  selectLadderBtn: { display: "block", width: "100%", textAlign: "left", background: "#fff", border: "1px solid #ddd", borderRadius: 10, padding: 16, marginBottom: 8, cursor: "pointer", transition: "border-color 0.15s" },

  inspHeader: { marginBottom: 16 },
  inspMeta: { fontSize: 14, marginTop: 8, color: "#1a2332" },

  progressWrap: { marginBottom: 16 },
  progressBar: { height: 6, background: "#e0d8cc", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", background: "linear-gradient(90deg, #c9a96e, #2d6a4f)", borderRadius: 3, transition: "width 0.3s ease" },
  progressText: { fontSize: 11, color: "#888", marginTop: 4 },

  sectionTabs: { display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 16, WebkitOverflowScrolling: "touch" },
  sectionTab: { flexShrink: 0, padding: "8px 12px", background: "#fff", border: "2px solid #ddd", borderRadius: 8, cursor: "pointer", display: "flex", flexDirection: "column", gap: 2, minWidth: 80, textAlign: "center", transition: "all 0.15s" },
  sectionTabActive: { borderColor: "#c9a96e", background: "#faf6ee" },

  questionList: { display: "flex", flexDirection: "column", gap: 10 },
  questionCard: { background: "#fff", borderRadius: 10, padding: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  qText: { fontSize: 13, lineHeight: 1.5, fontWeight: 500, marginBottom: 4 },
  qNorm: { fontSize: 10, color: "#999", marginBottom: 10 },
  critBadge: { display: "inline-block", background: "#f8d7da", color: "#c1121f", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, marginRight: 6, verticalAlign: "middle" },
  answerRow: { display: "flex", gap: 8 },
  answerBtn: { flex: 1, padding: "10px 0", border: "2px solid #ddd", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500, transition: "all 0.15s", textAlign: "center" },
  noteInput: { width: "100%", marginTop: 8, padding: "8px 10px", border: "1px solid #f0c78e", borderRadius: 6, fontSize: 12, background: "#fff8f0", boxSizing: "border-box", outline: "none" },

  inspNav: { display: "flex", gap: 12, marginTop: 20, justifyContent: "space-between" },

  resultBox: { textAlign: "center", padding: 20, borderRadius: 10, border: "2px solid", fontSize: 18, fontWeight: 800, marginBottom: 20 },
  summaryInfo: { background: "#fff", borderRadius: 10, padding: 16, marginBottom: 16, display: "flex", flexDirection: "column", gap: 6, fontSize: 13 },
  mangelItem: { padding: "10px 12px", background: "#fff8f0", borderRadius: 8, marginBottom: 6, borderLeft: "3px solid #c1121f" },

  doneBox: { textAlign: "center", padding: "40px 20px" },

  historyCard: { background: "#fff", borderRadius: 10, padding: 14, marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" },
  historyTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  historyDate: { fontSize: 15, fontWeight: 700 },
  historyLadder: { fontSize: 13, marginTop: 2 },
  historyMeta: { fontSize: 11, color: "#888", marginTop: 4 },
  historyActions: { display: "flex", gap: 8, marginTop: 10 },

  legalBox: { marginTop: 24, background: "#fff", borderRadius: 10, padding: 16, border: "1px solid #ddd" },
};
