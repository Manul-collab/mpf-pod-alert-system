// ============================================================
// Тихі години — аналог n8n-ноди «Time limit».
// З 22:00 (включно) до 08:00 (не включно) за Києвом. Intl з timeZone
// сам враховує перехід на літній/зимовий час.
// ============================================================

export const QUIET_FROM = 22;   // включно
export const QUIET_TO   = 8;    // не включно

/**
 * @param {Date} [now] для тестів можна передати будь-який момент часу
 * @returns {{quiet: boolean, localTime: string, message: string|null}}
 */
export function checkQuietHours(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone:  'Europe/Kyiv',
    hour:      '2-digit',
    minute:    '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);

  const hour   = Number(parts.find(p => p.type === 'hour').value);
  const minute = parts.find(p => p.type === 'minute').value;

  // Інтервал перетинає північ, тому умова через АБО
  const quiet = hour >= QUIET_FROM || hour < QUIET_TO;

  const localTime = `${String(hour).padStart(2, '0')}:${minute}`;

  return {
    quiet,
    localTime,
    // "0${QUIET_TO}" — у n8n саме так; дає "08:00", поки QUIET_TO < 10
    message: quiet
      ? `Нічний режим: сигнал не надсилається з ${QUIET_FROM}:00 до 0${QUIET_TO}:00 за Києвом. Зараз ${localTime}.`
      : null
  };
}
