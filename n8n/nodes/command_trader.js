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
