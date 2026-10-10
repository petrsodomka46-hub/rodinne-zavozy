// Práce s datem v místním čase (bez převodů do UTC).

export function today() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function toISO(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function mondayOf(d) {
  return addDays(d, -((d.getDay() + 6) % 7));
}

const DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
const DAYS_SHORT = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];

export function dayName(d) {
  return DAYS[d.getDay()];
}

export function dayShort(d) {
  return DAYS_SHORT[d.getDay()];
}

export function fmtDate(d) {
  return `${d.getDate()}. ${d.getMonth() + 1}.`;
}

export function fmtDayLong(d) {
  const t = today();
  const diff = Math.round((d - t) / 86400000);
  const rel = diff === 0 ? 'Dnes' : diff === 1 ? 'Zítra' : diff === -1 ? 'Včera' : null;
  const name = dayName(d);
  return rel ? `${rel}, ${name} ${fmtDate(d)}` : `${name[0].toUpperCase()}${name.slice(1)} ${fmtDate(d)}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
