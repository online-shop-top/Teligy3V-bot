export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    const update = await request.json();
    const message = update.message;
    if (!message || !message.chat || !message.text) {
      return new Response("No message", { status: 200 });
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    // Отримуємо попередній стан користувача з KV
    const userKey = `user_${chatId}`;
    let userState = await env.Teligy3V.get(userKey, { type: "json" }) || {};

    // Логіка запитань
    if (!userState.step) {
      userState.step = "flat";
      await env.Teligy3V.put(userKey, JSON.stringify(userState));
      await sendMessage(env, chatId, "Вітаю! Введіть номер вашої квартири (1–120):");
    } 
    else if (userState.step === "flat") {
      const flat = parseInt(text);
      if (isNaN(flat) || flat < 1 || flat > 120) {
        await sendMessage(env, chatId, "❌ Невірний номер квартири. Введіть число від 1 до 120:");
      } else {
        userState.flat = flat;
        userState.step = "name";
        await env.Teligy3V.put(userKey, JSON.stringify(userState));
        await sendMessage(env, chatId, "Добре! Тепер введіть ваше ім’я:");
      }
    } 
    else if (userState.step === "name") {
      userState.name = text;
      userState.step = "phone";
      await env.Teligy3V.put(userKey, JSON.stringify(userState));
      await sendMessage(env, chatId, "Дякую! Введіть ваш номер телефону:");
    } 
    else if (userState.step === "phone") {
      userState.phone = text;
      userState.step = "done";
      await env.Teligy3V.put(userKey, JSON.stringify(userState));
      await sendMessage(env, chatId, `✅ Дякуємо, ${userState.name}! Ваші дані збережено.`);
    }

    return new Response("OK", { status: 200 });
  },
};

async function sendMessage(env, chatId, text) {
  const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text };
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
