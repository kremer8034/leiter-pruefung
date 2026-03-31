const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

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

app.post("/data/:key", (req, res) => {
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: "value fehlt" });
  writeStore(req.params.key, value);
  res.json({ ok: true });
});

// ─── E-Mail mit PDF-Anhang ───
app.post("/send-email", async (req, res) => {
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
