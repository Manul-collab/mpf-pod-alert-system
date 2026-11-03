// ============================================================
// Маршрутизація Discord interaction — аналог нод
// Switch2 → (Respond to Webhook_*, Time limit → If2 → menu, command_trader).
//
// Повністю чиста функція: не робить мережевих запитів. Повертає
//   response — що відповісти Discord (status, contentType, body)
//   pushes   — items для Bark (виконати ПІСЛЯ або паралельно з відповіддю,
//              у Worker — через ctx.waitUntil, див. docs/WORKER-MIGRATION.md)
//
// Поведінка 1:1 з n8n, включно з неочевидними місцями (Н1–Н6 у
// docs/ARCHITECTURE.md). Нічого не «виправлено».
// ============================================================

import { checkQuietHours } from './quiet-hours.js';

const EPHEMERAL = 64;   // flags: 64 — повідомлення бачить лише той, хто викликав

const json = body => ({ status: 200, contentType: 'application/json', body });

// --- Код ноди «menu» ---
function buildMenu(cfg) {
  // callerId у n8n теж читається, але не використовується (Н1)
  const options = Object.entries(cfg.traders)
    .map(([key, t]) => ({ label: t.name, value: key }));

  return {
    type: 4,
    data: {
      content: 'Кого викликати?',
      flags: EPHEMERAL,
      components: [{
        type: 1,
        components: [{
          type: 3,
          custom_id: 'trader_select',
          placeholder: 'Оберіть трейдерів',
          min_values: 1,
          max_values: options.length,
          options
        }]
      }]
    }
  };
}

// --- Код ноди «command_trader» ---
export function commandTrader(cfg, sig) {
  // Канал: додаткова перевірка поверх прав Discord
  if (sig.channelId !== cfg.allowedChannel) {
    return [{ denied: true, message: 'Команда доступна лише у визначеному каналі' }];
  }

  const keys = sig.values ?? [];
  const targets = keys.filter(k => cfg.traders[k]);

  if (!targets.length) {
    return [{ denied: true, message: 'Немає кому надсилати' }];
  }

  const summary = targets.map(k => cfg.traders[k].name).join(', ');

  return targets.map(key => {
    const t = cfg.traders[key];
    return {
      denied:     false,
      summary,
      url:        `${cfg.barkServer}/push`,
      device_key: t.barkKey,
      title:      cfg.title,
      body:       cfg.body,
      level:      t.level,
      volume:     t.volume,
      sound:      t.sound,
      call:       t.call,
      group:      'PodAlert',
      discordUrl: cfg.discordLink,
      targetName: t.name
    };
  });
}

/**
 * @param {object} cfg  результат createConfig(env)
 * @param {object} sig  результат verifySignature(...)
 * @param {Date}  [now] для тихих годин
 * @returns {{branch: string, response: object|null, pushes: object[]}}
 */
export function handleInteraction(cfg, sig, now = new Date()) {
  // Switch2, вихід 0: підпис невалідний → 401 (Discord цього вимагає)
  if (sig.valid === false) {
    return {
      branch: 'invalid',
      response: { status: 401, contentType: 'text/plain', body: 'invalid request signature' },
      pushes: []
    };
  }

  // Вихід 1: PING → PONG
  if (sig.type === 1) {
    return { branch: 'ping', response: json({ type: 1 }), pushes: [] };
  }

  // Вихід 2: slash-команда /trader → тихі години → меню
  // Перевірка каналу тут НЕ робиться (Н4), тихі години — тільки тут (Н2)
  if (sig.commandName === 'trader') {
    const q = checkQuietHours(now);
    if (q.quiet) {
      return {
        branch: 'quiet',
        response: json({ type: 4, data: { content: q.message, flags: EPHEMERAL } }),
        pushes: []
      };
    }
    return { branch: 'menu', response: json(buildMenu(cfg)), pushes: [] };
  }

  // Вихід 3: компонент (вибір у select-меню). custom_id не перевіряється (Н5)
  if (sig.type === 3) {
    const items = commandTrader(cfg, sig);
    const first = items[0];   // Respond to Webhook відповідає за першим item
    return {
      branch: 'select',
      response: json({
        type: 4,
        data: {
          content: first.denied ? first.message : `Сигнал надіслано: ${first.summary}`,
          flags: EPHEMERAL
        }
      }),
      // Усі items ідуть у HTTP Request, включно з denied (дефект Д2)
      pushes: items
    };
  }

  // Жоден вихід Switch2 не спрацював (інша команда, autocomplete, modal…):
  // у n8n не виконується жодна Respond to Webhook нода (Н6)
  return { branch: 'unhandled', response: null, pushes: [] };
}
