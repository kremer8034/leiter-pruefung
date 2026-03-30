# Leiterprüfung — Web App

Digitale Leiterprüfung gemäß **DGUV Information 208-016**, **BetrSichV** und **DIN EN 131**.

## Features

- **Leiterdatenbank** — Alle Leitern und Tritte inventarisieren
- **Normgerechter Prüffragebogen** — Typspezifische Sicht- und Funktionsprüfung
- **PDF-Prüfprotokolle** — Exportierbar als rechtssichere Dokumentation
- **Automatische Prüffristen** — Nächste Prüfung wird automatisch vorgeschlagen
- **Mobile-first** — Optimiert für die Nutzung am Smartphone
- **PWA-fähig** — Zum Home-Screen hinzufügen möglich

## Unterstützte Leitertypen

Stehleiter, Anlegeleiter, Mehrzweckleiter, Trittleiter, Schiebeleiter, Podestleiter

## Deployment auf Vercel

### 1. Repository auf GitHub erstellen

1. Gehe auf [github.com/new](https://github.com/new)
2. Name: `leiter-pruefung` (oder frei wählbar)
3. Private oder Public — nach Wunsch
4. **Kein** README, .gitignore oder License auswählen
5. "Create repository" klicken

### 2. Code hochladen

**Option A — ZIP Upload (einfachster Weg):**
1. Auf der leeren Repo-Seite auf "uploading an existing file" klicken
2. Alle Dateien aus diesem ZIP per Drag & Drop hochladen
3. "Commit changes" klicken

**Option B — Git CLI:**
```bash
cd leiter-pruefung
git init
git add .
git commit -m "Initial commit: Leiterprüfung App"
git branch -M main
git remote add origin https://github.com/DEIN-USERNAME/leiter-pruefung.git
git push -u origin main
```

### 3. Vercel verbinden

1. Gehe auf [vercel.com](https://vercel.com) und logge dich mit GitHub ein
2. "Add New Project" klicken
3. Dein `leiter-pruefung` Repository auswählen
4. Framework: **Vite** (wird automatisch erkannt)
5. "Deploy" klicken
6. Fertig! Deine App ist unter `leiter-pruefung.vercel.app` erreichbar

### 4. Custom Domain (optional)

In Vercel unter Settings → Domains kannst du eine eigene Domain verknüpfen,
z.B. `leiterpruefung.brk-grossheubach.de`.

## Lokal entwickeln

```bash
npm install
npm run dev
```

Öffnet die App unter http://localhost:5173

## Rechtsgrundlagen

- Arbeitsschutzgesetz (ArbSchG)
- Betriebssicherheitsverordnung (BetrSichV) §3, §14
- TRBS 1201, TRBS 1203, TRBS 2121 Teil 2
- DGUV Information 208-016
- DIN EN 131-1 bis -4
- DIN EN 14183

## Hinweis

Die Daten werden im **localStorage** des Browsers gespeichert. Das bedeutet:
- Daten bleiben pro Gerät/Browser erhalten
- Verschiedene Geräte teilen keine Daten
- Beim Löschen der Browserdaten gehen die Daten verloren

Für eine Multi-User-/Multi-Device-Lösung wäre ein Backend mit Datenbank nötig.
