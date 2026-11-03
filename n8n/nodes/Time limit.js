// ============================================================
// QUIET HOURS
// Нічний режим: з 22:00 до 08:00 за Києвом сигнал не йде
// ============================================================

const QUIET_FROM = 22;   // включно
const QUIET_TO   = 8;    // не включно

const now = new Date();

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

return [{
  json: {
    quiet,
    localTime,
    message: quiet
      ? `Нічний режим: сигнал не надсилається з ${QUIET_FROM}:00 до 0${QUIET_TO}:00 за Києвом. Зараз ${localTime}.`
      : null
  }
}];
