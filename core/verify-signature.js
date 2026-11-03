// ============================================================
// Перевірка підпису Discord (Ed25519) — аналог n8n-ноди «Signature check».
//
// Відмінність від n8n лише в API: замість node:crypto + SPKI/DER-обгортки
// тут Web Crypto (crypto.subtle) з raw-ключем — працює в Cloudflare Workers
// і в Node.js 20+. Вхід і вихід ті самі, що в n8n.
//
// ВАЖЛИВО: rawBody — рядок саме в тому вигляді, як його надіслав Discord
// (у Worker: await request.text()). Не робити JSON.parse → JSON.stringify
// перед перевіркою, інакше підпис не зійдеться.
// ============================================================

// Як Buffer.from(hex, 'hex') у n8n: читає пари символів до першої некоректної
// і мовчки відкидає решту. Тому зламаний hex у підписі дає «Невірний підпис»,
// а зламаний публічний ключ — «Помилка перевірки», як у n8n.
function hexToBytes(hex) {
  const bytes = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const pair = hex.slice(i, i + 2);
    if (!/^[0-9a-f]{2}$/i.test(pair)) break;
    bytes.push(parseInt(pair, 16));
  }
  return new Uint8Array(bytes);
}

/**
 * @param {object} p
 * @param {string} p.publicKey   hex, 64 символи (Discord Developer Portal → General Information → Public Key)
 * @param {string} [p.signature] заголовок x-signature-ed25519
 * @param {string} [p.timestamp] заголовок x-signature-timestamp
 * @param {string|null} p.rawBody сире тіло запиту
 * @returns {Promise<object>} та сама форма, що віддає n8n-нода «Signature check»
 */
export async function verifySignature({ publicKey, signature, timestamp, rawBody }) {
  if (!signature || !timestamp || rawBody === null || rawBody === undefined) {
    return {
      valid: false,
      reason: rawBody === null || rawBody === undefined
        ? 'Raw Body вимкнений у ноді Webhook'
        : 'Відсутні заголовки підпису'
    };
  }

  let valid = false;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKey),
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + rawBody)
    );
  } catch (e) {
    return { valid: false, reason: `Помилка перевірки: ${e.message}` };
  }

  if (!valid) {
    return { valid: false, reason: 'Невірний підпис' };
  }

  const interaction = JSON.parse(rawBody);

  return {
    valid: true,
    type:        interaction.type,        // 1 PING, 2 команда, 3 компонент
    commandName: interaction.data?.name ?? null,
    customId:    interaction.data?.custom_id ?? null,
    values:      interaction.data?.values ?? null,
    channelId:   interaction.channel_id,
    callerId:    interaction.member?.user?.id ?? interaction.user?.id ?? null,
    interaction
  };
}
