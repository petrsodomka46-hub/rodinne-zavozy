// Datová vrstva: Supabase, nebo DEMO (localStorage), když chybí konfigurace.
import { SUPABASE_URL, SUPABASE_ANON_KEY, FAMILY } from './config.js';
import { addDays, toISO, today } from './util.js';

export const DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;

const SIGNIFICANT = ['ride_date', 'ride_time', 'kind', 'place', 'mode', 'other_name'];

function normTime(t) {
  return (t || '').slice(0, 5);
}

function normalize(r) {
  return { ...r, ride_time: normTime(r.ride_time) };
}

// ---------------------------------------------------------------- Supabase

async function supabaseApi() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  const check = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session ? { userId: data.session.user.id, email: data.session.user.email } : null;
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Špatné heslo.' : error.message);
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async members() {
      return check(await sb.from('members').select('id, key, role'));
    },
    async rides(fromISO) {
      const data = check(await sb.from('rides').select('*').gte('ride_date', fromISO)
        .order('ride_date').order('ride_time'));
      return data.map(normalize);
    },
    async insert(rows) {
      check(await sb.from('rides').insert(rows));
    },
    async update(id, patch) {
      check(await sb.from('rides').update(patch).eq('id', id));
    },
    async updateSeries(seriesId, fromISO, patch) {
      check(await sb.from('rides').update(patch).eq('series_id', seriesId).gte('ride_date', fromISO));
    },
    async remove(id) {
      check(await sb.from('rides').delete().eq('id', id));
    },
    async removeSeries(seriesId, fromISO) {
      check(await sb.from('rides').delete().eq('series_id', seriesId).gte('ride_date', fromISO));
    },
    subscribe(onChange) {
      const ch = sb.channel('rides-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => onChange())
        .subscribe();
      return () => sb.removeChannel(ch);
    },
  };
}

// ---------------------------------------------------------------- DEMO

