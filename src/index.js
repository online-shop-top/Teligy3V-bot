export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const update = await request.json();

      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text || "";

        // Якщо отримали команду /start або будь-яке повідомлення вперше
        if (text === "/start") {
          // Формуємо кнопку inline для підтвердження згоди
          const replyMarkup = {
            inline_keyboard: [[
              {
                text: "Погоджуюсь на надання даних",
                callback_data: "consent_given"
              }
            ]]
          };

          const body = {
            chat_id: chatId,
            text: "Привіт! Для приєднання до групи будь ласка натисніть кнопку підтвердження згоди на надання даних.",
            reply_markup: replyMarkup
          };

          await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          return new Response("OK", { status: 200 });
        }
      }

      // Обробка натискання на кнопку (callback_query)
      if (update.callback_query) {
        const chatId = update.callback_query.from.id;
        const data = update.callback_query.data;

        if (data === "consent_given") {
          // Підтвердження отриманої згоди
          const body = {
            chat_id: chatId,
            text: "Дякуємо за підтвердження! Будь ласка, введіть ваші дані для приєднання до групи."
          };

          await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          // Можна тут додати логіку збереження стану користувача тощо

          return new Response("OK", { status: 200 });
        }
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Hello from Worker!", { status: 200 });
  },
};
