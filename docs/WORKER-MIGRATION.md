# Перенесення на Cloudflare Worker

Мета — та сама поведінка, що в n8n, але у Worker. Бізнес-логіка вже винесена в `core/` (чистий JS, ES modules) і перевірена на Node 20. Worker-обгортку пише агент, який приймає систему: у репо її навмисно немає.

## Що не переноситься напряму і чим замінити

| У n8n | Проблема | Заміна у Worker |
|---|---|---|
| Нода **Webhook** з Raw Body | У Worker немає нод | `export default { async fetch(request, env, ctx) }`. Сире тіло: `await request.text()` (прочитати **один раз**, до будь-якого `JSON.parse`) |
| **Signature check**: `require('crypto')`, `crypto.createPublicKey` з SPKI/DER-обгорткою `302a300506032b6570032100` + ключ, `Buffer` | `node:crypto` і `Buffer` у Worker без `nodejs_compat` недоступні | Web Crypto: `crypto.subtle.importKey('raw', keyBytes, {name:'Ed25519'}, false, ['verify'])` + `crypto.subtle.verify`. Готово в `core/verify-signature.js`. DER-обгортка не потрібна |
| `$('Pod alert config')`, `$('Signature check')`: доступ до виходу інших нод | n8n-специфічне | Звичайні змінні: `const cfg = createConfig(env); const sig = await verifySignature(…)` |
| **Pod alert config** з ключами в коді | Секрети в коді | `env` + `wrangler secret put` (`SECRETS.md`). Форма конфігу та сама, `core/config.example.js` |
| **Switch2 / If2** | Ноди | `if`-гілки в `core/interactions.js` → `handleInteraction()` |
| **Respond to Webhook** (5 нод) | Окремі ноди, відповідь «посеред» воркфлоу | `return new Response(body, {status, headers})` за `result.response` |
| Порядок «Respond to Webhook_type3 → HTTP Request» (відповідь до доставки) | Worker завершується разом із відповіддю | `ctx.waitUntil(...)` — фонові запити на Bark після відповіді. Discord вимагає відповідь ≤ 3 с, тому чекати Bark до відповіді **не можна** |
| **HTTP Request** з `retryOnFail` (3 спроби, пауза 5 с) | Нода; повтор усієї ноди дає дублікати (ARCHITECTURE.md, Н13) | `fetch` + поштучні повтори: `core/bark.js` → `sendBark()`. Пауза між спробами 5 с, як у n8n: дві паузи, тобто 10 с очікування на найгірший випадок, плюс час самих запитів. Таймауту на сам `fetch` у `core/` немає (у n8n він теж не заданий явно). Щоб «зависання» Bark не з'їло ліміт `waitUntil` (~30 с після відповіді), передайте в `sendBark` fetch з таймаутом: `(u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(5000) })` |
| Часовий пояс воркфлоу `Europe/Kyiv` | Worker працює в UTC | Не впливає: `core/quiet-hours.js` явно рахує в `Europe/Kyiv` через `Intl`, який є у Workers |
| Стан між запусками | Немає | KV / Durable Objects **не потрібні** |
| Логи виконань n8n (єдине місце, де видно збої Bark) | Немає UI виконань | `console.log`/`console.error` у `waitUntil` + `wrangler tail` або Workers Logs (Observability) |

## Мінімальна обгортка (орієнтир, не готовий файл)

```js
import { createConfig } from './core/config.example.js';
import { verifySignature } from './core/verify-signature.js';
import { handleInteraction } from './core/interactions.js';
import { sendBark } from './core/bark.js';

const fetchWithTimeout = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(5000) });

export default {
  async fetch(request, env, ctx) {
    // У n8n вебхук слухав лише POST /webhook/pod-alert. Тут — POST на будь-який шлях Worker
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
      const cfg = createConfig(env);
      const rawBody = await request.text();
      const sig = await verifySignature({
        publicKey: cfg.publicKey,
        signature: request.headers.get('x-signature-ed25519'),
        timestamp: request.headers.get('x-signature-timestamp'),
        rawBody
      });
      if (!sig.valid) console.log('401:', sig.reason);

      const { response, pushes } = handleInteraction(cfg, sig);

      if (pushes.length) {
        // Поведінка n8n 1:1 (Д2): denied-item теж іде сюди і завершується помилкою.
        // Власник вирішив Д2 не виправляти, тому 'Bark failed' для denied-items
        // (targetName = undefined) у логах — очікуваний шум, не збій доставки
        ctx.waitUntil(Promise.allSettled(pushes.map(p => sendBark(p, fetchWithTimeout)))
          .then(rs => rs.forEach((r, i) => r.status === 'rejected'
            ? console.error('Bark failed', pushes[i].targetName, String(r.reason))
            : console.log('Bark ok', pushes[i].targetName))));
      }

      if (!response) return new Response('Unhandled interaction', { status: 400 }); // Н6
      const body = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
      return new Response(body, { status: response.status, headers: { 'Content-Type': response.contentType } });
    } catch (e) {
      // Напр. невалідний JSON у валідно підписаному тілі (у n8n тут падає виконання)
      console.error('Unhandled error', e);
      return new Response('Internal Error', { status: 500 });
    }
  }
};
```

