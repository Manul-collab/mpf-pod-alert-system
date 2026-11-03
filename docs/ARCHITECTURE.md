# Архітектура Pod Alert (n8n)

Воркфлоу `Pod-alert-system`, n8n, 14 нод, налаштування: `executionOrder: v1`, `timezone: Europe/Kyiv`.

## Тригер

Єдиний тригер — нода **Webhook** `Pod Alert System`:

| Параметр | Значення |
|---|---|
| Метод | `POST` |
| Шлях | `pod-alert` → production URL `{{N8N_BASE_URL}}/webhook/pod-alert` (test: `/webhook-test/pod-alert`) |
| Response Mode | `responseNode`: відповідь віддає перша виконана нода «Respond to Webhook» |
| Options → Raw Body | `true`: сире тіло запиту приходить як binary (`item.binary.data.data`, base64), потрібне для перевірки підпису |
| Автентифікація | немає (захист через підпис Ed25519) |

Цю URL-адресу вказано в Discord Developer Portal як **Interactions Endpoint URL**.

## Граф

```
Pod Alert System (Webhook)
  └─► Pod alert config (Code)
        └─► Signature check (Code)
              └─► Switch2 (allMatchingOutputs: true)
                    ├─[0] valid == false ─────────► Respond to Webhook_valid   401 "invalid request signature"
                    ├─[1] type == 1 (PING) ───────► Respond to Webhook_type1   200 {"type":1}
                    ├─[2] commandName == "trader" ► Time limit (Code)
                    │                                 └─► If2 (quiet == true)
                    │                                       ├─[true]  ► Respond to Webhook   200 ефемерне «Нічний режим…»
                    │                                       └─[false] ► menu (Code) ► Respond to Webhook_trader  200 select-меню
                    └─[3] type == 3 (компонент) ──► command_trader (Code)
                                                      └─► Respond to Webhook_type3  200 «Сигнал надіслано…» / відмова
                                                            └─► HTTP Request  POST {{BARK_SERVER_URL}}/push (на кожен item)
```

Discord interaction types: `1` PING, `2` APPLICATION_COMMAND (slash-команда), `3` MESSAGE_COMPONENT (вибір у select-меню), `4` AUTOCOMPLETE, `5` MODAL_SUBMIT.

Switch2 має `allMatchingOutputs: true`, тобто item іде в **усі** виходи, правила яких виконались. Для запитів, які шле цей застосунок, збіг завжди один: у невалідного запиту немає `type` і `commandName`, у PING `commandName = null`, у компонента `commandName = null`, а в команди `type = 2`. Правило `[2]` перевіряє **лише** `commandName === 'trader'` без `type == 2`. Тому autocomplete (`type 4`) з `data.name = 'trader'` теж показав би меню. Зараз це неможливо: у команди немає опцій, тож autocomplete не надходить.

`typeValidation: strict` не дає помилки на `type = undefined` / `commandName = null`: n8n не валідує тип порожніх значень (`null`/`undefined`), умова просто не виконується. Це підтверджує робота в проді, де PING і 401 проходять.

## Ноди по порядку

