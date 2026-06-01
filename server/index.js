const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "16mb" }));
app.use(cors());

// ─── Datenspeicher (JSON-Dateien) ───
const DATA_DIR = process.env.DATA_DIR || "/data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readStore(key) {
  try {
    const file = path.join(DATA_DIR, key + ".json");
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeStore(key, value) {
  const file = path.join(DATA_DIR, key + ".json");
  const tmp  = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, file); // atomischer Schreibvorgang
}

// ─── Zugangsschutz (PIN/Code) ───
// Speichert nur einen Hash des Zugangscodes + ein HMAC-Secret für Tokens.
// Solange kein Code gesetzt ist, bleibt die App offen (Abwärtskompatibilität).
const AUTH_FILE = path.join(DATA_DIR, "auth.json");

function readAuth() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeAuth(value) {
  const tmp = AUTH_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, AUTH_FILE);
}

function hashCode(code, salt) {
  return crypto.scryptSync(String(code), salt, 64).toString("hex");
}

function verifyCode(code, auth) {
  if (!code || !auth || !auth.hash) return false;
  const h = hashCode(code, auth.salt);
  const a = Buffer.from(h, "hex");
  const b = Buffer.from(auth.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 Tage

function issueToken(secret) {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  const sig = crypto.createHmac("sha256", secret).update(exp).digest("hex");
  return Buffer.from(exp).toString("base64") + "." + sig;
}

function validToken(token) {
  const auth = readAuth();
  if (!auth || !auth.secret || !token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const expB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let exp;
  try { exp = Buffer.from(expB64, "base64").toString("utf8"); } catch { return false; }
  const expected = crypto.createHmac("sha256", auth.secret).update(exp).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(exp) > Date.now();
}

function tokenFromReq(req) {
  return (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

// Middleware: schützt schreibende Endpunkte, sobald ein Code gesetzt ist.
function requireAuth(req, res, next) {
  const auth = readAuth();
  if (!auth || !auth.hash) return next(); // kein Code gesetzt → offen
  if (validToken(tokenFromReq(req))) return next();
  return res.status(401).json({ error: "Nicht autorisiert" });
}

// Status: ist ein Zugangscode konfiguriert?
app.get("/auth/status", (_, res) => {
  const auth = readAuth();
  res.json({ configured: !!(auth && auth.hash) });
});

// Gültigkeit eines vorhandenen Tokens prüfen.
app.get("/auth/check", (req, res) => {
  const auth = readAuth();
  if (!auth || !auth.hash) return res.json({ configured: false, valid: true });
  res.json({ configured: true, valid: validToken(tokenFromReq(req)) });
});

// Anmelden mit Code → Token.
app.post("/auth/verify", (req, res) => {
  const auth = readAuth();
  if (!auth || !auth.hash) return res.json({ ok: true, configured: false, token: null });
  if (verifyCode(req.body.code, auth)) {
    return res.json({ ok: true, configured: true, token: issueToken(auth.secret) });
  }
  return res.status(403).json({ ok: false, error: "Zugangscode falsch" });
});

// Code setzen / ändern. Beim Ändern ist der aktuelle Code erforderlich.
app.post("/auth/set", (req, res) => {
  const { newCode, currentCode } = req.body || {};
  if (!newCode || String(newCode).length < 4) {
    return res.status(400).json({ error: "Zugangscode muss mindestens 4 Zeichen haben" });
  }
  const auth = readAuth();
  if (auth && auth.hash && !verifyCode(currentCode, auth)) {
    return res.status(403).json({ error: "Aktueller Zugangscode falsch" });
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const secret = (auth && auth.secret) || crypto.randomBytes(32).toString("hex");
  writeAuth({ hash: hashCode(newCode, salt), salt, secret });
  console.log("[OK] Zugangscode gesetzt/geändert");
  res.json({ ok: true, token: issueToken(secret) });
});

// Code entfernen (App wieder offen). Erfordert aktuellen Code.
app.post("/auth/clear", (req, res) => {
  const auth = readAuth();
  if (auth && auth.hash && !verifyCode((req.body || {}).currentCode, auth)) {
    return res.status(403).json({ error: "Aktueller Zugangscode falsch" });
  }
  try { if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE); } catch {}
  console.log("[OK] Zugangscode entfernt");
  res.json({ ok: true });
});

// ─── Data-API ───
app.get("/health", (_, res) => res.json({ ok: true }));

// Alle gespeicherten Keys auf einmal laden
app.get("/data-all", (req, res) => {
  const keys = ["lp_ladders", "lp_inspections", "lp_locations", "lp_pruefer"];
  const result = {};
  keys.forEach(k => { const v = readStore(k); if (v !== null) result[k] = v; });
  res.json(result);
});

app.get("/data/:key", (req, res) => {
  const value = readStore(req.params.key);
  res.json({ value });
});

app.post("/data/:key", requireAuth, (req, res) => {
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: "value fehlt" });
  writeStore(req.params.key, value);
  res.json({ ok: true });
});

// ─── E-Mail mit PDF-Anhang ───
app.post("/send-email", requireAuth, async (req, res) => {
  const { to, subject, bodyHtml, pdfBase64, pdfFilename, smtp } = req.body;

  if (!to || !smtp?.host || !smtp?.user || !smtp?.pass) {
    return res.status(400).json({ error: "Pflichtfelder fehlen: to, smtp.host, smtp.user, smtp.pass" });
  }

  const port   = parseInt(smtp.port) || 587;
  const secure = smtp.secure === true || port === 465;

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port,
      secure,
      auth: { user: smtp.user, pass: smtp.pass },
      tls: { rejectUnauthorized: false },
    });

    const mailOptions = {
      from: `"DRK Leiterprüfung" <${smtp.user}>`,
      to,
      subject,
      html: bodyHtml || "<p>Prüfprotokoll im Anhang.</p>",
      attachments: [],
    };

    if (pdfBase64) {
      mailOptions.attachments.push({
        filename: pdfFilename || "Pruefprotokoll.pdf",
        content:  Buffer.from(pdfBase64, "base64"),
        contentType: "application/pdf",
      });
    }

    await transporter.sendMail(mailOptions);
    console.log(`[OK] E-Mail an ${to} | ${subject}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[ERR] Mailer: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Öffentliche Prüfungsanfrage (jede Person darf anfragen) ───
// Der Client sendet NUR die ladderId. Empfänger, SMTP und Inhalt werden
// serverseitig aus den gespeicherten Daten zusammengestellt — so kann der
// offene Endpunkt nicht als beliebiges Mail-Relay missbraucht werden.
const TYPE_LABELS = {
  stehleiter: "Stehleiter", anlegeleiter: "Anlegeleiter", mehrzweckleiter: "Mehrzweckleiter",
  trittleiter: "Trittleiter / Tritt", schiebeleiter: "Schiebeleiter", podestleiter: "Podestleiter",
};
const reqCooldown = new Map(); // ladderId -> timestamp (Spam-Schutz, in-memory)
const REQUEST_COOLDOWN_MS = 1000 * 60 * 10; // 10 Minuten pro Leiter

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString("de-DE"); } catch { return "—"; }
}

app.post("/request-inspection", async (req, res) => {
  const { ladderId } = req.body || {};
  if (!ladderId) return res.status(400).json({ error: "ladderId fehlt" });

  const prev = reqCooldown.get(ladderId);
  if (prev && Date.now() - prev < REQUEST_COOLDOWN_MS) {
    return res.status(429).json({ error: "Für diese Leiter wurde gerade eben bereits eine Prüfung angefragt. Bitte später erneut versuchen." });
  }

  const settings = readStore("lp_pruefer") || {};
  const smtp = settings.smtp || {};
  const to = String(settings.requestEmail || settings.email || "").trim();
  if (!to) return res.status(400).json({ error: "Es ist keine Empfänger-Adresse für Prüfungsanfragen hinterlegt." });
  if (!smtp.host || !smtp.user || !smtp.pass) {
    return res.status(400).json({ error: "Auf dem Server ist kein SMTP-Versand konfiguriert." });
  }

  const ladder = (readStore("lp_ladders") || []).find(l => l.id === ladderId);
  if (!ladder) return res.status(404).json({ error: "Leiter nicht gefunden" });

  const lastInsp = (readStore("lp_inspections") || [])
    .filter(i => i.ladderId === ladderId)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
  const nextDue = lastInsp ? new Date(lastInsp.nextDate) : null;
  const overdue = nextDue ? nextDue.getTime() < Date.now() : false;

  const statusLine = !lastInsp
    ? `<span style="color:#856404;font-weight:bold;">Noch nie geprüft</span>`
    : overdue
      ? `<span style="color:#c1121f;font-weight:bold;">ÜBERFÄLLIG — fällig war ${fmtDate(nextDue)}</span>`
      : `<span style="color:#2d6a4f;font-weight:bold;">fällig am ${fmtDate(nextDue)}</span>`;

  const row = (label, val) =>
    `<tr><td style="padding:6px 10px;font-weight:bold;background:#f5f5f5;border:1px solid #eee;">${label}</td><td style="padding:6px 10px;background:#fff;border:1px solid #eee;">${val || "—"}</td></tr>`;

  const bodyHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#E30613;color:#fff;padding:20px;border-radius:6px 6px 0 0;">
    <h2 style="margin:0;font-size:18px;">🔔 Prüfungsanfrage — Leiterprüfung</h2>
  </div>
  <div style="padding:20px;background:#f9f9f9;border:1px solid #ddd;border-top:none;border-radius:0 0 6px 6px;">
    <p style="margin:0 0 14px;font-size:15px;">Eine Person hat über den QR-Code an der Leiter eine <strong>Prüfung angefragt</strong>.</p>
    <p style="margin:0 0 16px;font-size:15px;">Nächste Prüfung: ${statusLine}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${row("Inventar-Nr.", ladder.inventoryNr)}
      ${row("Bezeichnung", ladder.name)}
      ${row("Typ", TYPE_LABELS[ladder.type] || ladder.type)}
      ${row("Material", ladder.material)}
      ${row("Hersteller", ladder.manufacturer)}
      ${row("Baujahr", ladder.year)}
      ${row("Standort", ladder.location)}
      ${row("Max. Belastung", ladder.maxLoad ? ladder.maxLoad + " kg" : "")}
      ${row("Länge / Höhe", ladder.length)}
      ${row("Letzte Prüfung", lastInsp ? fmtDate(lastInsp.date) + (lastInsp.result === "bestanden" ? " (bestanden)" : " (nicht bestanden)") : "—")}
      ${row("Nächste Prüfung fällig", lastInsp ? fmtDate(nextDue) : "—")}
    </table>
    <p style="margin:16px 0 0;font-size:12px;color:#888;">Automatisch ausgelöst durch einen QR-Code-Scan · ${new Date().toLocaleString("de-DE")}</p>
  </div>
</div>`;

  const port   = parseInt(smtp.port) || 587;
  const secure = smtp.secure === true || port === 465;

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host, port, secure,
      auth: { user: smtp.user, pass: smtp.pass },
      tls: { rejectUnauthorized: false },
    });
    await transporter.sendMail({
      from: `"DRK Leiterprüfung" <${smtp.user}>`,
      to,
      subject: `Prüfungsanfrage: ${ladder.inventoryNr} — ${ladder.name}`,
      html: bodyHtml,
    });
    reqCooldown.set(ladderId, Date.now());
    console.log(`[OK] Prüfungsanfrage ${ladder.inventoryNr} → ${to}`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ERR] Prüfungsanfrage: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`Leiterprüfung Server läuft auf Port ${PORT} | Daten: ${DATA_DIR}`)
);
