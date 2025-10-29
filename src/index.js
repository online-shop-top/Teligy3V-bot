export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (request.headers.get("CF-Worker-Cron") === "true") {
      await removeInactiveUsers(env);
      return new Response("Cron job completed");
    }

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

    // Визначаємо, чи повідомлення з групи
    const chatType = update.message?.chat?.type;
    const isGroupChat = chatType === "group" || chatType === "supergroup";

    // Для відповіді завжди використовуйте приватний чат
    const recipientId = userId;

    // Оновлюємо час активності
    await env.Teligy3V.put(`last_active:${userId}`, Date.now().toString());

    let userStateRaw = await env.Teligy3V.get(`state:${userId}`);
    let userState = null;
    try {
      userState = userStateRaw ? JSON.parse(userStateRaw) : null;
    } catch {
      userState = null;
    }

    // Початкове привітання та кнопка "ПРИЄДНАТИСЬ"
    if (update.message?.text === "/start") {
      const firstName = update.message.from.first_name || "користувач";
      await sendMessage(
        recipientId,
        `👋 Привіт, ${firstName}!\nНатисни кнопку нижче, щоб подати заявку на приєднання до групи.`,
        { inline_keyboard: [[{ text: "ПРИЄДНАТИСЬ", callback_data: "join_request" }]] }
      );
      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_join" }));
      return new Response("OK");
    }

    // Обробка натискання "ПРИЄДНАТИСЬ"
    if (update.callback_query?.data === "join_request") {
      const rulesText = `ПРАВИЛА ЧАТУ...

(зміст правил тут, як раніше)`;

      await sendMessage(recipientId, rulesText, {
        inline_keyboard: [[{ text: "ПОГОДЖУЮСЬ", callback_data: "rules_accept" }]],
      });
      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_rules_accept" }));
      return new Response("OK");
    }

    // Обробка підтвердження з правил
    if (update.callback_query?.data === "rules_accept") {
      await sendMessage(recipientId, "Дякуємо! Тепер введіть номер квартири.");
      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_apartment" }));
      return new Response("OK");
    }

    // Обробка введення номера квартири
    if (userState?.step === "awaiting_apartment" && update.message?.text) {
      const aptNum = parseInt(update.message.text.trim(), 10);
      if (isNaN(aptNum) || aptNum < 1 || aptNum > 120) {
        await sendMessage(recipientId, "Такого номеру квартири не існує. Спробуйте ще раз.");
      } else {
        let registered = (await env.Teligy3V.get(`apt:${aptNum}`, { type: "json" })) || [];
        if (registered.length >= 2) {
          await sendMessage(recipientId, "На цю квартиру вже зареєстровано максимум. Зверніться до адміністратора.");
          await env.Teligy3V.delete(`state:${userId}`);
        } else {
          await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_details", apartment: aptNum }));
          await sendMessage(recipientId, "Введіть, будь ласка, ваше ім'я та телефон через кому, наприклад: Іван, 0681234567");
        }
      }
      return new Response("OK");
    }

    // Обробка введення імені і телефону
    if (userState?.step === "awaiting_details" && update.message?.text) {
      const text = update.message.text.trim();
      const parts = text.split(",").map(s => s.trim());
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        await sendMessage(recipientId, "Будь ласка, введіть ім'я і телефон через кому.");
        return new Response("OK");
      }
      const [name, phone] = parts;
      const aptNum = userState.apartment;

      let registered = (await env.Teligy3V.get(`apt:${aptNum}`, { type: "json" })) || [];
      if (!registered.find((u) => u.userId === userId)) {
        registered.push({ userId, name, phone });
        await env.Teligy3V.put(`apt:${aptNum}`, JSON.stringify(registered));
      }

      const code = Math.floor(1000 + Math.random() * 9000).toString();
      await env.Teligy3V.put(`code:${userId}`, code);
      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_code" }));

      if (env.ADMIN_CHAT_ID) {
        await sendMessage(
          env.ADMIN_CHAT_ID,
          `Новий учасник:\nКвартира: ${aptNum}\nІм’я: ${name}\nТелефон: ${phone}\nКод: ${code}`
        );
      }

      await sendMessage(recipientId, `Код підтвердження надіслано адміністратору.`);
      return new Response("OK");
    }

    // Обробка введення коду підтвердження
    if (userState?.step === "awaiting_code" && update.message?.text) {
      const inputCode = update.message.text.trim();
      const savedCode = await env.Teligy3V.get(`code:${userId}`);
      if (inputCode === savedCode) {
        await sendMessage(recipientId, "Код вірний! Посилання для групи: https://t.me/+...");
        await env.Teligy3V.delete(`state:${userId}`);
        await env.Teligy3V.delete(`code:${userId}`);
      } else {
        await sendMessage(recipientId, "Неправильний код, спробуйте ще раз.");
      }
      return new Response("OK");
    }

    return new Response("OK");
  },
};

// Функція для видалення неактивних учасників, які долучилися більше 1 хвилини тому і не пройшли реєстрацію
async function removeInactiveUsers(env) {
  const cutoff = Date.now() - 60000; // 1 хвилина
  const list = await env.Teligy3V.list({ prefix: "joined_at:" });
  for (const key of list.keys) {
    const userId = key.name.split(":")[1];
    const joinedAtStr = await env.Teligy3V.get(`joined_at:${userId}`);
    const stateRaw = await env.Teligy3V.get(`state:${userId}`);
    if (!joinedAtStr || !stateRaw) continue;
    const joinedAt = Number(joinedAtStr);
    if (joinedAt < cutoff) {
      // Вилучаємо користувача з групи
      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/banChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.GROUP_CHAT_ID, user_id: Number(userId) }),
      });
      // Очищаємо KV
      await env.Teligy3V.delete(`joined_at:${userId}`);
      await env.Teligy3V.delete(`state:${userId}`);
      await env.Teligy3V.delete(`code:${userId}`);
    }
  }
}
