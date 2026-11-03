// ============================================================
// Конфіг Pod Alert — та сама форма, що повертає n8n-нода «Pod alert config».
//
// createConfig(env) збирає конфіг зі змінних середовища (див. SECRETS.md).
// У Cloudflare Worker env — це другий аргумент fetch(request, env, ctx).
// Нетаємні параметри (тексти, звук, гучність) лежать тут у коді, як і в n8n.
// ============================================================

const TRADER_DEFAULTS = {
  level:  'critical',        // Bark: критичне сповіщення, пробиває беззвучний режим
  volume: 10,                // гучність critical-сповіщення, 0–10
  sound:  'sherwoodforest',  // назва звуку Bark
  call:   1                  // 1 = повторювати звук (режим «дзвінка»)
};

// Ключ трейдера = value в select-меню Discord. name = підпис у меню і в «Сигнал надіслано: …».
// Порядок = порядок у меню. Кількість трейдерів = TRADER_COUNT.
// У проді ключ — нікнейм у нижньому регістрі, name — нікнейм (див. docs/ARCHITECTURE.md,
// «Ключі та імена в проді»). Їх задають TRADER_KEY_N / TRADER_NAME_N; без них — trader1…5.
const TRADER_COUNT = 5;

export function createConfig(env) {
  const traders = {};

  for (let n = 1; n <= TRADER_COUNT; n++) {
    const key = env[`TRADER_KEY_${n}`] || `trader${n}`;
    traders[key] = {
      name:      env[`TRADER_NAME_${n}`] || key,
      barkKey:   env[`BARK_KEY_TRADER_${n}`],
      discordId: env[`DISCORD_ID_TRADER_${n}`],  // у поточній логіці ніде не використовується
      ...TRADER_DEFAULTS
    };
  }

  const config = {
    barkServer: env.BARK_SERVER_URL,             // без слеша в кінці, напр. https://bark.example.com

    // Discord
    applicationId:  env.DISCORD_APPLICATION_ID,  // у поточній логіці ніде не використовується
    publicKey:      env.DISCORD_PUBLIC_KEY,
    guildId:        env.DISCORD_GUILD_ID,
    allowedChannel: env.DISCORD_ALLOWED_CHANNEL_ID,

    // Текст сповіщення
    title: 'Pod alert',
    body:  'Викликаємо в Discord',

    traders
  };

  config.discordLink = `https://discord.com/channels/${config.guildId}/${config.allowedChannel}`;

  return config;
}
