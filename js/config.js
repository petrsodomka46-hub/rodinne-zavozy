// Nastavení aplikace.
// SUPABASE_URL a SUPABASE_ANON_KEY najdete v Supabase: Project Settings → API.
// Dokud jsou prázdné, aplikace běží v DEMO režimu (data jen v tomto prohlížeči).
export const SUPABASE_URL = 'https://dnmwhftbdudyfslahpwd.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_3m2Nr1enTxCVP32sqLRjIw_7MtPtsvM';

// Členové rodiny. `email` musí sedět s uživatelem založeným v Supabase
// (Authentication → Users) i se souborem supabase/02_clenove.sql.
export const FAMILY = [
  { key: 'petr',    name: 'Petr',    label: 'Táta', role: 'parent', color: '#2563eb', email: 'petr@zavozy.example' },
  { key: 'miluska', name: 'Miluška', label: 'Máma', role: 'parent', color: '#db2777', email: 'miluska@zavozy.example' },
  { key: 'tomas',   name: 'Tomáš',   label: 'Tomáš', role: 'child', color: '#16a34a', email: 'tomas@zavozy.example' },
  { key: 'elen',    name: 'Elen',    label: 'Elen',  role: 'child', color: '#9333ea', email: 'elen@zavozy.example' },
];

// Na kolik dní dopředu mají mít děti naplánováno.
export const PLAN_AHEAD_DAYS = 14;

// Výchozí název místa pro školu.
export const SCHOOL_PLACE = 'Škola';
