// Vercel Serverless-Backend für die Leiterprüfung.
// Ein Catch-all-Handler bildet alle /api/* Routen ab (ersetzt den früheren
// Express-Server + nginx-Proxy). Datenhaltung: Supabase (Postgres).
//
// Benötigte Environment-Variablen (in Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL                 z. B. https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    Service-Role-Key (geheim, nur serverseitig!)
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

// Nur diese Schlüssel sind über die generische Data-API les-/schreibbar.
const DATA_KEYS = ["lp_ladders", "lp_inspections", "lp_locations", "lp_pruefer"];
const TYPE_LABELS = {
  stehleiter: "Stehleiter", anlegeleiter: "Anlegeleiter", mehrzweckleiter: "Mehrzweckleiter",
  trittleiter: "Trittleiter / Tritt", schiebeleiter: "Schiebeleiter", podestleiter: "Podestleiter",
};
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 Tage
const REQUEST_COOLDOWN_MS = 1000 * 60 * 10;    // 10 Min. (best-effort, in-memory)
const reqCooldown = new Map();

// ─── Datenspeicher (Supabase KV) ───
async function readStore(key) {
  const { data, error } = await supabase.from("app_kv").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data ? data.value : null;
}
async function writeStore(key, value) {
  const { error } = await supabase.from("app_kv").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ─── Zugangsschutz ───
async function readAuth() {
  const { data, error } = await supabase.from("app_auth").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data || null;
}
async function writeAuth(obj) {
  const { error } = await supabase.from("app_auth").upsert({ id: 1, ...obj });
  if (error) throw error;
}
async function clearAuth() {
  const { error } = await supabase.from("app_auth").delete().eq("id", 1);
  if (error) throw error;
}
function hashCode(code, salt) { return crypto.scryptSync(String(code), salt, 64).toString("hex"); }
function verifyCode(code, auth) {
  if (!code || !auth || !auth.hash) return false;
  const a = Buffer.from(hashCode(code, auth.salt), "hex");
  const b = Buffer.from(auth.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function issueToken(secret) {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  const sig = crypto.createHmac("sha256", secret).update(exp).digest("hex");
  return Buffer.from(exp).toString("base64") + "." + sig;
}
function validToken(token, auth) {
  if (!auth || !auth.secret || !token) return false;
  const i = token.indexOf(".");
  if (i < 0) return false;
  const expB64 = token.slice(0, i), sig = token.slice(i + 1);
  let exp;
  try { exp = Buffer.from(expB64, "base64").toString("utf8"); } catch { return false; }
  const expected = crypto.createHmac("sha256", auth.secret).update(exp).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(exp) > Date.now();
}
function bearer(req) { return (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim(); }

// SMTP-Passwort niemals an Clients ausliefern.
function stripSecret(key, value) {
  if (key === "lp_pruefer" && value && value.smtp) {
    return { ...value, smtp: { ...value.smtp, pass: "" } };
  }
  return value;
}
function fmtDate(d) { try { return new Date(d).toLocaleDateString("de-DE"); } catch { return "—"; } }

function readBody(req) {
  // Vercel parst JSON i. d. R. automatisch; Fallback zur Sicherheit.
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

// Routen-Segmente ermitteln. Die vercel.json-Rewrite reicht den Pfad als
// Query-Parameter __p durch; req.url dient als robuster Fallback.
function getSegments(req) {
  const q = req.query || {};
  const pp = Array.isArray(q.__p) ? q.__p.join("/") : q.__p;
  if (typeof pp === "string" && pp) return pp.split("/").filter(Boolean);
  const p = q.path;
  if (Array.isArray(p) && p.length) return p;
  if (typeof p === "string" && p) return p.split("/").filter(Boolean);
  const path = (req.url || "").split("?")[0];
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "api") parts.shift();
  if (parts[0] === "index") parts.shift();
  return parts;
}

export default async function handler(req, res) {
  if (!supabase) {
    return res.status(500).json({ error: "Server nicht konfiguriert: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen." });
  }
  const seg = getSegments(req);
  const route = seg.join("/");
  const method = req.method;

  try {
    if (route === "health") return res.json({ ok: true });

    // ── Alle Datensätze ──
    if (route === "data-all" && method === "GET") {
      const out = {};
      for (const k of DATA_KEYS) { const v = await readStore(k); if (v !== null) out[k] = stripSecret(k, v); }
      return res.json(out);
    }

    // ── Einzelner Datensatz ──
    if (seg[0] === "data" && seg.length === 2) {
      const key = seg[1];
      if (!DATA_KEYS.includes(key)) return res.status(400).json({ error: "Unbekannter Schlüssel" });
      if (method === "GET") {
        const v = await readStore(key);
        return res.json({ value: stripSecret(key, v) });
      }
      if (method === "POST") {
        const auth = await readAuth();
        if (auth && auth.hash && !validToken(bearer(req), auth)) return res.status(401).json({ error: "Nicht autorisiert" });
        let value = readBody(req).value;
        if (value === undefined) return res.status(400).json({ error: "value fehlt" });
        // Leeres SMTP-Passwort beim Speichern → bestehendes Passwort beibehalten
        if (key === "lp_pruefer" && value && value.smtp && !value.smtp.pass) {
          const existing = await readStore("lp_pruefer");
          if (existing && existing.smtp && existing.smtp.pass) {
            value = { ...value, smtp: { ...value.smtp, pass: existing.smtp.pass } };
          }
        }
        await writeStore(key, value);
        return res.json({ ok: true });
      }
    }

    // ── Zugangsschutz ──
    if (route === "auth/status" && method === "GET") {
      const a = await readAuth();
      return res.json({ configured: !!(a && a.hash) });
    }
    if (route === "auth/check" && method === "GET") {
      const a = await readAuth();
      if (!a || !a.hash) return res.json({ configured: false, valid: true });
      return res.json({ configured: true, valid: validToken(bearer(req), a) });
    }
    if (route === "auth/verify" && method === "POST") {
      const a = await readAuth();
      if (!a || !a.hash) return res.json({ ok: true, configured: false, token: null });
      if (verifyCode(readBody(req).code, a)) return res.json({ ok: true, configured: true, token: issueToken(a.secret) });
      return res.status(403).json({ ok: false, error: "Zugangscode falsch" });
    }
    if (route === "auth/set" && method === "POST") {
      const { newCode, currentCode } = readBody(req);
      if (!newCode || String(newCode).length < 4) return res.status(400).json({ error: "Zugangscode muss mindestens 4 Zeichen haben" });
      const a = await readAuth();
      if (a && a.hash && !verifyCode(currentCode, a)) return res.status(403).json({ error: "Aktueller Zugangscode falsch" });
      const salt = crypto.randomBytes(16).toString("hex");
      const secret = (a && a.secret) || crypto.randomBytes(32).toString("hex");
      await writeAuth({ hash: hashCode(newCode, salt), salt, secret });
      return res.json({ ok: true, token: issueToken(secret) });
    }
    if (route === "auth/clear" && method === "POST") {
      const a = await readAuth();
      if (a && a.hash && !verifyCode(readBody(req).currentCode, a)) return res.status(403).json({ error: "Aktueller Zugangscode falsch" });
      await clearAuth();
      return res.json({ ok: true });
    }

    // ── E-Mail mit PDF-Anhang (geschützt) ──
    if (route === "send-email" && method === "POST") {
      const auth = await readAuth();
      if (auth && auth.hash && !validToken(bearer(req), auth)) return res.status(401).json({ error: "Nicht autorisiert" });
      const { to, subject, bodyHtml, pdfBase64, pdfFilename, smtp: bodySmtp } = readBody(req);
      const stored = (await readStore("lp_pruefer")) || {};
      const smtp = bodySmtp && bodySmtp.host && bodySmtp.pass ? bodySmtp : (stored.smtp || {});
      if (!to || !smtp.host || !smtp.user || !smtp.pass) {
        return res.status(400).json({ error: "Pflichtfelder fehlen: to, smtp.host, smtp.user, smtp.pass" });
      }
      const port = parseInt(smtp.port) || 587;
      const secure = smtp.secure === true || port === 465;
      const transporter = nodemailer.createTransport({
        host: smtp.host, port, secure, auth: { user: smtp.user, pass: smtp.pass }, tls: { rejectUnauthorized: false },
      });
      const mail = { from: `"DRK Leiterprüfung" <${smtp.user}>`, to, subject, html: bodyHtml || "<p>Prüfprotokoll im Anhang.</p>", attachments: [] };
      if (pdfBase64) mail.attachments.push({ filename: pdfFilename || "Pruefprotokoll.pdf", content: Buffer.from(pdfBase64, "base64"), contentType: "application/pdf" });
      await transporter.sendMail(mail);
      return res.json({ success: true });
    }

    // ── Öffentliche Prüfungsanfrage (ohne Login) ──
    if (route === "request-inspection" && method === "POST") {
      const { ladderId } = readBody(req);
      if (!ladderId) return res.status(400).json({ error: "ladderId fehlt" });
      const prev = reqCooldown.get(ladderId);
      if (prev && Date.now() - prev < REQUEST_COOLDOWN_MS) {
        return res.status(429).json({ error: "Für diese Leiter wurde gerade eben bereits eine Prüfung angefragt. Bitte später erneut versuchen." });
      }
      const settings = (await readStore("lp_pruefer")) || {};
      const smtp = settings.smtp || {};
      const to = String(settings.requestEmail || settings.email || "").trim();
      if (!to) return res.status(400).json({ error: "Es ist keine Empfänger-Adresse für Prüfungsanfragen hinterlegt." });
      if (!smtp.host || !smtp.user || !smtp.pass) return res.status(400).json({ error: "Auf dem Server ist kein SMTP-Versand konfiguriert." });

      const ladder = ((await readStore("lp_ladders")) || []).find(l => l.id === ladderId);
      if (!ladder) return res.status(404).json({ error: "Leiter nicht gefunden" });
      const lastInsp = ((await readStore("lp_inspections")) || [])
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
      const port = parseInt(smtp.port) || 587;
      const secure = smtp.secure === true || port === 465;
      const transporter = nodemailer.createTransport({
        host: smtp.host, port, secure, auth: { user: smtp.user, pass: smtp.pass }, tls: { rejectUnauthorized: false },
      });
      await transporter.sendMail({
        from: `"DRK Leiterprüfung" <${smtp.user}>`, to,
        subject: `Prüfungsanfrage: ${ladder.inventoryNr} — ${ladder.name}`, html: bodyHtml,
      });
      reqCooldown.set(ladderId, Date.now());
      return res.json({ ok: true });
    }

    return res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error("[ERR]", route, err && err.message);
    return res.status(500).json({ error: (err && err.message) || "Serverfehler" });
  }
}
