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
