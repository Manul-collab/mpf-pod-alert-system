# Pod Alert System — повний код з n8n

Усі ноди воркфлоу `Pod-alert-system` по порядку виконання: назва, тип, роль, код або ключові параметри. Згенеровано з `n8n/workflow.json`; секрети й ID замінено на `{{NAME}}` (див. `SECRETS.md`), нікнейми трейдерів — на `trader1…trader5`. Граф і пояснення — `docs/ARCHITECTURE.md`.

```
Pod Alert System → Pod alert config → Signature check → Switch2
  [0] valid=false   → Respond to Webhook_valid
  [1] type=1        → Respond to Webhook_type1
  [2] /trader       → Time limit → If2 → [true] Respond to Webhook | [false] menu → Respond to Webhook_trader
  [3] type=3        → command_trader → Respond to Webhook_type3 → HTTP Request
```

## Зміст

1. Pod Alert System
2. Pod alert config
3. Signature check
4. Switch2
5. Respond to Webhook_valid
6. Respond to Webhook_type1
7. Time limit
8. If2
9. Respond to Webhook
10. menu
11. Respond to Webhook_trader
12. command_trader
13. Respond to Webhook_type3
14. HTTP Request

## 1. Pod Alert System

- **Тип:** `n8n-nodes-base.webhook` v2.1
- **Роль:** Приймає POST-запит interaction від Discord (з сирим тілом для перевірки підпису).
- **Налаштування ноди:** `{"webhookId": "{{N8N_WEBHOOK_ID}}"}`

Параметри:

```json
{
  "httpMethod": "POST",
  "path": "pod-alert",
  "responseMode": "responseNode",
  "options": {
    "rawBody": true
  }
}
```

## 2. Pod alert config

- **Тип:** `n8n-nodes-base.code` v2
- **Роль:** Довідник: усі параметри системи (Bark, Discord, тексти, трейдери) в одному об'єкті.

Код (`n8n/nodes/Pod alert config.js`):

```js
// ============================================================
// POD ALERT — конфігурація
// Єдине місце, де змінюються параметри виклику
// ============================================================

const CONFIG = {
  barkServer: '{{BARK_SERVER_URL}}',

  // Discord
  applicationId:  '{{DISCORD_APPLICATION_ID}}',
  publicKey:      '{{DISCORD_PUBLIC_KEY}}',
  guildId:        '{{DISCORD_GUILD_ID}}',
  allowedChannel: '{{DISCORD_ALLOWED_CHANNEL_ID}}',

  // Текст сповіщення
  title: 'Pod alert',
  body:  'Викликаємо в Discord',

  traders: {
    trader1: {
      name:      'trader1',
      barkKey:   '{{BARK_KEY_TRADER_1}}',
      discordId: '{{DISCORD_ID_TRADER_1}}',
      level:     'critical',
      volume:    10,
      sound:     'sherwoodforest',
      call:      1
    },
    trader2: {
      name:      'trader2',
      barkKey:   '{{BARK_KEY_TRADER_2}}',
      discordId: '{{DISCORD_ID_TRADER_2}}',
      level:     'critical',
      volume:    10,
      sound:     'sherwoodforest',
      call:      1
    },
    trader3: {
      name:      'trader3',
      barkKey:   '{{BARK_KEY_TRADER_3}}',
      discordId: '{{DISCORD_ID_TRADER_3}}',
      level:     'critical',
      volume:    10,
      sound:     'sherwoodforest',
      call:      1
    },
    trader4: {
      name:      'trader4',
      barkKey:   '{{BARK_KEY_TRADER_4}}',
      discordId: '{{DISCORD_ID_TRADER_4}}',
      level:     'critical',
      volume:    10,
      sound:     'sherwoodforest',
      call:      1
    },
    trader5: {
      name:      'trader5',
      barkKey:   '{{BARK_KEY_TRADER_5}}',
      discordId: '{{DISCORD_ID_TRADER_5}}',
      level:     'critical',
      volume:    10,
      sound:     'sherwoodforest',
      call:      1
    }
  }
};

// Геттер не переживає серіалізацію між нодами — збираємо рядок одразу
CONFIG.discordLink = `https://discord.com/channels/${CONFIG.guildId}/${CONFIG.allowedChannel}`;

