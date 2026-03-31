# Leiterprüfung — Web App

Digitale Leiterprüfungs-App für Hilfsorganisationen und Betriebe zur rechtssicheren Dokumentation von Leitern und Tritten gemäß **DGUV Information 208-016**, **BetrSichV §14** und **DIN EN 131**.

---

## Features

### Stammdaten & Inventar
- **Leiterdatenbank** — Alle Leitern und Tritte zentral erfassen und verwalten
- **Typspezifische Prüffragen** — Je nach Leitertyp werden automatisch passende Zusatzfragen geladen
- **Fotodokumentation** — Foto pro Leiter direkt mit der Gerätekamera aufnehmen
- **Standortverwaltung** — Standorte als Stammdaten pflegen, zentral umbenennen (aktualisiert alle Leitern)
- **Ausmustern** — Leitern aus dem Prüfzyklus nehmen ohne Verlust der Prüfhistorie

### Prüfablauf
- **Normgerechter Prüffragebogen** — 11 Basisfragen + typspezifische Zusatzfragen nach DGUV 208-016
- **Alle Fragen auf einer Seite** — Kein seitenweises Weiterklicken, Fortschrittsanzeige
- **Mängelerfassung** — Kritische und nicht-kritische Mängel mit Freitextnotiz
- **Touch-Unterschrift** — Digitale Pflichtunterschrift direkt auf dem Smartphone
- **Automatische Prüffristen** — Nächste Prüfung wird anhand des konfigurierten Intervalls berechnet

### Protokolle & E-Mail
- **Echtes PDF-Prüfprotokoll** — DIN A4, eine Seite, direkter Dateidownload (kein Druckdialog)
- **Automatischer E-Mail-Versand** — PDF als Anhang nach jeder Prüfung via eigenem SMTP-Server
- **Opt-out pro Prüfung** — E-Mail-Versand für eine einzelne Prüfung deaktivierbar
- **SMTP-Konfiguration** — Eigenen Mailserver eintragen, Verbindung direkt in der App testen

### Datenhaltung
- **Server-seitige Persistenz** — Alle Daten werden auf dem Server gespeichert (kein Datenverlust bei Browser-Cache-Löschung)
- **localStorage als Sofort-Cache** — Schnelle Reaktion ohne Ladezeiten
- **Automatische Datenmigration** — Bestehende localStorage-Daten werden beim ersten Start auf den Server übertragen

### Dashboard & Übersicht
- **Statistik-Kacheln** — Gesamtanzahl, i.O., überfällig, nie geprüft (anklickbar, zeigt gefilterte Liste)
- **Standort-Filter** — Dashboard und Leiterliste nach Standort filterbar
- **Letzte Prüfungen** — Anklickbar, springt direkt zum Eintrag in der Prüfhistorie
- **Nächste fällige Prüfungen** — Sortiert nach Datum mit Countdown

---

## Unterstützte Leitertypen

| Typ | Zusätzliche Prüfpunkte |
|-----|------------------------|
| Stehleiter | Spreizsicherung, Plattform |
| Anlegeleiter | Einhängehaken, Standsicherheit |
| Mehrzweckleiter | Gelenke/Scharniere, Schiebeführung, Spreizsicherung |
| Trittleiter | Trittfläche, Klappmechanismus |
| Schiebeleiter | Schiebeführung, Arretierung, Seilzug |
| Podestleiter | Plattform, Geländer, Rollen |

---

## Technologie

| Schicht | Technologie |
|---------|-------------|
| Frontend | React 18, Vite 6 |
| PDF | jsPDF + jspdf-autotable |
| Backend | Node.js, Express |
| E-Mail | Nodemailer |
| Datenspeicher | JSON-Dateien in Docker-Volume |
| Webserver | nginx (statische Dateien + API-Proxy) |
| Deployment | Docker, Traefik v3, Let's Encrypt |

### Architektur

```
Browser (React SPA)
    │
    ├── /          → nginx → statische Dateien (dist/)
    └── /api/      → nginx → Node.js Backend (Port 3001)
                                │
                                ├── GET  /data-all        Alle Datensätze laden
                                ├── GET  /data/:key       Einzelner Datensatz
                                ├── POST /data/:key       Datensatz speichern
                                └── POST /send-email      E-Mail mit PDF-Anhang
```

---

## Deployment (Docker + Traefik)

### Voraussetzungen
- Docker + Docker Compose
- Traefik v3 mit Let's Encrypt (bereits laufend, im Host-Netzwerk)

### 1. Repository klonen

```bash
git clone https://github.com/kremer8034/leiter-pruefung.git
```

### 2. docker-compose.yml anlegen

```yaml
services:
  leiter-pruefung:
    build: ./leiter-pruefung
    image: leiter-pruefung:latest
    restart: unless-stopped
    ports:
      - "80"
    labels:
      - traefik.enable=true
      - traefik.http.routers.leiter-pruefung.rule=Host(`leiter-pruefung.example.com`)
      - traefik.http.routers.leiter-pruefung.entrypoints=websecure
      - traefik.http.routers.leiter-pruefung.tls.certresolver=letsencrypt
      - traefik.http.services.leiter-pruefung.loadbalancer.server.port=80

  leiter-pruefung-server:
    build: ./leiter-pruefung/server
    image: leiter-pruefung-server:latest
    container_name: leiter-pruefung-server
    restart: unless-stopped
    environment:
      - DATA_DIR=/data
    volumes:
      - leiter-pruefung-data:/data

volumes:
  leiter-pruefung-data:
```

> `leiter-pruefung.example.com` durch die eigene Domain ersetzen.

### 3. Bauen und starten

```bash
docker compose build
docker compose up -d
```

Die App ist danach unter der konfigurierten Domain per HTTPS erreichbar.  
Beim ersten Aufruf sind keine Daten vorhanden — alles wird in der App selbst eingerichtet.

---

## Lokal entwickeln

```bash
# Frontend
npm install
npm run dev        # → http://localhost:5173

# Backend (separates Terminal)
cd server
npm install
node index.js      # → http://localhost:3001
```

> Im Dev-Modus läuft der Vite-Dev-Server; der nginx-API-Proxy ist nur im Docker-Build aktiv. API-Aufrufe müssen lokal direkt auf Port 3001 zeigen oder per Vite-Proxy konfiguriert werden.

---

## SMTP-Konfiguration

In der App unter **Einstellungen → E-Mail**:

| Anbieter | Host | Port | Hinweis |
|----------|------|------|---------|
| Gmail | `smtp.gmail.com` | 587 | App-Passwort erforderlich (kein normales Passwort) |
| Office 365 | `smtp.office365.com` | 587 | — |
| Eigener Server | laut Hoster | 587 / 465 | SSL/TLS bei Port 465 aktivieren |

Die Verbindung lässt sich direkt in den Einstellungen per **Test-Button** prüfen — dabei wird eine echte Test-E-Mail mit PDF-Anhang gesendet.

---

## Rechtsgrundlagen

- Arbeitsschutzgesetz (ArbSchG)
- Betriebssicherheitsverordnung (BetrSichV) §3, §14
- TRBS 1201 — Prüfungen von Arbeitsmitteln
- TRBS 1203 — Befähigte Personen
- TRBS 2121 Teil 2 — Gefährdung bei der Verwendung von Leitern
- DGUV Information 208-016 — Handlungsanleitung Leitern und Tritte
- DIN EN 131-1 bis -4 — Leitern: Benennungen, Bauarten, Anforderungen
- DIN EN 14183 — Tritte

---

## Lizenz

MIT
