# Зовнішні інтеграції

## 1. Discord

### Застосунок

Discord Application у [Developer Portal](https://discord.com/developers/applications). Його ID — `DISCORD_APPLICATION_ID`, публічний ключ — `DISCORD_PUBLIC_KEY` (General Information).

Система працює **лише через HTTP interactions**: бот не підключається до Gateway, не читає і не пише повідомлень у канали. Усі повідомлення — ефемерні відповіді на interaction (`flags: 64`): їх бачить лише той, хто викликав.

### Interactions Endpoint URL

General Information → **Interactions Endpoint URL** = адреса, куди Discord шле POST на кожну взаємодію:

- зараз: `{{N8N_BASE_URL}}/webhook/pod-alert`
- після перенесення: адреса Worker, напр. `https://pod-alert.<subdomain>.workers.dev/`

Під час збереження URL Discord перевіряє endpoint: шле PING із правильним підписом (чекає `200 {"type":1}`) і запит зі **зламаним** підписом (чекає `401`). Якщо щось не так, URL не збережеться. Тому міняти URL можна лише **після** деплою Worker.

Кожен запит має заголовки:

- `X-Signature-Ed25519` — підпис, hex;
- `X-Signature-Timestamp` — рядок із часом.

Підпис рахується над `timestamp + rawBody` (конкатенація рядків, байти UTF-8).

Відповісти треба **протягом 3 секунд**, інакше Discord покаже «The application did not respond».

### Slash-команда `/trader`

- Ім'я: `trader`, тип `CHAT_INPUT` (1). Логіка дивиться лише на `data.name === 'trader'` і не читає жодних опцій. Те, що опцій і інших команд у застосунку немає, випливає з воркфлоу (він обробляє тільки `trader`), але через Discord API це не перевірялось. Перед зміною endpoint підтвердіть у власника, що застосунок не має інших команд чи споживачів: після перемикання вони отримуватимуть «Interaction failed» (ARCHITECTURE.md, Н6).
- Реєстрація команди **не входить у воркфлоу**: її зроблено один раз окремо. Чи вона глобальна, чи guild-команда сервера `DISCORD_GUILD_ID`, з воркфлоу не видно (див. reports/export-report.md). Для перенесення реєстрацію повторювати **не треба**: команда прив'язана до застосунку, а не до endpoint.
- Якщо треба зареєструвати заново (новий застосунок):

```bash
# guild-команда (з'являється одразу); для глобальної — /applications/<APP_ID>/commands
curl -X POST "https://discord.com/api/v10/applications/$DISCORD_APPLICATION_ID/guilds/$DISCORD_GUILD_ID/commands" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"trader","type":1,"description":"Терміновий виклик трейдерів поду"}'
```

(`DISCORD_BOT_TOKEN` — Developer Portal → Bot → Reset Token. Потрібен лише для цього кроку, у роботі системи не використовується. Текст `description` у репо не зафіксовано, тут він довільний.)

### Дозволи

- Застосунок має бути доданий на сервер зі scope **`applications.commands`**. Scope `bot` і будь-які bot permissions **не потрібні**.
- Обмеження «лише в одному каналі» налаштовується в Discord: Server Settings → Integrations → застосунок → команда `/trader` → Channels (дозволити лише потрібний канал) і за потреби Roles/Members. Це основне обмеження. Перевірка `allowedChannel` у коді — додаткова і діє лише на кроці вибору (ARCHITECTURE.md, Н4).

### Відповіді, які шле система

| Ситуація | HTTP | Тіло |
|---|---|---|
| Невірний підпис | 401 | `invalid request signature` (text/plain) |
| PING | 200 | `{"type":1}` |
| `/trader` у тихі години | 200 | `{"type":4,"data":{"content":"Нічний режим: …","flags":64}}` |
| `/trader` удень | 200 | `{"type":4,"data":{"content":"Кого викликати?","flags":64,"components":[{"type":1,"components":[{"type":3,"custom_id":"trader_select",…}]}]}}` |
| Вибір у меню | 200 | `{"type":4,"data":{"content":"Сигнал надіслано: trader2, trader3","flags":64}}` або текст відмови |

`type: 4` = CHANNEL_MESSAGE_WITH_SOURCE. Кожна відповідь на вибір — нове ефемерне повідомлення. Меню не оновлюється і лишається активним, тож вибір можна зробити повторно.

## 2. Bark

[Bark](https://github.com/Finb/Bark) — iOS-застосунок для push-сповіщень через власний сервер [bark-server](https://github.com/Finb/bark-server).

### Поточна схема

Bark-сервер працює **окремо** від n8n: Docker на VPS за Caddy (HTTPS). Адреса — `BARK_SERVER_URL`. На Worker він **не переїжджає**.

### Ендпоінт

`POST {BARK_SERVER_URL}/push`, `Content-Type: application/json`, один запит на одного адресата.

| Поле | Значення в системі | Опис |
|---|---|---|
| `device_key` | `barkKey` трейдера | Ключ пристрою на цьому сервері |
| `title` | `Pod alert` | Заголовок |
| `body` | `Викликаємо в Discord` | Текст |
| `level` | `critical` | Критичне сповіщення: ігнорує беззвучний режим і «Не турбувати». У застосунку Bark треба дозволити Critical Alerts |
| `volume` | `10` | Гучність critical-сповіщення, 0–10 |
| `sound` | `sherwoodforest` | Звук з бібліотеки Bark |
| `call` | `1` | Повторювати звук (~30 с, як дзвінок) |
| `group` | ⚠️ фактично не передається (дефект Д1) | Група сповіщень |
| `url` | `https://discord.com/channels/<guild>/<channel>` | Що відкрити, коли натиснути на сповіщення |

Успіх: HTTP 200, `{"code":200,"message":"success",…}`. n8n вважає успіхом будь-який 2xx і повторює при помилці (3 спроби, 5 с; у n8n повторюється вся нода, див. ARCHITECTURE.md, Н13).

Вимоги на боці трейдера: у застосунку Bark дозволено **Critical Alerts** (iOS запитує це під час першого critical-сповіщення; змінити можна в Налаштування → Bark → Сповіщення). Без цього `level: critical` не пробиває беззвучний режим. Параметри `level`, `volume`, `call` підтримує bark-server v2+. Поточний сервер — **v2.3.7** (за `GET /info`). Він доступний зовні без IP-обмежень і без HTTP-автентифікації, тож Worker може слати на нього без змін (README → «Bark-сервер: доступність»).

### Варіант А: використати існуючий сервер

Отримати від власника `BARK_SERVER_URL` і 5 device keys. Більше нічого не міняється: трейдерам нічого не треба робити.

### Варіант Б: підняти власний

```bash
docker run -d --name bark-server --restart=always \
  -p 8080:8080 -v /opt/bark/data:/data finab/bark-server
```

Потім HTTPS-проксі. Приклад для Caddy (`Caddyfile`):

```
bark.example.com {
  reverse_proxy localhost:8080
}
```

Далі **кожен трейдер** у застосунку Bark додає сервер `https://bark.example.com`, копіює новий device key (ключ прив'язаний до сервера, старий не підійде) і передає його. Ключі записати в `BARK_KEY_TRADER_1…5`. Перевірка:

```bash
curl -X POST https://bark.example.com/push -H 'Content-Type: application/json' \
  -d '{"device_key":"<KEY>","title":"test","body":"test","level":"critical","volume":5}'
```
