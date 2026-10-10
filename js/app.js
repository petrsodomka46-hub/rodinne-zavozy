import { createApi, DEMO } from './api.js';
import { FAMILY, PLAN_AHEAD_DAYS, SCHOOL_PLACE } from './config.js';
import { today, addDays, toISO, fromISO, mondayOf, fmtDate, fmtDayLong, dayShort, esc } from './util.js';

const KINDS = {
  school_to:     { label: 'Do školy',   icon: '🏫', timeLabel: 'odjezd',     school: true },
  school_from:   { label: 'Ze školy',   icon: '🏠', timeLabel: 'vyzvednout', school: true },
  activity_to:   { label: 'Na kroužek', icon: '⚽', timeLabel: 'odjezd' },
  activity_from: { label: 'Z kroužku',  icon: '🏠', timeLabel: 'vyzvednout' },
  other_to:      { label: 'Odvézt jinam',     icon: '📌', timeLabel: 'odjezd' },
  other_from:    { label: 'Vyzvednout jinde', icon: '📌', timeLabel: 'vyzvednout' },
};
const RETURN_KIND = { school_to: 'school_from', activity_to: 'activity_from', other_to: 'other_from' };
const PLACE_FIELD = {
  activity_to:   ['Kam (kroužek)', 'např. Fotbal – stadion'],
  activity_from: ['Odkud (kroužek)', 'např. Fotbal – stadion'],
  other_to:      ['Kam potřebuješ odvézt', 'např. k babičce, k doktorovi, na oslavu k Aničce'],
  other_from:    ['Odkud vyzvednout', 'např. od kamaráda Honzy, z nádraží'],
};
const RETURN_LABEL = {
  school_to: 'Ze školy vyzvednout v (nepovinné)',
  activity_to: 'Z kroužku vyzvednout v (nepovinné)',
  other_to: 'Zpět vyzvednout v (nepovinné)',
};
// Způsoby, které si dítě může zvolit samo (bez řidiče z rodiny).
// Ty rodiče nepotvrzují.
const SELF_MODES = [['walk', '🚶 Pěšky'], ['bike', '🚲 Na kole'], ['scooter', '🛵 Na skútru'], ['bus', '🚌 Autobus']];
const isSelf = (r) => SELF_MODES.some(([k]) => k === r.mode);
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

const S = {
  api: null,
  me: null,
  people: {},
  rides: [],
  week: mondayOf(today()),
  tab: 'week',
  filter: store('filter') || 'all',
  form: null,
};

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');

// ------------------------------------------------------------ pomocné

function store(k, v) {
  try {
    if (v === undefined) return localStorage.getItem('zavozy-' + k);
    if (v === null) localStorage.removeItem('zavozy-' + k);
    else localStorage.setItem('zavozy-' + k, v);
  } catch { /* soukromé okno */ }
  return null;
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let toastTimer;
function toast(msg, isError = false) {
  $toast.textContent = msg;
  $toast.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.className = 'toast'; }, isError ? 4500 : 2200);
}

async function run(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    await refresh();
    return true;
  } catch (e) {
    toast(e.message || 'Něco se nepovedlo.', true);
    return false;
  }
}

const isParent = () => S.me?.role === 'parent';
const children = () => Object.values(S.people).filter((p) => p.role === 'child');
const parents = () => Object.values(S.people).filter((p) => p.role === 'parent');
const todayISO = () => toISO(today());
const rideById = (id) => S.rides.find((r) => r.id === id);
const initial = (p) => esc(p.name[0]);
const rideCount = (n) => `${n} ${n === 1 ? 'jízda' : n >= 2 && n <= 4 ? 'jízdy' : 'jízd'}`;

function howText(r) {
  switch (r.mode) {
    case 'parent': {
      const p = S.people[r.driver_id];
      if (!p) return 'Veze rodič';
      return p.id === S.me.id ? 'Vezu já' : `Veze ${p.label.toLowerCase()}`;
    }
    case 'walk': return 'Pěšky';
    case 'bus': return 'Autobusem';
    case 'bike': return 'Jede na kole';
    case 'scooter': return 'Jede na skútru';
    case 'other': return r.other_name ? `Veze: ${r.other_name}` : 'S jiným rodičem';
    default: return 'Potřebuje odvoz';
  }
}

function status(r) {
  if (r.cancelled) return { cls: 'cancelled', text: 'Zrušeno' };
  if (!r.confirmed_at && !isSelf(r)) {
    return r.mode === 'need'
      ? { cls: 'need', text: 'Potřebuje odvoz' }
      : { cls: 'pending', text: `${howText(r)} · čeká na potvrzení` };
  }
  return { cls: 'ok', text: howText(r) };
}

