export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const update = await request.json();

    // Функція для відправки повідомлень
    async function sendMessage(chatId, text, reply_markup = null) {
      const body = { chat_id: chatId, text };
      if (reply_markup) body.reply_markup = reply_markup;

      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    // Читаємо стан користувача (awaiting_apartment, awaiting_details, null)
    const userId = update.message?.from?.id || update.callback_query?.from?.id;
    let userState = null;
    if (userId) {
      userState = await env.Teligy3V.get(`state:${userId}`);
    }

    // Крок 1: Команда /start
    if (update.message?.text === "/start") {
      const chatId = update.message.chat.id;
      const firstName = update.message.from.first_name || "користувач";

      await sendMessage(chatId,
        `👋 Привіт, ${firstName}!\nНатисни кнопку нижче, щоб подати заявку на приєднання до групи.`,
        { inline_keyboard: [[{ text: "ПРИЄДНАТИСЬ", callback_data: "join_request" }]] }
      );

      await env.Teligy3V.put(`state:${userId}`, "awaiting_join");
      return new Response("OK");
    }

    // Крок 2: Обробка натискань кнопки
    if (update.callback_query?.data === "join_request") {
      const chatId = update.callback_query.from.id;

      await sendMessage(chatId, "Привіт! Щоб приєднатися до групи, введи номер квартири.");
      await env.Teligy3V.put(`state:${userId}`, "awaiting_apartment");

      return new Response("OK");
    }

    // Крок 3: Обробка повідомлення користувача залежно від стану
    if (update.message?.text && userState) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();

      if (userState === "awaiting_apartment") {
        const aptNum = parseInt(text, 10);
        if (Number.isNaN(aptNum) || aptNum < 1 || aptNum > 120) {
          await sendMessage(chatId, "Такого номеру квартири не існує. Спробуйте ще раз.");
        } else {
          // Перевіряємо скільки осіб вже зареєстровано для цієї квартири
          let registered = await env.Teligy3V.get(`apt:${aptNum}`, { type: "json" });
          if (!registered) registered = [];

          if (registered.length >= 2) {
            await sendMessage(chatId, "На цю квартиру вже зареєстровано максимальну кількість осіб. Зверніться до адміністратора.");
            await env.Teligy3V.delete(`state:${userId}`);
          } else {
            // Зберігаємо квартиру тимчасово у стані користувача
            await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_details", apartment: aptNum }));
            await sendMessage(chatId, "Введіть, будь ласка, ваше ім'я та номер телефону через кому, наприклад: Іван, 0681234567");
          }
        }
        return new Response("OK");
      }

      if (userState.startsWith("{") && JSON.parse(userState).step === "awaiting_details") {
        // Обробка імені та телефону
        const stateData = JSON.parse(userState);
        const aptNum = stateData.apartment;
        const parts = text.split(",").map(s => s.trim());

        if (parts.length < 2 || !parts[0] || !parts[1]) {
          await sendMessage(chatId, "Будь ласка, введіть ім'я і телефон через кому. Наприклад: Іван, 0681234567");
          return new Response("OK");
        }

        const [name, phone] = parts;

        // Зчитуємо реєстрації
        let registered = await env.Teligy3V.get(`apt:${aptNum}`, { type: "json" }) || [];

        registered.push({ userId, name, phone });

        // Зберігаємо список
        await env.Teligy3V.put(`apt:${aptNum}`, JSON.stringify(registered));
        // Видаляємо стан користувача
        await env.Teligy3V.delete(`state:${userId}`);

        await sendMessage(chatId, `Дякуємо, ${name}! Ви успішно зареєстровані на квартиру №${aptNum}.`);

        // Можна додати сповіщення адміністратору тут

        return new Response("OK");
      }
    }

    return new Response("OK");
  }
};