| # | Нода | Тип | Що робить | Звідки бере | Куди пише |
|---|---|---|---|---|---|
| 1 | Pod Alert System | Webhook | Приймає POST від Discord | HTTP-запит | item: `headers`, `body`, binary `data` (сире тіло) |
| 2 | Pod alert config | Code | Повертає об'єкт конфігу (довідник трейдерів, ключі, ID, тексти) і збирає `discordLink` | константи в коді | item з конфігом. Інші ноди читають його через `$('Pod alert config')` |
| 3 | Signature check | Code | Перевіряє Ed25519-підпис `x-signature-ed25519` над `timestamp + rawBody` публічним ключем; розбирає interaction | `$('Pod Alert System')` (заголовки, binary), `$('Pod alert config').publicKey` | `{valid, reason}` або `{valid:true, type, commandName, customId, values, channelId, callerId, interaction}` |
| 4 | Switch2 | Switch | Маршрутизує за `valid`, `type`, `commandName` | вихід #3 | 4 виходи, див. граф |
| 5 | Respond to Webhook_valid | Respond to Webhook | `401`, text `invalid request signature` | — | HTTP-відповідь Discord |
| 6 | Respond to Webhook_type1 | Respond to Webhook | `200`, JSON `{"type": 1}` (PONG) | — | HTTP-відповідь |
| 7 | Time limit | Code | Обчислює київський час, `quiet = hour >= 22 \|\| hour < 8`, готує текст | системний годинник | `{quiet, localTime, message}` |
| 8 | If2 | If | `quiet == true` → true-гілка, інакше false-гілка | вихід #7 | — |
| 9 | Respond to Webhook | Respond to Webhook | `200`, `{type:4, data:{content: message, flags:64}}` | вихід #7 | HTTP-відповідь (ефемерне повідомлення) |
| 10 | menu | Code | Будує відповідь із select-меню (`custom_id: trader_select`, опції = всі трейдери конфігу, `min_values 1`, `max_values = кількість`) | `$('Pod alert config')` | `{payload}` |
| 11 | Respond to Webhook_trader | Respond to Webhook | `200`, JSON = `$json.payload` | вихід #10 | HTTP-відповідь |
| 12 | command_trader | Code | Перевіряє канал, фільтрує вибрані ключі за конфігом, формує по item на адресата з параметрами Bark | `$('Pod alert config')`, `$('Signature check')` (`channelId`, `values`) | N items `{denied:false, summary, url, device_key, …}` або 1 item `{denied:true, message}` |
| 13 | Respond to Webhook_type3 | Respond to Webhook | `200`, `{type:4, data:{content: denied ? message : "Сигнал надіслано: "+summary, flags:64}}` за **першим** item; пропускає всі items далі | вихід #12 | HTTP-відповідь + items на #14 |
| 14 | HTTP Request | HTTP Request v4.4 | `POST $json.url` з JSON-тілом, по запиту на item. `retryOnFail: true`, `waitBetweenTries: 5000`; `maxTries` у JSON відсутній, тож діє дефолт ноди — 3 спроби. Таймаут не задано (`options: {}`), діє дефолт n8n | items з #13 | Bark-сервер |

Повний код і параметри — `POD-ALERT-FULL-CODE.md`.

## Формат даних

### Конфіг (вихід ноди 2, `core/config.example.js`)

```js
{
  barkServer, applicationId, publicKey, guildId, allowedChannel,
  title: 'Pod alert', body: 'Викликаємо в Discord',
  traders: { trader1: { name, barkKey, discordId, level:'critical', volume:10, sound:'sherwoodforest', call:1 }, … },
  discordLink: 'https://discord.com/channels/<guildId>/<allowedChannel>'
}
```

Ключ трейдера (`trader1`) — це `value` опції в меню, і саме його Discord повертає у `data.values`. `name` — підпис у меню і в «Сигнал надіслано: …». Порядок ключів задає порядок у меню. Щоб додати трейдера, треба додати запис у `traders`: меню і `max_values` підлаштуються самі (ліміт Discord — 25 опцій).

**Ключі та імена в проді.** У бойовому n8n ключі й `name` — це нікнейми трейдерів (ключ — нікнейм у нижньому регістрі, `name` — нікнейм). У репо їх замінено на `trader1…trader5` у тому самому порядку. Відповідність «номер → людина → нікнейм» знає власник системи, її треба отримати разом із секретами. Наслідки:
- `BARK_KEY_TRADER_N` і `DISCORD_ID_TRADER_N` мають належати одній і тій самій людині N;
- для 1:1 з продом задайте `TRADER_KEY_N` (ключ, нікнейм у нижньому регістрі) і `TRADER_NAME_N` (нікнейм) для кожного N (SECRETS.md). Без них лишаються `trader1…5`. Нікнейми зберігаються в env, а не в коді, щоб репо лишався без персональних даних;
- меню, відкриті в Discord **до** перемикання на Worker, повертають старі ключі. Якщо ключі у Worker інші, вибір у такому меню дасть «Немає кому надсилати» (Н9). Вихід простий: викликати `/trader` заново.

### Типи значень у тілі для Bark

n8n HTTP Request v4 з `bodyParameters` (contentType за замовчуванням `json`) підставляє результат виразу з його типом: `volume: 10` і `call: 1` ідуть числами. `core/bark.js` теж шле числа. Bark-сервер приймає і числа, і рядки.

### Item для Bark (вихід ноди 12)

```js
{ denied:false, summary:'trader2, trader3', url:'<barkServer>/push', device_key, title, body,
  level, volume, sound, call, group:'PodAlert', discordUrl:'<discordLink>', targetName }
```

### Тіло запиту на Bark (нода 14), фактичне

```json
{ "device_key":"…", "title":"Pod alert", "body":"Викликаємо в Discord",
  "level":"critical", "volume":10, "sound":"sherwoodforest", "call":1,
  "PodAlert":"PodAlert",
  "url":"https://discord.com/channels/…/…" }
```

