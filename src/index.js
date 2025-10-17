export default {
  async fetch(request, env) {
    const TG_BOT_TOKEN = env.TG_BOT_TOKEN;
    const ADMIN_ID = 2102040810; // Твій Telegram ID для підтвердження

    async function sendMessage(chatId, text, keyboard = null) {
      const body = { chat_id: chatId, text: text };
      if (keyboard) body.reply_markup = keyboard;

      const resp = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await resp.text();
      console.log('Telegram sendMessage response:', data);
    }

    if (request.method === 'POST') {
      const update = await request.json();
      console.log('Incoming update:', JSON.stringify(update));

      // Обробка повідомлень
      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text || '';

        // Обробка команди /start
        if (text === '/start' || text === '/start join') {
          const joinKeyboard = {
            inline_keyboard: [
              [{ text: '✅ Приєднатись', callback_data: 'join_start' }]
            ]
          };

          await sendMessage(
            chatId,
            'Привіт! Щоб приєднатися до групи, натисни кнопку нижче:',
            joinKeyboard
          );
          return new Response('ok');
        }

        // Тут буде логіка обробки callback_data (натискання кнопки)
      }

      // Обробка натискань кнопки
      if (update.callback_query) {
        const chatId = update.callback_query.from.id;
        const data = update.callback_query.data;

        if (data === 'join_start') {
          // Додати користувача у KV pending_users
          const pendingKey = `pending_${chatId}`;
          await env.Teligy3V.put(pendingKey, JSON.stringify({ status: 'awaiting_apartment' }));

          await sendMessage(
            chatId,
            'Введіть номер вашої квартири, щоб продовжити реєстрацію:'
          );
        }
      }

      return new Response('ok', { status: 200 });
    }

    return new Response('Hello from Worker!', { status: 200 });
  },
};
