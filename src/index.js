export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('OK');

    const secretHdr = request.headers.get('x-telegram-bot-api-secret-token');
    if (secretHdr !== env.TG_SECRET_TOKEN) return new Response('Forbidden', { status: 403 });

    const update = await request.json().catch(() => null);
    if (!update || !update.message) return new Response('OK');

    const chatId = update.message.chat.id;
    const text = update.message.text?.trim();
    const stateKey = `state_${chatId}`;

    // отримати або ініціалізувати state користувача
    const state = JSON.parse(await env.USERS.get(stateKey) || '{}');

    let reply = '';

    if (!state.step) {
      reply = 'Вітаю! Вкажіть номер вашої квартири (1–120):';
      state.step = 'flat';
    } else if (state.step === 'flat') {
      const flat = parseInt(text);
      if (isNaN(flat) || flat < 1 || flat > 120) {
        reply = '❌ Невірний номер квартири. Вкажіть число від 1 до 120:';
      } else {
        state.flat = flat;
        state.step = 'name';
        reply = '✅ Прийнято! Тепер введіть ваше ім’я:';
      }
    } else if (state.step === 'name') {
      state.name = text;
      state.step = 'phone';
      reply = '📞 Вкажіть номер телефону (наприклад, +380501234567):';
    } else if (state.step === 'phone') {
      const phone = text.replace(/\s+/g, '');
      if (!phone.match(/^\+?\d{10,13}$/)) {
        reply = '❌ Невірний формат телефону. Спробуйте ще раз:';
      } else {
        state.phone = phone;

        // Завантажуємо поточних користувачів
        let usersData = JSON.parse(await env.USERS.get('users') || '{}');
        const flatUsers = usersData[state.flat] || [];

        if (flatUsers.length >= 2) {
          reply = '🚫 Ліміт: у квартирі вже зареєстровано 2 особи.';
        } else {
          flatUsers.push({
            name: state.name,
            phone: state.phone,
            chatId,
            registered: new Date().toISOString()
          });
          usersData[state.flat] = flatUsers;

          await env.USERS.put('users', JSON.stringify(usersData));
          reply = `🎉 Дякуємо, ${state.name}! Вас зареєстровано для квартири №${state.flat}.`;
        }

        // завершимо сесію
        await env.USERS.delete(stateKey);
      }
    }

    // зберегти поточний стан
    await env.USERS.put(stateKey, JSON.stringify(state));

    // відправити відповідь користувачу
    await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: reply })
    });

    return new Response('OK');
  }
};

