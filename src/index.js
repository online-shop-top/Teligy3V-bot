export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const update = await request.json();

      if (update.message) {
        const chatId = update.message.chat.id;
        const userId = update.message.from.id;
        const text = (update.message.text || "").trim();

        if (text === "/start") {
          // тут код першого кроку (вітання з кнопкою)
        } else {
          const aptNum = parseInt(text, 10);
          if (Number.isNaN(aptNum) || aptNum < 1 || aptNum > 120) {
            await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: "Такого номеру квартири не існує. Спробуйте ще раз.",
              }),
            });
          } else {
            await env.Teligy3V.put(String(userId), String(aptNum));

            await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: `Номер квартири ${aptNum} успішно збережено!`,
              }),
            });

            // Подальша логіка тут
          }
        }
        return new Response("OK", { status: 200 });
      }

      if (update.callback_query) {
        // ваш код обробки callback_query
        return new Response("OK", { status: 200 });
      }

      return new Response("OK", { status: 200 });
    }
    return new Response("Hello from Worker!", { status: 200 });
  },
};