function placeText(r) {
  const k = KINDS[r.kind];
  if (k.school && (!r.place || r.place === SCHOOL_PLACE)) return '';
  return r.place;
}

// Poslední pracovní den, do kterého mají mít děti naplánováno.
function requiredUntil() {
  let d = addDays(today(), PLAN_AHEAD_DAYS);
  while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, -1);
  return toISO(d);
}

function coverage() {
  const need = requiredUntil();
  return children().map((c) => {
    const until = S.rides
      .filter((r) => r.child_id === c.id && !r.cancelled)
      .reduce((m, r) => (r.ride_date > m ? r.ride_date : m), '');
    return { c, until, ok: until >= need };
  });
}

function pendingRides() {
  const t = todayISO();
  return S.rides.filter((r) => r.ride_date >= t && (r.cancelled || (!r.confirmed_at && !isSelf(r))));
}

function groupByDate(rides) {
  const g = new Map();
  rides.forEach((r) => {
    if (!g.has(r.ride_date)) g.set(r.ride_date, []);
    g.get(r.ride_date).push(r);
  });
  return g;
}

// ------------------------------------------------------------ přihlášení

function renderLogin(pickedKey) {
  const picked = FAMILY.find((f) => f.key === pickedKey);
  $app.innerHTML = `
    <div class="login">
      <div class="login-logo">🚗</div>
      <h1>Rodinné závozy</h1>
      <p class="muted">${picked ? 'Zadej heslo' : 'Kdo jsi?'}</p>
      <div class="people">
        ${FAMILY.map((f) => `
          <button class="person ${f.key === pickedKey ? 'picked' : ''}" data-action="pick-user" data-key="${f.key}" style="--c:${f.color}">
            <span class="avatar lg">${esc(f.name[0])}</span>
            <span>${esc(f.name)}</span>
          </button>`).join('')}
      </div>
      ${picked ? `
        <form class="login-form" id="login-form">
          <input type="email" name="username" autocomplete="username" value="${esc(picked.email)}" hidden>
          ${DEMO ? '' : '<input type="password" name="password" autocomplete="current-password" placeholder="Heslo" required>'}
          <button class="btn primary block" type="submit">Přihlásit se jako ${esc(picked.name)}</button>
        </form>` : ''}
      ${DEMO ? '<p class="demo-note">DEMO režim – data se ukládají jen v tomto zařízení. Heslo není potřeba.</p>' : ''}
      ${installHint()}
    </div>`;
  const form = document.getElementById('login-form');
  if (!form) return;
  form.querySelector('[name=password]')?.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await S.api.signIn(picked.email, form.password?.value || '');
      await enter(await S.api.session());
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });
}

function installHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!ios || navigator.standalone || store('hint-off')) return '';
  return `<div class="install-hint">
      📲 <b>Přidej si aplikaci na plochu:</b> v Safari klepni na <b>Sdílet</b> (čtvereček se šipkou) → <b>Přidat na plochu</b>.
      <button class="link" data-action="hint-off">Skrýt</button>
    </div>`;
}

async function enter(sess) {
  if (!sess) return renderLogin();
  const members = await S.api.members();
  S.people = {};
  members.forEach((m) => {
    const f = FAMILY.find((x) => x.key === m.key);
    if (f) S.people[m.id] = { ...f, ...m };
  });
  S.me = S.people[sess.userId];
  if (!S.me) {
    $app.innerHTML = `<div class="login"><h1>Účet není propojený</h1>
      <p class="muted">Přihlášení proběhlo, ale účet ${esc(sess.email)} chybí v tabulce členů.
      Spusťte v Supabase skript <code>supabase/02_clenove.sql</code>.</p>
      <button class="btn" data-action="logout">Odhlásit</button></div>`;
    return;
  }
  S.tab = 'week';
  S.api.subscribe(debounce(refresh, 300));
  await refresh();
}

// ------------------------------------------------------------ hlavní obrazovka

async function refresh() {
  if (!S.me) return;
  const from = S.week < addDays(today(), -7) ? S.week : addDays(today(), -7);
  try {
    S.rides = await S.api.rides(toISO(from));
  } catch (e) {
    toast('Nepodařilo se načíst data: ' + e.message, true);
  }
  render();
}

