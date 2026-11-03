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