function demoApi() {
  const KEY = 'zavozy-demo-v1';
  const SESSION = 'zavozy-demo-session';
  const members = FAMILY.map((f) => ({ id: 'demo-' + f.key, key: f.key, role: f.role }));
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  const listeners = new Set();

  const load = () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* prázdné úložiště */ }
    const seeded = seed();
    save(seeded);
    return seeded;
  };
  const save = (rows) => {
    try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch { /* ignorovat */ }
    listeners.forEach((fn) => setTimeout(fn, 0));
  };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const current = () => {
    try { return localStorage.getItem(SESSION); } catch { return null; }
  };

  function seed() {
    const rows = [];
    const t = today();
    const monday = addDays(t, -((t.getDay() + 6) % 7));
    const mk = (child, d, time, kind, place, extra = {}) => rows.push({
      id: uid(), child_id: 'demo-' + child, ride_date: toISO(d), ride_time: time, kind, place,
      mode: 'need', driver_id: null, other_name: null, note: null, series_id: null, cancelled: false,
      created_by: 'demo-' + child, updated_by: null, confirmed_by: null, confirmed_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra,
    });
    const ok = (by, driver) => ({
      ...(driver ? { mode: 'parent', driver_id: 'demo-' + driver } : {}),
      confirmed_by: 'demo-' + by, confirmed_at: new Date().toISOString(),
    });
    for (let i = 0; i < 12; i++) {
      const d = addDays(monday, i);
      const wd = d.getDay();
      if (wd === 0 || wd === 6) continue;
      const past = i < 7;
      mk('tomas', d, '07:20', 'school_to', 'Škola', past ? ok('petr', 'petr') : {});
      mk('elen', d, '07:35', 'school_to', 'Škola', past ? { mode: 'walk', ...ok('miluska') } : { mode: 'walk' });
      mk('elen', d, '13:40', 'school_from', 'Škola', past ? ok('miluska', 'miluska') : {});
      if (wd === 2 || wd === 4) {
        mk('tomas', d, '16:00', 'activity_to', 'Fotbal – stadion', past ? ok('miluska', 'miluska') : {});
        mk('tomas', d, '17:45', 'activity_from', 'Fotbal – stadion',
          past ? { mode: 'other', other_name: 'Novákovi', ...ok('petr') } : {});
      }
      if (wd === 3) {
        mk('elen', d, '15:00', 'activity_to', 'ZUŠ – klavír', { mode: 'bus', ...(past ? ok('petr') : {}) });
        mk('elen', d, '16:30', 'activity_from', 'ZUŠ – klavír', past ? ok('petr', 'petr') : {});
      }
    }
    return rows;
  }

  // Stejná pravidla jako trigger rides_guard v databázi.
  function guard(me, row, old) {
    row.updated_at = new Date().toISOString();
    row.updated_by = me.id;
    if (!old) row.created_by = me.id;
    if (me.role === 'parent') return row;
    if (row.child_id !== me.id) throw new Error('Můžeš zadávat jen své vlastní jízdy.');
    if (!old) {
      if (row.mode === 'parent') row.mode = 'need';
      return { ...row, driver_id: null, confirmed_by: null, confirmed_at: null, cancelled: false };
    }
    const changed = SIGNIFICANT.some((k) => (row[k] ?? '') !== (old[k] ?? ''));
    if (changed) {
      if (row.mode === 'parent') row.mode = 'need';
      return { ...row, driver_id: null, confirmed_by: null, confirmed_at: null };
    }
    return { ...row, mode: old.mode, driver_id: old.driver_id, confirmed_by: old.confirmed_by, confirmed_at: old.confirmed_at };
  }

  const me = () => byId[current()];

  return {
    async session() {
      const id = current();
      if (!id || !byId[id]) return null;
      return { userId: id, email: FAMILY.find((f) => f.key === byId[id].key).email };
    },
    async signIn(email) {
      const f = FAMILY.find((x) => x.email === email);
      try { localStorage.setItem(SESSION, 'demo-' + f.key); } catch { /* ignorovat */ }
    },
    async signOut() {
      try { localStorage.removeItem(SESSION); } catch { /* ignorovat */ }
    },
    async members() {
      return members;
    },
    async rides(fromISO) {
      return load().filter((r) => r.ride_date >= fromISO)
        .sort((a, b) => (a.ride_date + a.ride_time).localeCompare(b.ride_date + b.ride_time));
    },
    async insert(rows) {
      const all = load();
      rows.forEach((r) => all.push(guard(me(), {
        id: uid(), driver_id: null, other_name: null, note: null, series_id: null, cancelled: false,
        confirmed_by: null, confirmed_at: null, created_at: new Date().toISOString(), ...r,
      }, null)));
      save(all);
    },
    async update(id, patch) {
      const all = load();
      const i = all.findIndex((r) => r.id === id);
      if (i < 0) return;
      if (me().role !== 'parent' && all[i].child_id !== me().id) throw new Error('Nemáš oprávnění.');
      all[i] = guard(me(), { ...all[i], ...patch }, all[i]);
      save(all);
    },
    async updateSeries(seriesId, fromISO, patch) {
      const all = load().map((r) => (r.series_id === seriesId && r.ride_date >= fromISO
        ? guard(me(), { ...r, ...patch }, r) : r));
      save(all);
    },
    async remove(id) {
      save(load().filter((r) => r.id !== id));
    },
    async removeSeries(seriesId, fromISO) {
      save(load().filter((r) => !(r.series_id === seriesId && r.ride_date >= fromISO)));
    },
    subscribe(onChange) {
      listeners.add(onChange);
      const onStorage = (e) => { if (e.key === KEY) onChange(); };
      window.addEventListener('storage', onStorage);
      return () => { listeners.delete(onChange); window.removeEventListener('storage', onStorage); };
    },
    resetDemo() {
      try { localStorage.removeItem(KEY); } catch { /* ignorovat */ }
      load();
    },
  };
}

export async function createApi() {
  return DEMO ? demoApi() : supabaseApi();
}
