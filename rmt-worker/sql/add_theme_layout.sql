-- Adds site look/feel settings to the single clinic profile row.
-- Run this once in the Supabase SQL editor.

alter table public.rmt_profile
  add column if not exists theme text not null default 'sage'
    check (theme in ('sage','ocean','blush','midnight','terracotta')),
  add column if not exists layout text not null default 'split'
    check (layout in ('split','centered','fullbleed'));
