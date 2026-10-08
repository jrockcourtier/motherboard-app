-- Motherboard : table des contacts du CRM (à coller une seule fois dans Supabase > SQL Editor > Run)
create table if not exists public.contacts (
  id uuid primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Sécurité : personne ne peut lire la table avec la clé publique ; seul le serveur Vercel (clé secrète) y a accès.
alter table public.contacts enable row level security;
