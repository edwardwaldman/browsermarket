// Number / date formatting shared by every panel.

export function money(v, dp = 2) {
  if (!Number.isFinite(v)) return '--';
  const neg = v < 0;
  const s = Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  return (neg ? '-$' : '$') + s;
}

/** Compact money for the header cards: $13.8K, $1.24M, $980. */
export function moneyShort(v) {
  if (!Number.isFinite(v)) return '--';
  const neg = v < 0;
  const a = Math.abs(v);
  const sign = neg ? '-$' : '$';
  if (a >= 1e12) return sign + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return sign + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return sign + (a / 1e3).toFixed(1) + 'K';
  if (a >= 1e3) return sign + (a / 1e3).toFixed(2) + 'K';
  return sign + a.toFixed(a < 100 ? 2 : 0);
}

export function num(v, dp = 2) {
  if (!Number.isFinite(v)) return '--';
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function compact(v, dp = 1) {
  if (!Number.isFinite(v)) return '--';
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e12) return sign + (a / 1e12).toFixed(dp) + 'T';
  if (a >= 1e9) return sign + (a / 1e9).toFixed(dp) + 'B';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(dp) + 'M';
  if (a >= 1e3) return sign + (a / 1e3).toFixed(dp) + 'K';
  return sign + a.toFixed(0);
}

export function pct(v, dp = 2) {
  if (!Number.isFinite(v)) return '--';
  return (v >= 0 ? '+' : '') + v.toFixed(dp) + '%';
}

export function signed(v, dp = 2) {
  if (!Number.isFinite(v)) return '--';
  return (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(dp);
}

export function signedShort(v) {
  if (!Number.isFinite(v)) return '--';
  return (v >= 0 ? '+' : '-') + moneyShort(Math.abs(v)).replace('$', '$');
}

/** Price precision scales with magnitude, like a real tape. */
export function price(v) {
  if (!Number.isFinite(v)) return '--';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(2);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(4);
  return v.toFixed(6);
}

export function qty(v) {
  if (!Number.isFinite(v)) return '--';
  if (Math.abs(v) >= 1000) return v.toFixed(2);
  return parseFloat(v.toFixed(4)).toString();
}

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Game clock: minute-of-day -> "10:23 AM". */
export function clockTime(minuteOfDay) {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = Math.floor(m % 60);
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(mm).padStart(2, '0')} ${ampm}`;
}

export function dayName(dayIndex) {
  return DAY_NAMES[(dayIndex + 1) % 7];
}

/** Synthetic calendar date for the P&L calendar, day 0 = 2031-01-01. */
export function gameDate(dayIndex) {
  const d = new Date(Date.UTC(2031, 0, 1));
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return d;
}

export function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

export function ago(ticks) {
  if (ticks < 1) return 'now';
  if (ticks < 60) return `${Math.floor(ticks)}m ago`;
  if (ticks < 1440) return `${Math.floor(ticks / 60)}h ago`;
  return `${Math.floor(ticks / 1440)}d ago`;
}