function render() {
  const tabs = isParent()
    ? [['week', '📅', 'Týden'], ['todo', '✅', 'K vyřízení'], ['mine', '🚗', 'Řídím']]
    : [['week', '📅', 'Týden'], ['mine', '🎒', 'Moje jízdy']];
  const todoCount = isParent() ? pendingRides().length : 0;
  const views = { week: viewWeek, todo: viewTodo, mine: isParent() ? viewDriving : viewMine };
  const scrollY = window.scrollY;

  $app.innerHTML = `
    <header class="topbar">
      <div class="topbar-title">${S.tab === 'week' ? weekNav() : `<h1>${tabs.find((t) => t[0] === S.tab)[2]}</h1>`}</div>
      <button class="avatar" style="--c:${S.me.color}" data-action="settings" aria-label="Nastavení">${initial(S.me)}</button>
    </header>
    <main class="content">${views[S.tab]()}</main>
    <button class="fab" data-action="add" aria-label="Přidat jízdu">＋</button>
    <nav class="tabbar">
      ${tabs.map(([k, ic, label]) => `
        <button class="tab ${S.tab === k ? 'active' : ''}" data-action="tab" data-tab="${k}">
          <span class="tab-ic">${ic}${k === 'todo' && todoCount ? `<span class="badge">${todoCount}</span>` : ''}</span>
          <span>${label}</span>
        </button>`).join('')}
    </nav>
    ${DEMO ? '<div class="demo-ribbon">DEMO</div>' : ''}`;
  window.scrollTo(0, scrollY);
}

function weekNav() {
  const end = addDays(S.week, 6);
  const isCurrent = toISO(S.week) === toISO(mondayOf(today()));
  return `<div class="weeknav">
      <button class="icon-btn" data-action="week" data-d="-7" aria-label="Předchozí týden">‹</button>
      <div class="weeknav-label">
        <b>${fmtDate(S.week)} – ${fmtDate(end)}</b>
        ${isCurrent ? '<small>tento týden</small>' : '<button class="link small" data-action="week" data-d="0">zpět na dnešek</button>'}
      </div>
      <button class="icon-btn" data-action="week" data-d="7" aria-label="Další týden">›</button>
    </div>`;
}

function rideCard(r, { showDate = false, quick = false } = {}) {
  const child = S.people[r.child_id];
  const k = KINDS[r.kind];
  const st = status(r);
  const place = placeText(r);
  let actions = '';
  if (quick && isParent()) {
    if (r.cancelled) {
      actions = `<button class="btn small" data-action="delete-now" data-id="${r.id}">Odstranit</button>`;
    } else if (r.mode === 'need') {
      actions = parents().map((p) => `
        <button class="btn small driver" style="--c:${p.color}" data-action="quick-assign" data-id="${r.id}" data-driver="${p.id}">${esc(p.label)}</button>`).join('');
    } else {
      actions = `<button class="btn small primary" data-action="quick-confirm" data-id="${r.id}">Potvrdit</button>`;
    }
  }
  return `
    <div class="ride st-${st.cls}" style="--c:${child?.color || '#64748b'}" data-action="open" data-id="${r.id}" role="button" tabindex="0">
      <div class="ride-time"><b>${r.ride_time}</b><small>${k.timeLabel}</small></div>
      <div class="ride-main">
        <div class="ride-title"><span class="dot"></span>${esc(child?.name || '?')} · ${k.icon} ${k.label}${showDate ? ` <span class="muted">· ${dayShort(fromISO(r.ride_date))} ${fmtDate(fromISO(r.ride_date))}</span>` : ''}</div>
        ${place ? `<div class="ride-place">📍 ${esc(place)}</div>` : ''}
        <div class="ride-status"><span class="pill st-${st.cls}">${esc(st.text)}</span></div>
        ${r.note ? `<div class="ride-note">📝 ${esc(r.note)}</div>` : ''}
        ${actions ? `<div class="ride-actions">${actions}<button class="btn small ghost" data-action="open" data-id="${r.id}">Jinak…</button></div>` : ''}
      </div>
    </div>`;
}

function coverageBanner() {
  const cov = coverage();
  const mine = isParent() ? cov : cov.filter((x) => x.c.id === S.me.id);
  const bad = mine.filter((x) => !x.ok);
  if (!bad.length) return '';
  const need = fmtDate(fromISO(requiredUntil()));
  const lines = bad.map((x) => {
    const until = x.until ? `jen do ${fmtDate(fromISO(x.until))}` : 'zatím nic';
    return isParent() ? `<li><b>${esc(x.c.name)}</b> má naplánováno ${until}</li>` : `<li>Máš naplánováno ${until}</li>`;
  }).join('');
  return `<div class="banner warn">
      <div><b>⏰ Plán na ${PLAN_AHEAD_DAYS} dní dopředu (do ${need})</b><ul>${lines}</ul></div>
      ${isParent() ? '' : '<button class="btn small primary" data-action="add">Doplnit</button>'}
    </div>`;
}