return [{ json: CONFIG }];
```

## 3. Signature check

- **Тип:** `n8n-nodes-base.code` v2
- **Роль:** Перевіряє Ed25519-підпис Discord і розбирає interaction на поля.

Код (`n8n/nodes/Signature check.js`):

```js
// ============================================================
// SIGNATURE CHECK
// Перевірка підпису Ed25519 від Discord
//
// Discord підписує кожен запит приватним ключем, ми перевіряємо
// публічним. Discord навмисно шле запити зі зламаним підписом —
// на них треба відповісти 401, інакше endpoint не приймається.
// ============================================================

const crypto = require('crypto');

const item = $('Pod Alert System').first();
const cfg  = $('Pod alert config').first().json;

const publicKey = cfg.publicKey;
const headers   = item.json.headers || {};

const signature = headers['x-signature-ed25519'];
const timestamp = headers['x-signature-timestamp'];

// ---- Сире тіло запиту ----
// Підпис рахується над байтами, які надіслав Discord.
// Будь-яка переробка JSON ламає перевірку.
let rawBody = null;

if (item.binary?.data?.data) {
  rawBody = Buffer.from(item.binary.data.data, 'base64').toString('utf8');
} else if (typeof item.json.body === 'string') {
  rawBody = item.json.body;
}

if (!signature || !timestamp || rawBody === null) {
  return [{
    json: {
      valid: false,
      reason: rawBody === null
        ? 'Raw Body вимкнений у ноді Webhook'
        : 'Відсутні заголовки підпису'
    }
  }];
}

// ---- Перевірка ----
let valid = false;

try {
  const key = crypto.createPublicKey({
    key: Buffer.from('302a300506032b6570032100' + publicKey, 'hex'),
    format: 'der',
    type: 'spki'
  });

  valid = crypto.verify(
    null,
    Buffer.from(timestamp + rawBody, 'utf8'),
    key,
    Buffer.from(signature, 'hex')
  );
} catch (e) {
  return [{ json: { valid: false, reason: `Помилка перевірки: ${e.message}` } }];
}

if (!valid) {
  return [{ json: { valid: false, reason: 'Невірний підпис' } }];
}

// ---- Підпис валідний, розбираємо взаємодію ----
const interaction = JSON.parse(rawBody);

