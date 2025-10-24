export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const update = await request.json();
      console.log("Incoming update:", JSON.stringify(update));

      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text || "";

        // Стартова команда для запуску логіки
        if (text === "/start" || text === "/join") {
          const keyboard = {
            inline_keyboard: [
              [{ text: "✅ Погоджуюсь на надання даних", callback_data: "consent_given" }],
            ],
          };

          await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `Привіт! Щоб приєднатись до групи, будь ласка, натисніть кнопку підтвердження.`,
              reply_markup: keyboard,
            }),
          });

          return new Response("OK", { status: 200 });
        }
      }

      if (update.callback_query) {
        const chatId = update.callback_query.from.id;
        const data = update.callback_query.data;

        if (data === "consent_given") {
          await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: "Дякую за підтвердження! Тепер, будь ласка, введіть ваші дані для приєднання до групи.",
            }),
          });

          // Тут можна додати збереження стану користувача для збору даних

          return new Response("OK", { status: 200 });
        }
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Hello from Worker!", { status: 200 });
  },
};
