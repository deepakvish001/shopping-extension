// Calendar days in India time (UTC+5:30), used to bucket price reports.

const IST_OFFSET_MS = 330 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" of the India-time calendar day containing `t`. */
export function istDay(t) {
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Epoch ms of India-time midnight starting `day`. */
export function dayStart(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
}

/** "7 Nov 2026" */
export function formatDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}