return [{
  json: {
    valid: true,
    type:        interaction.type,        // 1 PING, 2 команда, 3 компонент
    commandName: interaction.data?.name ?? null,
    customId:    interaction.data?.custom_id ?? null,
    values:      interaction.data?.values ?? null,
    channelId:   interaction.channel_id,
    callerId:    interaction.member?.user?.id ?? interaction.user?.id ?? null,
    interaction
  }
}];
```

## 4. Switch2

- **Тип:** `n8n-nodes-base.switch` v3.4
- **Роль:** Маршрутизує: невірний підпис / PING / команда /trader / вибір у меню.

Параметри:

```json
{
  "rules": {
    "values": [
      {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 3
          },
          "conditions": [
            {
              "id": "f602ddc1-ff66-40f3-b06a-b12766beef42",
              "leftValue": "={{ $json.valid }}",
              "rightValue": "",
              "operator": {
                "type": "boolean",
                "operation": "false",
                "singleValue": true
              }
            }
          ],
          "combinator": "and"
        }
      },
      {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 3
          },
          "conditions": [
            {
              "id": "233b5d36-13ee-4534-ba18-5136a36a83d8",
              "leftValue": "={{ $json.type }}",
              "rightValue": 1,
              "operator": {
                "type": "number",
                "operation": "equals"
              }
            }
          ],
          "combinator": "and"
        }
      },
      {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 3
          },
          "conditions": [
            {
              "id": "edab603c-fe00-4970-853c-34d12bf7bb1e",
              "leftValue": "={{ $json.commandName }}",
              "rightValue": "trader",
              "operator": {
                "type": "string",
                "operation": "equals",
                "name": "filter.operator.equals"
              }
            }
          ],
          "combinator": "and"
        }
      },
      {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 3
          },
          "conditions": [
            {
              "id": "6e122597-bebc-46a7-a670-c242677aa8bc",
              "leftValue": "={{ $json.type }}",
              "rightValue": 3,
              "operator": {
                "type": "number",
                "operation": "equals"
              }
            }
          ],
          "combinator": "and"
        }
      }
    ]
  },
  "options": {
    "allMatchingOutputs": true
  }
}
```

## 5. Respond to Webhook_valid

- **Тип:** `n8n-nodes-base.respondToWebhook` v1.5
- **Роль:** Відповідає 401 на запит з невірним підписом.

Параметри:

```json
{
  "respondWith": "text",
  "responseBody": "invalid request signature",
  "options": {
    "responseCode": 401
  }
}
```

## 6. Respond to Webhook_type1

- **Тип:** `n8n-nodes-base.respondToWebhook` v1.5
- **Роль:** Відповідає PONG на PING від Discord.

Параметри:

```json
{
  "respondWith": "json",
  "responseBody": "{\"type\": 1}",
  "options": {
    "responseCode": 200
  }
}
```

## 7. Time limit

- **Тип:** `n8n-nodes-base.code` v2
- **Роль:** Визначає, чи зараз тихі години (22:00–08:00 за Києвом).

Код (`n8n/nodes/Time limit.js`):

```js
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
```

## 8. If2

- **Тип:** `n8n-nodes-base.if` v2.3
- **Роль:** У тихі години веде на відповідь «Нічний режим», інакше — на меню.

Параметри:

```json
{
  "conditions": {
    "options": {
      "caseSensitive": true,
      "leftValue": "",
      "typeValidation": "strict",
      "version": 3
    },
    "conditions": [
      {
        "id": "21d6c6f5-a745-4ad5-b503-dc884f3ffa7a",
        "leftValue": "={{ $json.quiet }}",
        "rightValue": "",
        "operator": {
          "type": "boolean",
          "operation": "true",
          "singleValue": true
        }
      }
    ],
    "combinator": "and"
  },
  "options": {}
}
```

## 9. Respond to Webhook

- **Тип:** `n8n-nodes-base.respondToWebhook` v1.5
- **Роль:** Ефемерна відповідь «Нічний режим…».

Параметри:

```json
{
  "respondWith": "json",
  "responseBody": "={{ JSON.stringify({ type: 4, data: { content: $json.message, flags: 64 } }) }}",
  "options": {
    "responseCode": 200
  }
}
```

## 10. menu

- **Тип:** `n8n-nodes-base.code` v2
- **Роль:** Будує ефемерне повідомлення з select-меню всіх трейдерів.

Код (`n8n/nodes/menu.js`):

```js
const cfg    = $('Pod alert config').first().json;
const caller = $('Signature check').first().json.callerId;

const options = Object.entries(cfg.traders)
  .map(([key, t]) => ({ label: t.name, value: key }));

