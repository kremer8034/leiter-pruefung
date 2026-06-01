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

### QR-Code & öffentliche Statusseite
- **QR-Code je Leiter** — In der Leiter-Detailansicht generierbar, als PNG herunterladbar oder als Etikett druckbar (zum Aufkleben auf die reale Leiter)
- **Öffentliche Statusseite** (`/l/<Leiter-ID>`) — Von **jedermann** ohne Anmeldung per Scan abrufbar; zeigt:
  - Datum der letzten Prüfung
  - Ergebnis (bestanden / nicht bestanden)
  - Datum der nächsten fälligen Prüfung
  - Ampel-Status (geprüft & gültig · bald fällig · überfällig · nicht bestanden · nie geprüft)
- **Prüfung direkt per QR starten** — Über die Statusseite, jedoch **nur für berechtigte Nutzer** (Zugangscode erforderlich)
- **Prüfung anfragen (für jedermann)** — Button auf der Statusseite: jede Person kann per Klick eine Prüfung anfragen. Es geht automatisch eine E-Mail an den/die Prüfer/in mit **Leiter-Stammdaten** und **Fälligkeitsdatum der nächsten Prüfung** (überfällig oder anstehend). So unterstützen auch Nicht-Prüfer die Leiterprüfung, wenn sie z. B. eine überfällige Leiter entdecken.
  - Empfängeradresse einstellbar unter **Einstellungen → E-Mail → „E-Mail für Prüfungsanfragen"**
  - Die E-Mail wird **serverseitig** aus den gespeicherten Stammdaten erzeugt (der öffentliche Client sendet nur die Leiter-ID) — kein offenes Mail-Relay; Spam-Schutz per Cooldown (10 Min./Leiter)

### Zugangsschutz
- **Optionaler Zugangscode (PIN)** — Unter **Einstellungen → Zugang** aktivierbar
- **Serverseitige Prüfung** — Code wird nur als Hash gespeichert (scrypt); Tokens sind HMAC-signiert (30 Tage gültig)
- **Schützt schreibende Aktionen** — Prüfung starten/speichern, Stammdaten ändern, E-Mail-Versand; **lesender Zugriff** (Statusseite) bleibt öffentlich
- **Abwärtskompatibel** — Ohne gesetzten Code ist die App wie bisher frei nutzbar

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
    ├── /l/<id>    → nginx → SPA → öffentliche Leiter-Statusseite (QR-Ziel)
    └── /api/      → nginx → Node.js Backend (Port 3001)
                                │
                                ├── GET  /data-all        Alle Datensätze laden (öffentlich, lesend)
                                ├── GET  /data/:key       Einzelner Datensatz (öffentlich, lesend)
                                ├── POST /data/:key       Datensatz speichern (Token nötig, falls Code gesetzt)
                                ├── POST /send-email      E-Mail mit PDF-Anhang (Token nötig, falls Code gesetzt)
                                ├── POST /request-inspection  Öffentliche Prüfungsanfrage per QR (kein Token, Cooldown)
                                ├── GET  /auth/status      Ist ein Zugangscode gesetzt?
                                ├── GET  /auth/check       Token gültig?
                                ├── POST /auth/verify      Anmelden (Code → Token)
                                ├── POST /auth/set         Code setzen/ändern
                                └── POST /auth/clear        Code entfernen
```

> Der Zugangscode wird ausschließlich als Hash (scrypt) im Datenverzeichnis (`auth.json`) gespeichert.
> Bei vergessenem Code genügt das Löschen dieser Datei zum Zurücksetzen.

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
