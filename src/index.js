export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const update = await request.json();

    async function sendMessage(chatId, text, reply_markup = null) {
      const body = { chat_id: chatId, text };
      if (reply_markup) body.reply_markup = reply_markup;
      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    const userId = update.message?.from?.id || update.callback_query?.from?.id;
    if (!userId) return new Response("OK");
    const chatId = update.message?.chat?.id || update.callback_query?.from?.id;

    // Менеджмент стану користувача
    let userStateRaw = await env.Teligy3V.get(`state:${userId}`);
    let userState = null;
    try {
      userState = userStateRaw ? JSON.parse(userStateRaw) : null;
    } catch {
      userState = null;
    }

    // Крок 1: команд /start
    if (update.message?.text === "/start") {
      const firstName = update.message.from.first_name || "користувач";
      await sendMessage(chatId,
        `👋 Привіт, ${firstName}!\nНатисни кнопку нижче, щоб подати заявку на приєднання до групи.`,
        { inline_keyboard: [[{ text: "ПРИЄДНАТИСЬ", callback_data: "join_request" }]] }
      );
      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_join" }));
      return new Response("OK");
    }

    // Крок 2: кнопка приєднання
    if (update.callback_query?.data === "join_request") {
      await sendMessage(chatId, "Введи номер квартири.");
      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_apartment" }));
      return new Response("OK");
    }

    // Крок 3: обробка номера квартири
    if (userState?.step === "awaiting_apartment" && update.message?.text) {
      const aptNum = parseInt(update.message.text.trim(), 10);
      if (Number.isNaN(aptNum) || aptNum < 1 || aptNum > 120) {
        await sendMessage(chatId, "Такого номеру квартири не існує. Спробуйте ще раз.");
      } else {
        let registered = await env.Teligy3V.get(`apt:${aptNum}`, { type: "json" }) || [];
        if (registered.length >= 2) {
          await sendMessage(chatId, "На цю квартиру вже зареєстровано максимальну кількість осіб. Зверніться до адміністратора.");
          await env.Teligy3V.delete(`state:${userId}`);
        } else {
          await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_details", apartment: aptNum }));
          await sendMessage(chatId, "Введіть, будь ласка, ваше ім'я та номер телефону через кому, наприклад: Іван, 0681234567");
        }
      }
      return new Response("OK");
    }

    // Крок 4: обробка імені, телефону, генерація коду та підтвердження
    if (userState?.step === "awaiting_details" && update.message?.text) {
      const text = update.message.text.trim();
      const parts = text.split(",").map(s => s.trim());
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        await sendMessage(chatId, "Будь ласка, введіть ім'я і телефон через кому. Наприклад: Іван, 0681234567");
        return new Response("OK");
      }
      const [name, phone] = parts;
      const aptNum = userState.apartment;

      // Запис користувача у реєстр квартири
      let registered = await env.Teligy3V.get(`apt:${aptNum}`, { type: "json" }) || [];
      registered.push({ userId, name, phone });
      await env.Teligy3V.put(`apt:${aptNum}`, JSON.stringify(registered));

      // Генеруємо 4-значний код підтвердження
      const code = Math.floor(1000 + Math.random() * 9000).toString();
      await env.Teligy3V.put(`code:${userId}`, code);
      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_code" }));

      // Відправляємо адміністратору повідомлення
      if (env.ADMIN_CHAT_ID) {
        await sendMessage(env.ADMIN_CHAT_ID,
          `Новий учасник:\nКвартира: ${aptNum}\nІм’я: ${name}\nТелефон: ${phone}\nКод підтвердження: ${code}`
        );
      }

      await sendMessage(chatId, `Код підтвердження надіслано адміністратору. Будь ласка, введіть код для підтвердження.`);
      return new Response("OK");
    }

    // Перевірка коду підтвердження
    if (userState?.step === "awaiting_code" && update.message?.text) {
      const inputCode = update.message.text.trim();
      const savedCode = await env.Teligy3V.get(`code:${userId}`);

      if (inputCode === savedCode) {
        await sendMessage(chatId, `Код вірний! Ось посилання для приєднання до групи:\nhttps://t.me/+6_OJtJfRHSZjZjQy`);
        await env.Teligy3V.delete(`state:${userId}`);
        await env.Teligy3V.delete(`code:${userId}`);
      } else {
        await sendMessage(chatId, `Невірний код. Спробуйте ще раз.`);
      }
      return new Response("OK");
    }

    return new Response("OK");
  }
};