Примітки:

- `request.headers.get` повертає `null`, якщо заголовка немає. `verifySignature` це обробляє (`'Відсутні заголовки підпису'`).
- Гілка `'Raw Body вимкнений у ноді Webhook'` у Worker не спрацює ніколи, бо `request.text()` завжди дає рядок. Вона лишилась для ідентичності з n8n.
- **Перевірка `env`.** `createConfig` не валідує змінні. Якщо `BARK_KEY_TRADER_N` відсутній, `device_key` випаде з JSON, і Bark відповість помилкою. Якщо немає `DISCORD_PUBLIC_KEY`, на все піде 401, включно з PING, і Discord не прийме URL. Якщо `BARK_SERVER_URL` закінчується на `/`, вийде `//push`. Перед деплоєм перевірте, що задано всі обов'язкові секрети (список нижче), а `BARK_SERVER_URL` без слеша в кінці.
- `core/` імпортується відносними шляхами. Wrangler (esbuild) сам збере бандл, `core/package.json` йому не заважає.
- Ed25519 у Web Crypto Workers підтримують за іменем `Ed25519`. Якщо в старому `compatibility_date` воно недоступне, працює алгоритм `{ name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }` (і в `importKey`, і у `verify`). Простіше взяти свіжу `compatibility_date`.
- Запити на Bark у n8n ідуть по одному на item. `Promise.allSettled` шле їх паралельно, і для адресатів це не має різниці.

## Покроковий план

1. **Секрети.** Зібрати значення всіх змінних з `SECRETS.md`. Визначити Bark-сервер: існуючий (варіант А) чи свій (варіант Б, `docs/INTEGRATIONS.md`).
2. **Проєкт.** `npm create cloudflare@latest` (Worker, JavaScript), скопіювати `core/` у проєкт, написати `src/index.js` за орієнтиром вище. У `wrangler.toml` — `name`, `main`, свіжа `compatibility_date`. **Жодних секретів у `wrangler.toml`.**
3. **Секрети у Worker** (`wrangler secret put NAME`).
   - **Обов'язкові:** `DISCORD_PUBLIC_KEY`, `DISCORD_ALLOWED_CHANNEL_ID`, `DISCORD_GUILD_ID` (для посилання в сповіщенні), `BARK_SERVER_URL`, `BARK_KEY_TRADER_1` … `_5`.
   - **Для 1:1 з продом:** `TRADER_KEY_1…5`, `TRADER_NAME_1…5` (справжні ключі та нікнейми; без них у меню буде `trader1…5`).
   - **Необов'язкові** (у логіці не використовуються, лише для повноти конфігу): `DISCORD_APPLICATION_ID`, `DISCORD_ID_TRADER_1` … `_5`.
   - **Не класти у Worker:** bot token Discord (потрібен лише для реєстрації команди).
   - Для `wrangler dev` — файл `.dev.vars` з тестовими значеннями (додати в `.gitignore`).
4. **Локальна перевірка.**
   - `wrangler dev` + запит без підпису → має бути `401`.
   - Логіку перевіряти юніт-тестом без Worker: згенерувати власну пару Ed25519 (`crypto.subtle.generateKey({name:'Ed25519'}, true, ['sign','verify'])`), передати свій публічний ключ у `createConfig({ DISCORD_PUBLIC_KEY: … })`, підписати `timestamp + body` і прогнати `verifySignature` → `handleInteraction`.
   - **Нічний режим** перевіряти без очікування ночі: третій аргумент `handleInteraction(cfg, sig, now)` — довільний момент, напр. `new Date('2026-07-01T19:30:00Z')` (22:30 за Києвом влітку) → `branch: 'quiet'`. Межі: 22:00 — тихо, 08:00 — ні.
   - Тіло запиту на Bark перевіряти через `buildBarkRequest(item)`: воно має 1:1 збігатися з n8n, включно з `"PodAlert":"PodAlert"` (Д1).
   - Перед перемиканням Discord: один ручний `curl` на `${BARK_SERVER_URL}/push` з ключем свого або тестового пристрою (docs/INTEGRATIONS.md), щоб перевірити сервер і ключ.
