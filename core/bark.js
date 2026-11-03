// ============================================================
// Запит на Bark-сервер — аналог n8n-ноди «HTTP Request».
//
// n8n шле POST з JSON-тілом (bodyParameters HTTP Request v4 → application/json),
// один запит на кожен item, з повтором при помилці: retryOnFail, пауза 5 с,
// maxTries у JSON не записаний → дефолт ноди n8n, 3 спроби.
//
// ЄДИНА свідома відмінність від n8n — одиниця повтору. У n8n retryOnFail
// перезапускає ВСЮ ноду з усіма items: якщо впав запит одного адресата,
// решта отримують сповіщення повторно (дублікати). Тут повтор поштучний:
// sendBark() повторює лише той запит, що впав. Див. docs/ARCHITECTURE.md, Н13.
//
// Відтворено 1:1, включно з двома відомими дефектами (див. docs/ARCHITECTURE.md,
// розділ «Відомі дефекти»):
//   Д1. Ім'я параметра групи береться з $json.group ('PodAlert'), а значення —
//       константа 'PodAlert'. Тому в тілі опиняється "PodAlert": "PodAlert",
//       а поля "group" немає.
//   Д2. Item з denied: true теж доходить сюди: url = undefined, запит падає.
// ============================================================

export const RETRY = { maxTries: 3, waitBetweenTriesMs: 5000 };

/**
 * @param {object} item — один item з handleInteraction(...).pushes
 * @returns {{url: string|undefined, init: RequestInit}}
 */
export function buildBarkRequest(item) {
  const body = {
    device_key: item.device_key,
    title:      item.title,
    body:       item.body,
    level:      item.level,
    volume:     item.volume,
    sound:      item.sound,
    call:       item.call,
    [item.group]: 'PodAlert',          // Д1: ключ = значення item.group, як у n8n
    url:        item.discordUrl
  };

  return {
    url: item.url,                     // Д2: для denied-item тут undefined
    init: {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    }
  };
}

/**
 * Надсилання з повторами, як retryOnFail у n8n.
 * fetchImpl передається явно, щоб модуль лишався чистим і тестованим.
 */
export async function sendBark(item, fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  const { url, init } = buildBarkRequest(item);
  let lastError;

  for (let attempt = 1; attempt <= RETRY.maxTries; attempt++) {
    try {
      const res = await fetchImpl(url, init);
      if (res.ok) return res;
      lastError = new Error(`Bark HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    if (attempt < RETRY.maxTries) await sleep(RETRY.waitBetweenTriesMs);
  }

  throw lastError;
}
