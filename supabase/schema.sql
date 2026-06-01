-- Supabase-Schema für die Leiterprüfung (Vercel-Betrieb)
-- Einmalig im Supabase SQL Editor des (frischen) Projekts ausführen.
-- Danach die Environment-Variablen in Vercel setzen (siehe README):
--   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET

-- Schlüssel-Wert-Speicher: Leitern, Prüfungen, Standorte, Einstellungen, Erinnerungs-Status
create table if not exists public.app_kv (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Singleton: globales HMAC-Token-Secret (wird bei Bedarf automatisch erzeugt)
create table if not exists public.app_auth (
  id     int primary key default 1,
  hash   text,
  salt   text,
  secret text
);

-- Benutzerkonten (Prüfer) — Passwörter ausschließlich als scrypt-Hash
create table if not exists public.app_users (
  id         text primary key,
  name       text not null,
  email      text,
  role       text not null default 'pruefer',   -- 'admin' | 'pruefer'
  hash       text not null,
  salt       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- RLS aktivieren, ohne Policies: nur der serverseitige Service-Role-Key
-- (in der Vercel-Function) hat Zugriff; anon/publishable-Keys nicht.
alter table public.app_kv    enable row level security;
alter table public.app_auth  enable row level security;
alter table public.app_users enable row level security;
