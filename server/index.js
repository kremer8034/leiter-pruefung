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

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`Leiterprüfung Server läuft auf Port ${PORT} | Daten: ${DATA_DIR}`)
);
