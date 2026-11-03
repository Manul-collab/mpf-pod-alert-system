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