function viewWeek() {
  const kids = children();
  const filterChips = `<div class="chips filter">
      <button class="chip ${S.filter === 'all' ? 'on' : ''}" data-action="filter" data-v="all">Všichni</button>
      ${kids.map((c) => `<button class="chip ${S.filter === c.id ? 'on' : ''}" style="--c:${c.color}" data-action="filter" data-v="${c.id}"><span class="dot"></span>${esc(c.name)}</button>`).join('')}
    </div>`;
  const t = todayISO();
  const days = [...Array(7)].map((_, i) => addDays(S.week, i));
  const byDate = groupByDate(S.rides.filter((r) => S.filter === 'all' || r.child_id === S.filter));
  const html = days.map((d) => {
    const iso = toISO(d);
    const list = byDate.get(iso) || [];
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    if (weekend && !list.length && iso !== t) return '';
    return `<section class="day ${iso === t ? 'today' : ''} ${iso < t ? 'past' : ''}">
        <h2>${fmtDayLong(d)}</h2>
        ${list.length ? list.map((r) => rideCard(r)).join('') : `<button class="empty" data-action="add" data-date="${iso}">Nic naplánováno – přidat</button>`}
      </section>`;
  }).join('');
  return coverageBanner() + filterChips + html;
}

function listByDate(rides, opts, emptyText) {
  if (!rides.length) return `<div class="empty-state">${emptyText}</div>`;
  return [...groupByDate(rides)].map(([iso, list]) => `
      <section class="day"><h2>${fmtDayLong(fromISO(iso))}</h2>${list.map((r) => rideCard(r, opts)).join('')}</section>`).join('');
}

function viewTodo() {
  const pend = pendingRides();
  const confirmable = pend.filter((r) => !r.cancelled && r.mode !== 'need');
  const bulk = confirmable.length > 1
    ? `<button class="btn block" data-action="confirm-all">Potvrdit všechny s jiným rodičem (${confirmable.length})</button>` : '';
  return coverageBanner() + bulk + listByDate(pend, { quick: true }, '🎉 Vše je vyřízené.');
}

function viewDriving() {
  const t = todayISO();
  const mine = S.rides.filter((r) => r.ride_date >= t && !r.cancelled && r.mode === 'parent' && r.driver_id === S.me.id);
  const weekEnd = toISO(addDays(mondayOf(today()), 6));
  const thisWeek = mine.filter((r) => r.ride_date <= weekEnd).length;
  const head = mine.length ? `<p class="muted center">Tento týden řídíš ${thisWeek}×, celkem naplánováno ${mine.length}×.</p>` : '';
  return head + listByDate(mine, {}, 'Zatím nemáš žádné jízdy.');
}

function viewMine() {
  const t = todayISO();
  const mine = S.rides.filter((r) => r.ride_date >= t && r.child_id === S.me.id);
  return coverageBanner() + listByDate(mine, {}, 'Zatím nemáš nic naplánováno. Přidej jízdu tlačítkem ＋.');
}

// ------------------------------------------------------------ spodní panely (sheets)

