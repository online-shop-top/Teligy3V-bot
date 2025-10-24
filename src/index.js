export default {
  async fetch(request, env) {
    const update = await request.json();

    // Крок 1: Команда /start
    if (update.message?.text === "/start") {
      const chatId = update.message.chat.id;
      const firstName = update.message.from.first_name || "користувач";

      await sendMessage(env, chatId, `👋 Привіт, ${firstName}!\nНатисни кнопку нижче, щоб подати заявку на приєднання до групи`, {
        inline_keyboard: [[{ text: "ПРИЄДНАТИСЬ", callback_data: "join_request" }]],
      });

      return new Response("OK");
    }

    // Крок 2: Обробка натискання кнопки
    if (update.callback_query?.data === "join_request") {
      const chatId = update.callback_query.from.id;

      await sendMessage(env, chatId, `Привіт! Щоб приєднатися до групи, введи номер квартири`);

      return new Response("OK");
    }

    // Крок 3: Прийом номера квартири
    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const aptNum = parseInt(update.message.text, 10);

      if (Number.isNaN(aptNum) || aptNum < 1 || aptNum > 120) {
        await sendMessage(env, chatId, `Такого номеру квартири не існує. Спробуйте ще раз.`);
      } else {
        await env.Teligy3V.put(String(userId), String(aptNum));

        await sendMessage(env, chatId, `Номер квартири ${aptNum} успішно збережено!`);
      }

      return new Response("OK");
    }

    return new Response("OK");
  },
};

async function sendMessage(env, chatId, text, reply_markup = null) {
  const body = { chat_id: chatId, text };
  if (reply_markup) body.reply_markup = reply_markup;

  await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
