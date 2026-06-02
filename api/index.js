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
const SP_TYPES = ["stehleiter","anlegeleiter","mehrzweckleiter","trittleiter","schiebeleiter","podestleiter"];
function normalizeType(t) {
  const k = String(t || "").trim().toLowerCase();
  if (SP_TYPES.includes(k)) return k;
  if (k.startsWith("steh")) return "stehleiter";
  if (k.startsWith("anlege")) return "anlegeleiter";
  if (k.startsWith("mehrzweck")) return "mehrzweckleiter";
  if (k.startsWith("tritt")) return "trittleiter";
  if (k.startsWith("schiebe")) return "schiebeleiter";
  if (k.startsWith("podest")) return "podestleiter";
  return "stehleiter";
}
function normalizeLadder(l) {
  return {
    id: String(l.id != null && l.id !== "" ? l.id : (l.inventoryNr || "")).trim(),
    inventoryNr: l.inventoryNr != null ? String(l.inventoryNr) : "",
    name: l.name || "",
    type: normalizeType(l.type),
    material: l.material || "",
    manufacturer: l.manufacturer || "",
    year: l.year != null ? String(l.year) : "",
    location: l.location || "",
    maxLoad: l.maxLoad != null ? String(l.maxLoad) : "",
    length: l.length != null ? String(l.length) : "",
    notes: l.notes || "",
    photo: l.photo || "",
    retired: l.retired === true || String(l.retired).toLowerCase() === "true" || String(l.status || "").toLowerCase().includes("ausgemustert"),
    _source: "sharepoint",
  };
}
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