return [{
  json: {
    payload: {
      type: 4,
      data: {
        content: 'Кого викликати?',
        flags: 64,
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
    }
  }
}];
```

## 11. Respond to Webhook_trader

- **Тип:** `n8n-nodes-base.respondToWebhook` v1.5
- **Роль:** Віддає Discord меню вибору трейдерів.

Параметри:

```json
{
  "respondWith": "json",
  "responseBody": "={{ $json.payload }}",
  "options": {
    "responseCode": 200
  }
}
```

## 12. command_trader

- **Тип:** `n8n-nodes-base.code` v2
- **Роль:** Перевіряє канал і формує по одному item з параметрами Bark на кожного вибраного трейдера.

Код (`n8n/nodes/command_trader.js`):

```js
const cfg    = $('Pod alert config').first().json;
const sig    = $('Signature check').first().json;
const caller = sig.callerId;

// Канал: додаткова перевірка поверх прав Discord
if (sig.channelId !== cfg.allowedChannel) {
  return [{
    json: {
      denied: true,
      message: 'Команда доступна лише у визначеному каналі'
    }
  }];
}

const keys = sig.values ?? [];

const targets = keys.filter(k => cfg.traders[k]);

if (!targets.length) {
  return [{ json: { denied: true, message: 'Немає кому надсилати' } }];
}

const summary = targets.map(k => cfg.traders[k].name).join(', ');

return targets.map(key => {
  const t = cfg.traders[key];
  return {
    json: {
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
    }
  };
});
```

## 13. Respond to Webhook_type3

- **Тип:** `n8n-nodes-base.respondToWebhook` v1.5
- **Роль:** Відповідає «Сигнал надіслано: …» або текстом відмови (за першим item), далі пропускає всі items.

Параметри:

```json
{
  "respondWith": "json",
  "responseBody": "={{ JSON.stringify({ type: 4, data: { content: $json.denied ? $json.message : `Сигнал надіслано: ${$json.summary}`, flags: 64 } }) }}",
  "options": {
    "responseCode": 200
  }
}
```

## 14. HTTP Request

- **Тип:** `n8n-nodes-base.httpRequest` v4.4
- **Роль:** Надсилає POST на Bark-сервер /push для кожного адресата (3 спроби, пауза 5 с).
- **Налаштування ноди:** `{"retryOnFail": true, "waitBetweenTries": 5000}`

Параметри:

```json
{
  "method": "POST",
  "url": "={{ $json.url }}",
  "sendBody": true,
  "bodyParameters": {
    "parameters": [
      {
        "name": "device_key",
        "value": "={{ $json.device_key }}"
      },
      {
        "name": "title",
        "value": "={{ $json.title }}"
      },
      {
        "name": "body",
        "value": "={{ $json.body }}"
      },
      {
        "name": "level",
        "value": "={{ $json.level }}"
      },
      {
        "name": "volume",
        "value": "={{ $json.volume }}"
      },
      {
        "name": "sound",
        "value": "={{ $json.sound }}"
      },
      {
        "name": "call",
        "value": "={{ $json.call }}"
      },
      {
        "name": "={{ $json.group }}",
        "value": "PodAlert"
      },
      {
        "name": "url",
        "value": "={{ $json.discordUrl }}"
      }
    ]
  },
  "options": {}
}
```

> ⚠️ Дефект Д1: параметр з ім'ям `={{ $json.group }}` дає в тілі `"PodAlert": "PodAlert"` замість `"group": "PodAlert"`. Дефект Д2: сюди доходить і item з `denied: true` (без `url`). Див. `docs/ARCHITECTURE.md`.

## Налаштування воркфлоу

```json
{
  "executionOrder": "v1",
  "binaryMode": "separate",
  "timezone": "Europe/Kyiv",
  "callerPolicy": "workflowsFromSameOwner"
}
```

## Зв'язки (connections)

```json
{
  "Pod Alert System": {
    "main": [
      [
        {
          "node": "Pod alert config",
          "type": "main",
          "index": 0
        }
      ]
    ]
  },
  "Signature check": {
    "main": [
      [
        {
          "node": "Switch2",
          "type": "main",
          "index": 0
        }
      ]
    ]
  },
  "Pod alert config": {
    "main": [
      [
        {
          "node": "Signature check",
          "type": "main",
          "index": 0
        }
      ]
    ]
  },
  "Switch2": {
    "main": [
      [
        {
          "node": "Respond to Webhook_valid",
          "type": "main",
          "index": 0
        }
      ],
      [
        {
          "node": "Respond to Webhook_type1",
          "type": "main",
          "index": 0
        }
      ],
      [
        {
          "node": "Time limit",
          "type": "main",
          "index": 0
        }
      ],
      [
        {
          "node": "command_trader",
          "type": "main",
          "index": 0
        }
      ]
    ]
  },
  "Respond to Webhook_type3": {
    "main": [
      [
        {
          "node": "HTTP Request",
          "type": "main",
          "index": 0
        }
      ]
    ]
  },
  "menu": {
    "main": [
      [
        {
          "node": "Respond to Webhook_trader",
          "type": "main",
          "index": 0
        }
      ]
    ]
  },
  "command_trader": {
    "main": [
      [
        {
          "node": "Respond to Webhook_type3",
          "type": "main",
          "index": 0
        }
      ]
    ]
  },
  "Time limit": {
    "main": [
      [
        {
          "node": "If2",
          "type": "main",
          "index": 0
        }
      ]
    ]
  },
  "If2": {
    "main": [
      [
        {
          "node": "Respond to Webhook",
          "type": "main",
          "index": 0
        }
      ],
      [
        {
          "node": "menu",
          "type": "main",
          "index": 0
        }
      ]
    ]
  }
}
```