(`"PodAlert":"PodAlert"` замість `"group":"PodAlert"` — це дефект Д1, див. нижче.)

## Стан між запусками

Його **немає**. Кожен запит обробляється незалежно: меню і вибір — два окремі запуски воркфлоу, які пов'язує тільки Discord (компонент повертає `values`). Тому у Worker не потрібен ні KV, ні Durable Objects.

## Неочевидна поведінка (так задумано або так склалось, НЕ дефект)

Логіку змінювали в процесі, тож чинна поведінка — саме та, що в n8n. `core/` відтворює її 1:1.

- **Н1. Того, хто викликає, не виключено.** `callerId` обчислюється в `Signature check` і читається в `menu` та `command_trader`, але не використовується. Меню показує всіх трейдерів, і можна викликати себе. `discordId` у конфігу теж ніде не використовується.
- **Н2. Тихі години — лише на кроці `/trader` (показ меню).** Вибір у вже відкритому меню (тип 3) тихими годинами не фільтрується: меню, відкрите о 21:59, о 22:05 надішле сигнал. PING і 401 тихі години не зачіпають.
- **Н3. Межі тихих годин.** 22:00 — уже тихо, 08:00 — уже ні. Час київський з урахуванням DST, незалежно від часового поясу сервера. Текст `0${QUIET_TO}:00` дає «08:00» лише поки `QUIET_TO < 10`.
- **Н4. Канал перевіряється лише на кроці вибору.** Команда `/trader` показує меню в будь-якому каналі, де Discord її дозволяє. Перевірка `channelId === allowedChannel` відбувається лише в `command_trader`. Основне обмеження — права команди в налаштуваннях Discord-сервера.
- **Н5. `custom_id` не перевіряється.** Будь-який компонент (type 3) з цього застосунку обробляється як вибір трейдерів. Зараз інших компонентів немає.
- **Н6. Необроблені типи.** Якщо не спрацював жоден вихід Switch2 (інша slash-команда, modal), не виконується жодна Respond to Webhook нода. Тоді n8n сам віддає стандартну відповідь вебхука (точний код і тіло залежать від версії n8n, у цьому експорті їх не зафіксовано). Це не відповідь Discord-формату, тож Discord покаже «Interaction failed». На практиці таких запитів немає: у застосунку одна команда без опцій. У Worker тут можна віддати будь-яку помилку (400), і для користувача результат той самий.
- **Н7. Відповідь до доставки.** «Сигнал надіслано» Discord отримує **до** запитів на Bark (Respond to Webhook_type3 стоїть перед HTTP Request). Так треба: Discord чекає відповідь не довше 3 секунд, а Bark з повторами може тривати до ~10+ с. Наслідок: про збій Bark трейдер не дізнається. Видно це лише в логах виконань n8n.
- **Н8. Відповідь — за першим item.** Respond to Webhook відповідає один раз, за першим item. `summary` однаковий в усіх items, тож це коректно.
- **Н9. Невідомі ключі мовчки відкидаються.** `values`, яких немає в конфігу, фільтруються. Якщо не лишилось жодного, приходить відповідь «Немає кому надсилати».
- **Н10. Перевірки свіжості `x-signature-timestamp` немає.** Discord цього не вимагає (див. WORKER-MIGRATION.md, рекомендації).
- **Н11. Сире тіло.** Підпис рахується над точними байтами, які надіслав Discord. Якщо в ноді Webhook вимкнути Raw Body, перевірка завжди повертатиме `valid:false` (`Raw Body вимкнений у ноді Webhook`), і Discord отримає 401 на всі запити. У воркфлоу стоїть `binaryMode: "separate"`. На цьому інстансі сире тіло доходить у `item.binary.data.data` як base64, бо в проді перевірка працює. Якщо після відкату на інший інстанс n8n бінарні дані зберігаються у файловій системі, там буде не base64, і перевірку треба адаптувати (`this.helpers.getBinaryDataBuffer`). У Worker цього питання немає: `request.text()`.
- **Н12. Треди.** `command_trader` порівнює `channel_id` із `allowedChannel` точно. Виклик у треді дозволеного каналу має `channel_id` треду, тож прийде відмова «Команда доступна лише у визначеному каналі».
- **Н13. Повтори в n8n — на рівні ноди.** `retryOnFail` перезапускає всю ноду HTTP Request з усіма items. Якщо запит хоча б одного адресата завершився помилкою (недоступний Bark, неправильний ключ → не-2xx), повторно надсилаються **всі** запити, і ті, хто вже отримав сповіщення, отримають його ще раз (до 3 разів). Запити items нода v4 шле паралельно. `core/bark.js` навмисно повторює **поштучно** і дублікатів не дає. Це єдина змістовна відмінність `core/` від n8n, прийнята за рішенням власника (таблиця «Розбіжності», Р1). Якщо колись знадобиться повна ідентичність, оберніть `Promise.all(pushes.map(...))` у цикл з 3 спроб.
- **Н14. Немає захисту від повторних викликів.** Кулдауну немає. Меню лишається активним, і вибір можна робити скільки завгодно разів: кожен вибір — новий сигнал.
- **Н15. Error workflow.** У налаштуваннях воркфлоу не вказано `errorWorkflow`, тож про помилки виконання (наприклад, збій Bark) ніхто автоматично не дізнається. Їх видно лише в списку виконань n8n.