5. **Деплой.** `wrangler deploy` → URL Worker.
6. **Перемикання Discord.** Developer Portal → General Information → Interactions Endpoint URL = URL Worker → Save. Якщо Discord не приймає URL, проблема в перевірці підпису або PONG (`wrangler tail`, щоб подивитись).
7. **Приймальна перевірка** (у дозволеному каналі):
   - удень `/trader` → меню з 5 трейдерами → вибрати одного → «Сигнал надіслано: …» → на iPhone критичне сповіщення;
   - вночі (22:00–08:00 Київ) `/trader` → «Нічний режим…»;
   - вибір у меню з іншого каналу → «Команда доступна лише у визначеному каналі» (якщо Discord взагалі дозволяє там команду).
8. **Вимкнення n8n.** Після 1–3 днів спостереження деактивувати воркфлоу в n8n, але не видаляти до кінця періоду відкату. Доки URL у Discord вказує на Worker, n8n запитів не отримує.

**Відкат:** повернути в Discord старий Interactions Endpoint URL `{{N8N_BASE_URL}}/webhook/pod-alert`. Умови: воркфлоу активний, і конфіг у ноді `Pod alert config` актуальний. Якщо при перенесенні обрали варіант Б (новий Bark-сервер, нові ключі), старі ключі в n8n на новому сервері не працюють. Для відкату треба або оновити `barkServer` і ключі в n8n, або тримати старий Bark-сервер, доки триває період відкату.

## Хто що дає

Усі значення, доступи й рішення дає **власник системи**, тобто людина, яка передала цей репо:

- значення секретів і відповідність `trader1…5` → люди (ARCHITECTURE.md, «Ключі та імена в проді»);
- варіант Bark (А чи Б) і доступ до існуючого сервера;
- доступ до Discord-застосунку в Developer Portal (потрібна роль, що може міняти Interactions Endpoint URL);
- Cloudflare-акаунт і домен Worker (`*.workers.dev` або власний);
- доступ до n8n для відкату;
- актуальні Bark-ключі: власник перегенерує їх перед передачею, тож беріть лише ті, що він передав після цього;
- рішення про Д1 і рекомендації нижче.

Уже вирішено власником:
- Bark-сервер доступний зовні: без IP-allowlist і без auth на Caddy (перевірено, README → «Bark-сервер: доступність»);
- повтори Bark поштучні (Н13), як у `core/`;
- Д2 лишається відомим дефектом і не виправляється.

## Що зберегти 1:1, а що можна покращити

Перенесення має відтворити поточну поведінку. Неочевидні місця (Н1–Н15 в `ARCHITECTURE.md`) — чинна логіка, а не помилки: власник підтвердив, що воркфлоу в n8n — істинний флоу. Зокрема, можливість викликати себе (Н1) і тихі години лише на показі меню (Н2) — поточні правила. Міняти їх під час перенесення не треба. Окремо від перенесення, за згодою власника:

- **Д1** (відомий дефект): рішення описане в `ARCHITECTURE.md`, один рядок у `core/bark.js`.
- **Рекомендація: перевірка свіжості timestamp** (Н10). Відхиляти запити, де `|now − X-Signature-Timestamp| > 5 хв`, щоб перехоплений підписаний запит не можна було повторити. Discord цього не вимагає, у n8n цього немає.
- **Д2 у Worker** (власник вирішив не виправляти). Кожна відмова дає 3 спроби `fetch(undefined)`, близько 10 с у `waitUntil` і запис `Bark failed` з `targetName = undefined` у логах. Під час моніторингу такі записи треба ігнорувати. Якщо колись захочете виправити, вистачить однієї умови `pushes.filter(p => !p.denied)`.
- **Рекомендація: моніторинг.** У n8n немає error workflow (Н15). У Worker — Workers Logs / `wrangler tail`, за потреби алерт на `Bark failed`.
- **Рекомендація: повідомляти про збій Bark.** Зараз «Сигнал надіслано» означає лише «прийнято». Можна після `waitUntil` надсилати follow-up через `PATCH /webhooks/{application_id}/{interaction_token}/messages/@original` (токен з `sig.interaction.token`, діє 15 хв, bot token не потрібен).