function openSheet(html) {
  $sheet.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet-panel" role="dialog" aria-modal="true">
      <div class="sheet-grip"></div>
      <button class="sheet-close icon-btn" data-action="close-sheet" aria-label="Zavřít">✕</button>
      ${html}
    </div>`;
  $sheet.classList.add('open');
  document.body.classList.add('noscroll');
  return $sheet.querySelector('.sheet-panel');
}

function closeSheet() {
  $sheet.classList.remove('open');
  $sheet.innerHTML = '';
  document.body.classList.remove('noscroll');
  S.form = null;
}

let chooseResolve = null;
function choose(title, text, options) {
  return new Promise((resolve) => {
    chooseResolve = resolve;
    openSheet(`<h2>${esc(title)}</h2>${text ? `<p class="muted">${esc(text)}</p>` : ''}
      <div class="stack">${options.map((o) => `<button class="btn block ${o.cls || ''}" data-action="choose" data-v="${o.value}">${esc(o.label)}</button>`).join('')}
      <button class="btn block ghost" data-action="choose" data-v="">Zpět</button></div>`);
  });
}

function openRide(id) {
  const r = rideById(id);
  if (!r) return;
  const child = S.people[r.child_id];
  const k = KINDS[r.kind];
  const st = status(r);
  const mineToEdit = isParent() || r.child_id === S.me.id;
  const by = (pid) => esc(S.people[pid]?.name || '?');
  let assign = '';
  if (isParent() && !r.cancelled) {
    const opt = (key, label, extra = '') => {
      const sel = (key === 'p:' + r.driver_id && r.mode === 'parent') || key === r.mode;
      return `<button class="opt ${sel ? 'on' : ''} ${sel && !r.confirmed_at && !isSelf(r) ? 'unconfirmed' : ''}" data-action="assign" data-v="${key}" ${extra}>${label}</button>`;
    };
    assign = `<h3>Kdo to zajistí?</h3>
      <div class="opts">
        ${parents().map((p) => opt('p:' + p.id, `🚗 ${esc(p.label)}`, `style="--c:${p.color}"`)).join('')}
        ${SELF_MODES.map(([k, l]) => opt(k, l)).join('')}
        ${opt('other', '👥 Jiný rodič')}
      </div>
      <div class="other-row" id="other-row" ${r.mode === 'other' ? '' : 'hidden'}>
        <input id="other-name" placeholder="Kdo? (např. Novákovi)" value="${esc(r.other_name || '')}">
        <button class="btn primary" data-action="assign-other">Uložit</button>
      </div>
      ${r.series_id ? `<label class="check"><input type="checkbox" id="assign-series"> Použít i pro všechny další jízdy této řady</label>` : ''}
      ${r.mode !== 'need' && !r.confirmed_at && !isSelf(r) ? '<button class="btn primary block" data-action="confirm-ride">Potvrdit</button>' : ''}`;
  }
  const meta = [
    r.created_by ? `Zadal(a): ${by(r.created_by)}` : '',
    r.confirmed_by ? `Potvrdil(a): ${by(r.confirmed_by)}` : '',
    r.series_id ? 'Opakovaná jízda' : '',
  ].filter(Boolean).join(' · ');

  openSheet(`
    <div class="detail-head" style="--c:${child?.color}">
      <span class="avatar">${child ? initial(child) : '?'}</span>
      <div>
        <h2>${esc(child?.name)} · ${k.icon} ${k.label}</h2>
        <div class="muted">${fmtDayLong(fromISO(r.ride_date))} · ${k.timeLabel} <b>${r.ride_time}</b></div>
      </div>
    </div>
    ${placeText(r) ? `<p>📍 ${esc(placeText(r))}</p>` : ''}
    <p><span class="pill st-${st.cls}">${esc(st.text)}</span></p>
    ${r.note ? `<p class="note">📝 ${esc(r.note)}</p>` : ''}
    ${assign}
    ${mineToEdit ? `<div class="row">
        ${r.cancelled ? '' : `<button class="btn" data-action="edit" data-id="${r.id}">✏️ Upravit</button>`}
        ${r.cancelled && isParent() ? `<button class="btn" data-action="restore" data-id="${r.id}">↩️ Obnovit</button>` : ''}
        <button class="btn danger" data-action="delete" data-id="${r.id}">${!isParent() && r.confirmed_at && !r.cancelled ? '🚫 Zrušit' : '🗑️ Smazat'}</button>
      </div>` : ''}
    ${meta ? `<p class="meta">${meta}</p>` : ''}`);
  $sheet.dataset.ride = r.id;
}

async function assignRide(r, key, otherName) {
  const series = document.getElementById('assign-series')?.checked && r.series_id;
  const mode = key.startsWith('p:') ? 'parent' : key;
  const patch = {
    mode,
    driver_id: mode === 'parent' ? key.slice(2) : null,
    other_name: mode === 'other' ? otherName : null,
    confirmed_by: S.me.id,
    confirmed_at: new Date().toISOString(),
    cancelled: false,
  };
  const ok = await run(() => (series
    ? S.api.updateSeries(r.series_id, r.ride_date, patch)
    : S.api.update(r.id, patch)), series ? 'Uloženo pro celou řadu' : 'Potvrzeno');
  if (ok) closeSheet();
}

async function deleteRide(r) {
  if (!isParent() && r.confirmed_at && !r.cancelled) {
    const v = await choose('Zrušit jízdu?', 'Rodiče uvidí, že jízda je zrušená.', [{ value: 'yes', label: 'Ano, zrušit', cls: 'danger' }]);
    if (v === 'yes') { closeSheet(); await run(() => S.api.update(r.id, { cancelled: true }), 'Zrušeno'); }
    else closeSheet();
    return;
  }
  const opts = [{ value: 'one', label: 'Smazat jen tuto jízdu', cls: 'danger' }];
  if (r.series_id) opts.push({ value: 'series', label: 'Smazat tuto a všechny další v řadě', cls: 'danger' });
  const v = await choose('Smazat jízdu?', '', opts);
  closeSheet();
  if (v === 'one') await run(() => S.api.remove(r.id), 'Smazáno');
  if (v === 'series') await run(() => S.api.removeSeries(r.series_id, r.ride_date), 'Řada smazána');
}

// ------------------------------------------------------------ formulář

function openForm({ ride = null, date = null } = {}) {
  const kids = children();
  const t = todayISO();
  const childId = ride?.child_id || (isParent() ? (S.filter !== 'all' ? S.filter : kids[0]?.id) : S.me.id);
  const startDate = ride?.ride_date || (date && date >= t ? date : t);
  S.form = {
    ride,
    child: childId,
    kind: ride?.kind || 'school_to',
    mode: ride ? (ride.mode === 'parent' ? 'p:' + ride.driver_id : ride.mode) : 'need',
    days: new Set([fromISO(startDate).getDay()]),
  };
  const places = [...new Set(S.rides.map((r) => r.place).filter((p) => p && p !== SCHOOL_PLACE))].sort();
  const modeOpts = [
    ['need', '🙋 Potřebuji odvoz'],
    ...(isParent() ? parents().map((p) => ['p:' + p.id, `🚗 Veze ${p.label.toLowerCase()}`]) : []),
    ...SELF_MODES, ['other', '👥 S jiným rodičem'],
  ];
  const chip = (group, value, label, on, extra = '') =>
    `<button type="button" class="chip ${on ? 'on' : ''}" data-action="chip" data-group="${group}" data-v="${value}" ${extra}>${label}</button>`;

  openSheet(`
    <h2>${ride ? 'Upravit jízdu' : 'Nová jízda'}</h2>
    <form id="ride-form" class="form" novalidate>
      ${isParent() ? `<label class="lbl">Pro koho</label>
        <div class="chips">${kids.map((c) => chip('child', c.id, `<span class="dot"></span>${esc(c.name)}`, c.id === childId, `style="--c:${c.color}"`)).join('')}</div>` : ''}

      <label class="lbl">Co <span class="small">(📌 = ostatní: k doktorovi, na oslavu, k babičce…)</span></label>
      <div class="chips grid2">${Object.entries(KINDS).map(([k, v]) => chip('kind', k, `${v.icon} ${v.label}`, k === S.form.kind)).join('')}</div>

      <div id="place-wrap">
        <label class="lbl" for="f-place" id="place-lbl">Kam</label>
        <input id="f-place" list="places" value="${esc(ride && !KINDS[ride.kind].school ? ride.place : '')}" autocomplete="off">
        <datalist id="places">${places.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      </div>

      <div class="row2">
        <div><label class="lbl" for="f-date">Datum</label><input type="date" id="f-date" value="${startDate}" ${isParent() ? '' : `min="${t}"`}></div>
        <div><label class="lbl" for="f-time" id="time-lbl">Čas</label><input type="time" id="f-time" value="${ride?.ride_time || ''}"></div>
      </div>

      ${ride ? '' : `<div id="return-wrap">
        <label class="lbl" for="f-return" id="return-lbl">Cesta zpět – vyzvednout v (nepovinné)</label>
        <input type="time" id="f-return">
      </div>`}

      <label class="lbl">Jak</label>
      <div class="chips">${modeOpts.map(([k, l]) => chip('mode', k, l, k === S.form.mode)).join('')}</div>
      <div id="other-wrap"><input id="f-other" placeholder="S kým? (např. Novákovi)" value="${esc(ride?.other_name || '')}"></div>

      <label class="lbl" for="f-note">Poznámka</label>
      <input id="f-note" placeholder="např. trénink skončí dřív, jede se mnou kamarád" value="${esc(ride?.note || '')}">

      ${ride ? (ride.series_id ? `<label class="lbl">Změnit</label>
        <div class="chips">${chip('scope', 'one', 'Jen tuto jízdu', true)}${chip('scope', 'series', 'Tuto a všechny další')}</div>` : '') : `
        <label class="check"><input type="checkbox" id="f-repeat"> 🔁 Opakovat každý týden</label>
        <div id="repeat-wrap" hidden>
          <div class="chips days">${WEEKDAYS.map((d) => chip('day', d, dayShort(new Date(2024, 0, 7 + d)), S.form.days.has(d))).join('')}</div>
          <label class="lbl" for="f-until">Až do</label>
          <input type="date" id="f-until" value="${toISO(addDays(fromISO(startDate), 27))}">
          <p class="muted small" id="repeat-info"></p>
        </div>`}

      <button class="btn primary block" type="submit">${ride ? 'Uložit změny' : 'Přidat'}</button>
    </form>`);
  if (ride?.series_id) S.form.scope = 'one';

  const form = document.getElementById('ride-form');
  form.addEventListener('input', syncForm);
  form.addEventListener('change', syncForm);
  form.addEventListener('submit', (e) => { e.preventDefault(); saveForm(); });
  syncForm();
}

function selectedDates() {
  const start = document.getElementById('f-date').value;
  const repeat = document.getElementById('f-repeat')?.checked;
  if (!start) return [];
  if (!repeat) return [start];
  const until = document.getElementById('f-until').value || start;
  const out = [];
  const limit = addDays(fromISO(start), 7 * 26);
  for (let d = fromISO(start); toISO(d) <= until && d <= limit; d = addDays(d, 1)) {
    if (S.form.days.has(d.getDay())) out.push(toISO(d));
  }
  return out;
}

function syncForm() {
  const f = S.form;
  if (!f) return;
  const k = KINDS[f.kind];
  document.getElementById('place-wrap').hidden = !!k.school;
  if (PLACE_FIELD[f.kind]) {
    document.getElementById('place-lbl').textContent = PLACE_FIELD[f.kind][0];
    document.getElementById('f-place').placeholder = PLACE_FIELD[f.kind][1];
  }
  document.getElementById('time-lbl').textContent = k.timeLabel === 'odjezd' ? 'Čas odjezdu' : 'Čas vyzvednutí';
  document.getElementById('other-wrap').hidden = f.mode !== 'other';
  const ret = document.getElementById('return-wrap');
  if (ret) {
    ret.hidden = !RETURN_KIND[f.kind];
    if (RETURN_LABEL[f.kind]) document.getElementById('return-lbl').textContent = RETURN_LABEL[f.kind];
  }
  const rep = document.getElementById('f-repeat');
  const dateVal = document.getElementById('f-date').value;
  if (rep && !f.daysTouched && dateVal) {
    f.days = new Set([fromISO(dateVal).getDay()]);
    document.querySelectorAll('[data-group=day]').forEach((c) => c.classList.toggle('on', f.days.has(Number(c.dataset.v))));
  }
  if (rep) {
    document.getElementById('repeat-wrap').hidden = !rep.checked;
    if (rep.checked) {
      const n = selectedDates().length * (document.getElementById('f-return')?.value && RETURN_KIND[f.kind] ? 2 : 1);
      document.getElementById('repeat-info').textContent = `Vytvoří se ${rideCount(n)}.`;
    }
  }
}

async function saveForm() {
  const f = S.form;
  const k = KINDS[f.kind];
  const val = (id) => document.getElementById(id)?.value.trim() || '';
  const place = k.school ? SCHOOL_PLACE : val('f-place');
  const time = val('f-time');
  const date = val('f-date');
  const other = val('f-other');
  if (!f.child) return toast('Vyber, pro koho jízda je.', true);
  if (!date) return toast('Vyplň datum.', true);
  if (!time) return toast('Vyplň čas.', true);
  if (!k.school && !place) return toast('Napiš, kam se jede.', true);
  if (f.mode === 'other' && !other) return toast('Napiš, s kým pojedeš.', true);
  if (!isParent() && date < todayISO()) return toast('Datum nemůže být v minulosti.', true);

  const mode = f.mode.startsWith('p:') ? 'parent' : f.mode;
  const base = {
    child_id: f.child,
    kind: f.kind,
    place,
    ride_time: time,
    mode,
    driver_id: mode === 'parent' ? f.mode.slice(2) : null,
    other_name: mode === 'other' ? other : null,
    note: val('f-note') || null,
  };
  if (isParent()) {
    const confirmed = mode !== 'need';
    base.confirmed_by = confirmed ? S.me.id : null;
    base.confirmed_at = confirmed ? new Date().toISOString() : null;
  }

  let ok;
  if (f.ride) {
    if (f.scope === 'series') {
      ok = await run(() => S.api.updateSeries(f.ride.series_id, f.ride.ride_date, base), 'Řada upravena');
    } else {
      ok = await run(() => S.api.update(f.ride.id, { ...base, ride_date: date }), 'Uloženo');
    }
  } else {
    const dates = selectedDates();
    if (!dates.length) return toast('Vyber aspoň jeden den v týdnu.', true);
    const retTime = RETURN_KIND[f.kind] ? val('f-return') : '';
    const multi = dates.length > 1;
    const s1 = multi ? uuid() : null;
    const s2 = multi ? uuid() : null;
    const rows = [];
    dates.forEach((d) => {
      rows.push({ ...base, ride_date: d, series_id: s1 });
      if (retTime) rows.push({ ...base, kind: RETURN_KIND[f.kind], ride_time: retTime, ride_date: d, series_id: s2 });
    });
    ok = await run(() => S.api.insert(rows), rows.length > 1 ? `Přidáno: ${rideCount(rows.length)}` : 'Přidáno');
    if (ok) {
      S.week = mondayOf(fromISO(dates[0]));
      await refresh();
    }
  }
  if (ok) closeSheet();
}

function openSettings() {
  openSheet(`
    <div class="detail-head" style="--c:${S.me.color}">
      <span class="avatar">${initial(S.me)}</span>
      <div><h2>${esc(S.me.name)}</h2><div class="muted">${isParent() ? 'Rodič' : 'Dítě'}</div></div>
    </div>
    ${installHint().replace('install-hint', 'install-hint inline')}
    <div class="stack">
      ${DEMO ? '<button class="btn block" data-action="logout">👤 Přepnout na jiného člena rodiny</button>' : ''}
      ${DEMO ? '<button class="btn block" data-action="reset-demo">♻️ Obnovit ukázková data</button>' : ''}
      ${DEMO ? '' : '<button class="btn block danger" data-action="logout">Odhlásit se</button>'}
    </div>
    <p class="meta">Rodinné závozy${DEMO ? ' · DEMO režim' : ''}</p>`);
}

// ------------------------------------------------------------ akce

const ACTIONS = {
  'pick-user': (el) => renderLogin(el.dataset.key),
  'hint-off': (el) => { store('hint-off', '1'); el.closest('.install-hint')?.remove(); },
  tab: (el) => { S.tab = el.dataset.tab; window.scrollTo(0, 0); render(); },
  week: (el) => {
    const d = Number(el.dataset.d);
    S.week = d === 0 ? mondayOf(today()) : addDays(S.week, d);
    refresh();
  },
  filter: (el) => { S.filter = el.dataset.v; store('filter', S.filter); render(); },
  add: (el) => openForm({ date: el.dataset.date }),
  open: (el) => openRide(el.dataset.id),
  settings: openSettings,
  'close-sheet': () => { if (chooseResolve) { chooseResolve(null); chooseResolve = null; } closeSheet(); },
  choose: (el) => { const r = chooseResolve; chooseResolve = null; r?.(el.dataset.v || null); },
  edit: (el) => { const r = rideById(el.dataset.id); closeSheet(); openForm({ ride: r }); },
  delete: (el) => deleteRide(rideById(el.dataset.id)),
  'delete-now': (el) => run(() => S.api.remove(el.dataset.id), 'Odstraněno'),
  restore: async (el) => { closeSheet(); await run(() => S.api.update(el.dataset.id, { cancelled: false }), 'Obnoveno'); },
  assign: (el) => {
    const r = rideById($sheet.dataset.ride);
    if (el.dataset.v === 'other') {
      document.getElementById('other-row').hidden = false;
      document.getElementById('other-name').focus();
      return;
    }
    assignRide(r, el.dataset.v);
  },
  'assign-other': () => {
    const name = document.getElementById('other-name').value.trim();
    if (!name) return toast('Napiš, kdo dítě poveze.', true);
    assignRide(rideById($sheet.dataset.ride), 'other', name);
  },
  'confirm-ride': () => {
    const r = rideById($sheet.dataset.ride);
    assignRide(r, r.mode === 'parent' ? 'p:' + r.driver_id : r.mode, r.other_name);
  },
  'quick-assign': (el) => run(() => S.api.update(el.dataset.id, {
    mode: 'parent', driver_id: el.dataset.driver, other_name: null,
    confirmed_by: S.me.id, confirmed_at: new Date().toISOString(),
  }), 'Potvrzeno'),
  'quick-confirm': (el) => run(() => S.api.update(el.dataset.id, {
    confirmed_by: S.me.id, confirmed_at: new Date().toISOString(),
  }), 'Potvrzeno'),
  'confirm-all': () => {
    const list = pendingRides().filter((r) => !r.cancelled && r.mode !== 'need');
    const now = new Date().toISOString();
    run(async () => {
      for (const r of list) await S.api.update(r.id, { confirmed_by: S.me.id, confirmed_at: now });
    }, `Potvrzeno: ${rideCount(list.length)}`);
  },
  chip: (el) => {
    const f = S.form;
    const g = el.dataset.group;
    const v = el.dataset.v;
    if (g === 'day') {
      const d = Number(v);
      f.daysTouched = true;
      if (f.days.has(d)) f.days.delete(d); else f.days.add(d);
      el.classList.toggle('on', f.days.has(d));
    } else {
      f[g] = v;
      el.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === el));
    }
    syncForm();
  },
  logout: async () => {
    closeSheet();
    await S.api.signOut();
    S.me = null;
    renderLogin();
  },
  'reset-demo': () => { S.api.resetDemo(); closeSheet(); refresh(); toast('Ukázková data obnovena'); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  e.stopPropagation();
  fn(el, e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $sheet.classList.contains('open')) ACTIONS['close-sheet']();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ride[data-action]')) {
    e.preventDefault();
    openRide(e.target.dataset.id);
  }
});

// iOS uspává aplikaci na pozadí – po návratu načíst čerstvá data.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});

(async function boot() {
  try {
    S.api = await createApi();
    await enter(await S.api.session());
  } catch (e) {
    $app.innerHTML = `<div class="login"><h1>Chyba spuštění</h1><p class="muted">${esc(e.message)}</p>
      <button class="btn" onclick="location.reload()">Zkusit znovu</button></div>`;
  }
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