## Розбіжності `core/` ↔ n8n

Повний перелік місць, де `core/` (і орієнтир Worker) поводиться не так, як n8n. Решта відтворена 1:1 і перевірена тестом.

| # | Де | n8n | `core/` / Worker | Чому |
|---|---|---|---|---|
| Р1 | Повтори запитів на Bark (Н13) | `retryOnFail` перезапускає всю ноду HTTP Request з усіма items. При збої одного адресата інші отримують сповіщення повторно (до 3 разів) | `sendBark()` повторює лише запит, що впав (3 спроби, 5 с) | **Рішення власника:** дублікати критичних сповіщень не потрібні |
| Р2 | API перевірки підпису | `node:crypto`, SPKI/DER-обгортка, `Buffer` | Web Crypto `crypto.subtle`, raw-ключ | У Worker немає `node:crypto`/`Buffer`. Результат (`valid`) той самий, `reason` теж, крім тексту `e.message` у «Помилка перевірки: …» (лише лог) |
| Р3 | Сире тіло | `item.binary.data.data` (base64) або `item.json.body`; гілка «Raw Body вимкнений» | `request.text()` завжди дає рядок, тож гілка «Raw Body вимкнений» недосяжна | Інша платформа |
| Р4 | Необроблена interaction (Н6) | Стандартна відповідь вебхука n8n | `response: null` → у Worker `400` | Для Discord результат однаковий: «Interaction failed» |
| Р5 | HTTP-рівень | Лише `POST /webhook/pod-alert`, решту обробляє n8n | Орієнтир Worker: `405` на не-POST, POST на будь-який шлях | Інша платформа |
| Р6 | Виняток (напр. невалідний JSON у валідно підписаному тілі) | Виконання падає | Орієнтир Worker: `try/catch` → `500` | Інша платформа |
| Р7 | Ключі та імена трейдерів | Нікнейми в коді ноди | `TRADER_KEY_N` / `TRADER_NAME_N` з env, за замовчуванням `trader1…5` | Репо без персональних даних |

Д1 і Д2 **не** є розбіжностями: обидва дефекти відтворено в `core/` 1:1.

## Відомі дефекти (технічні баги, у `core/` НЕ виправлено)

### Д1. Неправильне ім'я параметра `group` у HTTP Request

У ноді 14 параметр тіла має **ім'я** `={{ $json.group }}` (тобто `PodAlert`), а **значення** — `PodAlert`. Bark отримує `"PodAlert":"PodAlert"` і не отримує `group`, тому сповіщення не групуються в окрему групу на iPhone. На доставку це не впливає.

**Рішення:** ім'я параметра `group`, значення `={{ $json.group }}`. У `core/bark.js` рядок `[item.group]: 'PodAlert'` замінити на `group: item.group`.

### Д2. Item із `denied: true` іде в HTTP Request

Коли `command_trader` повертає відмову (не той канал / немає адресатів), Respond to Webhook_type3 правильно віддає текст відмови, але той самий item іде далі в HTTP Request з `url = undefined`. Запит падає, n8n робить 3 спроби з паузою 5 с, і виконання закінчується помилкою в логах. Трейдер нічого не помічає.

**Статус:** власник вирішив **не виправляти**: лишається відомим дефектом. Можливе рішення на майбутнє: між Respond to Webhook_type3 і HTTP Request поставити If/Filter `denied == false`. У `core/interactions.js` повертати `pushes: items.filter(i => !i.denied)`.