// ─── Benutzerkonten & Zugangsschutz ───
function genId() { return "U" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function hashPassword(pw, salt) { return crypto.scryptSync(String(pw), salt, 64).toString("hex"); }
function verifyPassword(pw, user) {
  if (!pw || !user || !user.hash) return false;
  const a = Buffer.from(hashPassword(pw, user.salt), "hex");
  const b = Buffer.from(user.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Globales Token-Secret (Singleton in app_auth.secret), wird bei Bedarf erzeugt.
async function getSecret() {
  const { data, error } = await supabase.from("app_auth").select("secret").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (data && data.secret) return data.secret;
  const secret = crypto.randomBytes(32).toString("hex");
  const up = await supabase.from("app_auth").upsert({ id: 1, secret });
  if (up.error) throw up.error;
  return secret;
}
function issueToken(secret, uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + TOKEN_TTL_MS })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return payload + "." + sig;
}
function parseToken(secret, token) {
  if (!secret || !token) return null;
  const i = token.indexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; }
  if (!data || !data.exp || data.exp < Date.now()) return null;
  return data; // { uid, exp }
}
function bearer(req) { return (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim(); }

async function countUsers() {
  const { count, error } = await supabase.from("app_users").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count || 0;
}
async function getUserById(id) {
  const { data, error } = await supabase.from("app_users").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data || null;
}
async function findUserByIdentifier(identifier) {
  const idn = String(identifier || "").trim();
  if (!idn) return null;
  let r = await supabase.from("app_users").select("*").ilike("email", idn).eq("active", true);
  if (r.error) throw r.error;
  if (r.data && r.data.length) return r.data[0];
  r = await supabase.from("app_users").select("*").ilike("name", idn).eq("active", true);
  if (r.error) throw r.error;
  return (r.data && r.data[0]) || null;
}
async function countActiveAdmins() {
  const { data, error } = await supabase.from("app_users").select("id").eq("role", "admin").eq("active", true);
  if (error) throw error;
  return (data || []).length;
}
function publicUser(u) { return u ? { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active } : null; }
// Authentifizierten (aktiven) Benutzer ermitteln, sonst null.
async function currentUser(req) {
  const secret = await getSecret();
  const t = parseToken(secret, bearer(req));
  if (!t) return null;
  const u = await getUserById(t.uid);
  return u && u.active ? u : null;
}

// Geheimnisse (SMTP-Passwort, SharePoint-URLs/Secret) niemals an Clients ausliefern.
function stripSecret(key, value) {
  if (key === "lp_pruefer" && value) {
    const out = { ...value };
    if (out.smtp) out.smtp = { ...out.smtp, pass: "" };
    if (out.integration) {
      const ig = out.integration;
      out.integration = { enabled: !!ig.enabled, hasOutbound: !!ig.outboundUrl, hasInboundSecret: !!ig.inboundSecret };
    }
    return out;
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

// ─── Erinnerungen: fällige Leitern an den letzten Prüfer melden ───
function rrow(cells) {
  return `<tr>${cells.map(c => `<td style="padding:6px 10px;border:1px solid #eee;font-size:13px;">${c == null || c === "" ? "—" : c}</td>`).join("")}</tr>`;
}
function rhead(cells) {
  return `<tr>${cells.map(c => `<th style="padding:6px 10px;border:1px solid #eee;background:#f5f5f5;text-align:left;font-size:12px;">${c}</th>`).join("")}</tr>`;
}

async function runReminders() {
  const settings = (await readStore("lp_pruefer")) || {};
  const smtp = settings.smtp || {};

  // Konfigurierbare Logik (Einstellungen → Allgemein → Erinnerungen)
  const cfg = settings.reminders || {};
  const enabled = cfg.enabled !== false;
  const leadDays = Math.max(0, parseInt(cfg.leadDays) || 0);
  const repeatDays = Math.max(0, parseInt(cfg.repeatDays) || 0);
  const mode = cfg.recipients || "inspector";        // inspector | admins | custom
  const customEmail = String(cfg.customEmail || "").trim();
  const ccAdmins = !!cfg.ccAdmins;
  const includeOverview = cfg.includeYearOverview !== false;

  if (!enabled) return { ok: true, sent: 0, due: 0, disabled: true };
  if (!smtp.host || !smtp.user || !smtp.pass) return { ok: false, error: "Kein SMTP konfiguriert", sent: 0, due: 0 };

  const ladders = (await readStore("lp_ladders")) || [];
  const inspections = (await readStore("lp_inspections")) || [];
  const reminded = (await readStore("lp_reminders")) || {}; // { ladderId: {nextDate,lastSent} | nextDateISO(alt) }

  const { data: userRows } = await supabase.from("app_users").select("id,email,role,active");
  const usersById = {}; (userRows || []).forEach(u => { usersById[u.id] = u; });
  const adminEmails = (userRows || []).filter(u => u.role === "admin" && u.active && u.email).map(u => u.email);

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const year = today.getFullYear();
  // Fälligkeitsschwelle = heute + Vorlauf
  const threshold = new Date(today); threshold.setDate(threshold.getDate() + leadDays);
  const thresholdStr = threshold.toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  // Letzte Prüfung je Leiter
  const lastByLadder = {};
  for (const insp of inspections) {
    const cur = lastByLadder[insp.ladderId];
    if (!cur || new Date(insp.date) > new Date(cur.date)) lastByLadder[insp.ladderId] = insp;
  }

  // Übersicht: aktive Leitern ohne Prüfung im aktuellen Kalenderjahr
  const overview = ladders.filter(l => !l.retired)
    .filter(l => !inspections.some(i => i.ladderId === l.id && new Date(i.date).getFullYear() === year))
    .map(l => ({ ladder: l, lastDate: lastByLadder[l.id]?.date || null }))
    .sort((a, b) => String(a.ladder.inventoryNr || "").localeCompare(String(b.ladder.inventoryNr || "")));

  // Empfänger für eine fällige Leiter bestimmen
  const recipientsFor = (d) => {
    let base;
    if (mode === "admins") base = adminEmails.slice();
    else if (mode === "custom") base = customEmail ? [customEmail] : [];
    else { const u = usersById[d.last.inspectorId]; base = (u && u.email) ? [u.email] : adminEmails.slice(); }
    if (ccAdmins) base = base.concat(adminEmails);
    return [...new Set(base.filter(Boolean))];
  };

  // Fällige Leitern ermitteln (inkl. Vorlauf, Wiederholung, einmal-pro-Zyklus)
  const due = [];
  for (const l of ladders) {
    if (l.retired) continue;
    const last = lastByLadder[l.id];
    if (!last || !last.nextDate) continue;
    if (String(last.nextDate).slice(0, 10) > thresholdStr) continue;     // noch nicht fällig (Vorlauf berücksichtigt)
    const prev = reminded[l.id];
    const prevCycle = typeof prev === "string" ? prev : prev?.nextDate;
    const prevSent = typeof prev === "object" ? prev?.lastSent : null;
    if (prevCycle === last.nextDate) {                                   // gleicher Fälligkeits-Zyklus
      if (repeatDays === 0) continue;                                    // nur einmal
      if (prevSent && daysBetween(prevSent, todayStr) < repeatDays) continue; // Wiederholung noch nicht fällig
    }
    due.push({ ladder: l, last });
  }
  if (due.length === 0) return { ok: true, sent: 0, due: 0 };

  // Nach Empfänger gruppieren
  const groups = new Map(); // email -> [{ladder,last}]
  for (const d of due) {
    for (const email of recipientsFor(d)) {
      if (!groups.has(email)) groups.set(email, []);
      groups.get(email).push(d);
    }
  }

  const overviewTable = overview.length === 0
    ? `<p style="font-size:14px;color:#2d6a4f;">Alle aktiven Leitern wurden ${year} bereits geprüft. 👍</p>`
    : `<table style="width:100%;border-collapse:collapse;margin-top:6px;">
        ${rhead(["Inventar-Nr.", "Bezeichnung", "Standort", "Letzte Prüfung"])}
        ${overview.map(o => rrow([`<strong>${o.ladder.inventoryNr || "—"}</strong>`, o.ladder.name || "—", o.ladder.location || "—", o.lastDate ? fmtDate(o.lastDate) : "nie"])).join("")}
      </table>`;

  const port = parseInt(smtp.port) || 587;
  const secure = smtp.secure === true || port === 465;
  const transporter = nodemailer.createTransport({ host: smtp.host, port, secure, auth: { user: smtp.user, pass: smtp.pass }, tls: { rejectUnauthorized: false } });

  let sent = 0;
  for (const [email, items] of groups) {
    const dueTable = `<table style="width:100%;border-collapse:collapse;margin-top:6px;">
        ${rhead(["Inventar-Nr.", "Bezeichnung", "Standort", "Letzte Prüfung", "Fällig am"])}
        ${items.map(({ ladder, last }) => rrow([`<strong>${ladder.inventoryNr || "—"}</strong>`, ladder.name || "—", ladder.location || "—", fmtDate(last.date), fmtDate(last.nextDate)])).join("")}
      </table>`;
    const html = `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;">
  <div style="background:#E30613;color:#fff;padding:20px;border-radius:6px 6px 0 0;">
    <h2 style="margin:0;font-size:18px;">⏰ Leiterprüfung fällig</h2>
  </div>
  <div style="padding:20px;background:#f9f9f9;border:1px solid #ddd;border-top:none;border-radius:0 0 6px 6px;">
    <p style="margin:0 0 12px;font-size:15px;">Bei folgenden Leitern steht die Prüfung an — bitte (erneut) prüfen:</p>
    ${dueTable}
    ${includeOverview ? `<h3 style="font-size:15px;margin:22px 0 6px;">Im Kalenderjahr ${year} noch nicht geprüft</h3>
    <p style="margin:0 0 6px;font-size:13px;color:#666;">Diese Leitern könnten gleich mitgeprüft werden:</p>
    ${overviewTable}` : ""}
    <p style="margin:18px 0 0;font-size:12px;color:#888;">Automatische Erinnerung der Leiterprüfung · ${today.toLocaleDateString("de-DE")}</p>
  </div>
</div>`;
    await transporter.sendMail({
      from: `"Leiterprüfung" <${smtp.user}>`, to: email,
      subject: `Leiterprüfung fällig: ${items.length} Leiter${items.length > 1 ? "n" : ""}`, html,
    });
    sent++;
  }

  // Erinnerte Zyklen markieren (nur die mit Empfänger)
  for (const d of due) {
    if (recipientsFor(d).length) reminded[d.ladder.id] = { nextDate: d.last.nextDate, lastSent: todayStr };
  }
  await writeStore("lp_reminders", reminded);

  return { ok: true, sent, due: due.length };
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

    // ── Erinnerungen: per Vercel-Cron (CRON_SECRET) oder manuell durch Admin ──
    if (route === "cron/reminders") {
      const secretEnv = process.env.CRON_SECRET;
      const okCron = !!secretEnv && bearer(req) === secretEnv;
      let okAdmin = false;
      if (!okCron) { const me = await currentUser(req); okAdmin = !!(me && me.role === "admin"); }
      if (!okCron && !okAdmin) return res.status(401).json({ error: "Nicht autorisiert" });
      return res.json(await runReminders());
    }

    // ── SharePoint: Stammdaten-Eingang (Push aus Power Automate) ──
    if (route === "sharepoint/ladders" && method === "POST") {
      const settings = (await readStore("lp_pruefer")) || {};
      const integ = settings.integration || {};
      if (!integ.enabled) return res.status(403).json({ error: "SharePoint-Integration ist deaktiviert" });
      if (!integ.inboundSecret) return res.status(400).json({ error: "Kein Inbound-Secret konfiguriert" });
      const body = readBody(req);
      const provided = req.headers["x-lp-secret"] || body.secret;
      if (provided !== integ.inboundSecret) return res.status(401).json({ error: "Ungültiges Secret" });

      let incoming = [];
      if (Array.isArray(body.ladders)) incoming = body.ladders;
      else if (body.ladder) incoming = [body.ladder];
      else return res.status(400).json({ error: "Erwartet: ladders[] oder ladder{}" });
      const norm = incoming.map(normalizeLadder).filter(l => l.id);
      const mode = body.mode === "replace" ? "replace" : "upsert";

      let next;
      if (mode === "replace") {
        next = norm;
      } else {
        const existing = (await readStore("lp_ladders")) || [];
        const map = new Map(existing.map(l => [String(l.id), l]));
        for (const l of norm) map.set(String(l.id), { ...map.get(String(l.id)), ...l });
        next = [...map.values()];
      }
      await writeStore("lp_ladders", next);
      return res.json({ ok: true, received: incoming.length, total: next.length, mode });
    }

    // ── SharePoint: Protokoll-Ausgang (App → Power-Automate-Flow) ──
    if (route === "sharepoint/push-protocol" && method === "POST") {
      if (!(await currentUser(req))) return res.status(401).json({ error: "Nicht autorisiert" });
      const settings = (await readStore("lp_pruefer")) || {};
      const integ = settings.integration || {};
      if (!integ.enabled || !integ.outboundUrl) return res.status(400).json({ error: "SharePoint-Ausgang nicht konfiguriert" });
      const { filename, pdfBase64, meta } = readBody(req);
      if (!pdfBase64) return res.status(400).json({ error: "pdfBase64 fehlt" });
      try {
        const r = await fetch(integ.outboundUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: filename || "Pruefprotokoll.pdf", pdfBase64, meta: meta || {} }),
        });
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          return res.status(502).json({ error: `Flow antwortete ${r.status}${t ? ": " + t.slice(0, 200) : ""}` });
        }
        return res.json({ ok: true });
      } catch (e) {
        return res.status(502).json({ error: "Flow nicht erreichbar: " + (e && e.message) });
      }
    }

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
        if (!(await currentUser(req))) return res.status(401).json({ error: "Nicht autorisiert" });
        let value = readBody(req).value;
        if (value === undefined) return res.status(400).json({ error: "value fehlt" });
        // Geheimnisse beim Speichern bewahren, wenn das Feld leer übermittelt wird
        if (key === "lp_pruefer" && value) {
          const existing = (await readStore("lp_pruefer")) || {};
          if (value.smtp && !value.smtp.pass && existing.smtp && existing.smtp.pass) {
            value = { ...value, smtp: { ...value.smtp, pass: existing.smtp.pass } };
          }
          if (value.integration) {
            const exIg = existing.integration || {};
            const ig = { ...value.integration };
            delete ig.hasOutbound; delete ig.hasInboundSecret; // nur Anzeige-Flags vom Client
            if (!ig.outboundUrl && exIg.outboundUrl) ig.outboundUrl = exIg.outboundUrl;
            if (!ig.inboundSecret && exIg.inboundSecret) ig.inboundSecret = exIg.inboundSecret;
            value = { ...value, integration: ig };
          }
        }
        await writeStore(key, value);
        return res.json({ ok: true });
      }
    }

    // ── Authentifizierung & Benutzer ──
    if (route === "auth/status" && method === "GET") {
      const n = await countUsers();
      return res.json({ setup: n === 0, hasUsers: n > 0 });
    }
    if (route === "auth/me" && method === "GET") {
      const u = await currentUser(req);
      return res.json({ user: publicUser(u) });
    }
    if (route === "auth/login" && method === "POST") {
      const { identifier, password } = readBody(req);
      const u = await findUserByIdentifier(identifier);
      if (!u || !verifyPassword(password, u)) return res.status(403).json({ error: "E-Mail/Name oder Passwort falsch" });
      const secret = await getSecret();
      return res.json({ token: issueToken(secret, u.id), user: publicUser(u) });
    }
    if (route === "auth/setup" && method === "POST") {
      // Nur erlaubt, solange noch kein Benutzer existiert → erster Administrator
      if ((await countUsers()) > 0) return res.status(403).json({ error: "Ersteinrichtung bereits abgeschlossen" });
      const { name, email, password } = readBody(req);
      if (!name || !password || String(password).length < 6) return res.status(400).json({ error: "Name und Passwort (mind. 6 Zeichen) erforderlich" });
      const salt = crypto.randomBytes(16).toString("hex");
      const u = { id: genId(), name: String(name).trim(), email: (email || "").trim() || null, role: "admin", hash: hashPassword(password, salt), salt, active: true };
      const ins = await supabase.from("app_users").insert(u);
      if (ins.error) throw ins.error;
      const secret = await getSecret();
      return res.json({ token: issueToken(secret, u.id), user: publicUser(u) });
    }

    // Eigenes Passwort ändern (jeder angemeldete Nutzer)
    if (route === "auth/password" && method === "POST") {
      const me = await currentUser(req);
      if (!me) return res.status(401).json({ error: "Nicht autorisiert" });
      const { currentPassword, newPassword } = readBody(req);
      if (!verifyPassword(currentPassword, me)) return res.status(403).json({ error: "Aktuelles Passwort falsch" });
      if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: "Neues Passwort muss mindestens 6 Zeichen haben" });
      const salt = crypto.randomBytes(16).toString("hex");
      const upd = await supabase.from("app_users").update({ hash: hashPassword(newPassword, salt), salt }).eq("id", me.id);
      if (upd.error) throw upd.error;
      return res.json({ ok: true });
    }

    // Aktive Prüfer für die Auswahl (jeder angemeldete Nutzer)
    if (route === "inspectors" && method === "GET") {
      if (!(await currentUser(req))) return res.status(401).json({ error: "Nicht autorisiert" });
      const { data, error } = await supabase.from("app_users").select("id,name,email").eq("active", true).order("name");
      if (error) throw error;
      return res.json({ inspectors: data || [] });
    }

    // ── Benutzerverwaltung (nur Admin) ──
    if (seg[0] === "users") {
      const me = await currentUser(req);
      if (!me || me.role !== "admin") return res.status(403).json({ error: "Nur für Administratoren" });

      if (seg.length === 1 && method === "GET") {
        const { data, error } = await supabase.from("app_users").select("id,name,email,role,active,created_at").order("created_at");
        if (error) throw error;
        return res.json({ users: data || [] });
      }
      if (seg.length === 1 && method === "POST") {
        const { name, email, password, role, active } = readBody(req);
        if (!name || !password || String(password).length < 6) return res.status(400).json({ error: "Name und Passwort (mind. 6 Zeichen) erforderlich" });
        const salt = crypto.randomBytes(16).toString("hex");
        const u = { id: genId(), name: String(name).trim(), email: (email || "").trim() || null,
          role: role === "admin" ? "admin" : "pruefer", hash: hashPassword(password, salt), salt, active: active !== false };
        const ins = await supabase.from("app_users").insert(u);
        if (ins.error) throw ins.error;
        return res.json({ user: publicUser(u) });
      }
      if (seg.length === 2 && (method === "PATCH" || method === "PUT")) {
        const id = seg[1];
        const target = await getUserById(id);
        if (!target) return res.status(404).json({ error: "Benutzer nicht gefunden" });
        const { name, email, password, role, active } = readBody(req);
        const patch = {};
        if (name !== undefined) patch.name = String(name).trim();
        if (email !== undefined) patch.email = (email || "").trim() || null;
        if (role !== undefined) patch.role = role === "admin" ? "admin" : "pruefer";
        if (active !== undefined) patch.active = !!active;
        if (password) { const salt = crypto.randomBytes(16).toString("hex"); patch.salt = salt; patch.hash = hashPassword(password, salt); }
        // Letzten aktiven Administrator schützen
        const losesAdmin = (patch.role && patch.role !== "admin") || patch.active === false;
        if (losesAdmin && target.role === "admin" && target.active && (await countActiveAdmins()) <= 1) {
          return res.status(400).json({ error: "Der letzte aktive Administrator kann nicht deaktiviert oder herabgestuft werden." });
        }
        const upd = await supabase.from("app_users").update(patch).eq("id", id);
        if (upd.error) throw upd.error;
        return res.json({ ok: true });
      }
      if (seg.length === 2 && method === "DELETE") {
        const id = seg[1];
        const target = await getUserById(id);
        if (!target) return res.status(404).json({ error: "Benutzer nicht gefunden" });
        if (target.role === "admin" && target.active && (await countActiveAdmins()) <= 1) {
          return res.status(400).json({ error: "Der letzte aktive Administrator kann nicht gelöscht werden." });
        }
        const del = await supabase.from("app_users").delete().eq("id", id);
        if (del.error) throw del.error;
        return res.json({ ok: true });
      }
    }

    // ── E-Mail mit PDF-Anhang (nur angemeldet) ──
    if (route === "send-email" && method === "POST") {
      if (!(await currentUser(req))) return res.status(401).json({ error: "Nicht autorisiert" });
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
      const mail = { from: `"Leiterprüfung" <${smtp.user}>`, to, subject, html: bodyHtml || "<p>Prüfprotokoll im Anhang.</p>", attachments: [] };
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
        from: `"Leiterprüfung" <${smtp.user}>`, to,
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
