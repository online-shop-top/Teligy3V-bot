export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const update = await request.json();

      if (update.message) {
        const chatId = update.message.chat.id;
        const firstName = update.message.from.first_name || "користувач";
        const text = update.message.text || "";

        // При команді /start надсилаємо вітання та кнопку
        if (text === "/start") {
          const keyboard = {
            inline_keyboard: [
              [{ text: "ПРИЄДНАТИСЬ", callback_data: "join_request" }],
            ],
          };

          await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `👋 Привіт, ${firstName}!\nНатисни кнопку нижче, щоб подати заявку на приєднання до групи`,
              reply_markup: keyboard,
            }),
          });

          return new Response("OK", { status: 200 });
        }
      }

      if (update.callback_query) {
        const chatId = update.callback_query.from.id;
        const data = update.callback_query.data;

        if (data === "join_request") {
          await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: "Привіт! Щоб приєднатися до групи, введи номер квартири",
            }),
          });

          return new Response("OK", { status: 200 });
        }
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Hello from Worker!", { status: 200 });
  },
};
