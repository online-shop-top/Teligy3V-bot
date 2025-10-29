export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // Обробка scheduled (cron) події
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

    const userId = update.message?.from?.id || update.callback_query?.from?.id || update.chat_member?.new_chat_member?.user?.id;
    if (!userId) return new Response("OK");

    const recipientId = userId;

    // Відстежування нових учасників
    if (update.chat_member && update.chat_member.new_chat_member?.status === "member") {
      await env.Teligy3V.put(`joined_at:${userId}`, Date.now().toString());
      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "not_registered" }));
      return new Response("OK");
    }

    // Оновлення останньої активності
    await env.Teligy3V.put(`last_active:${userId}`, Date.now().toString());

    let userStateRaw = await env.Teligy3V.get(`state:${userId}`);
    let userState = null;
    try { userState = userStateRaw ? JSON.parse(userStateRaw) : null; } catch { userState = null; }

    // /start команда
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

    // Кнопка "ПРИЄДНАТИСЬ"
    if (update.callback_query?.data === "join_request") {
      const rulesText = `ПРАВИЛА ЧАТУ ...`;
      await sendMessage(recipientId, rulesText, {
        inline_keyboard: [[{ text: "ПОГОДЖУЮСЬ", callback_data: "rules_accept" }]],
      });
      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_rules_accept" }));
      return new Response("OK");
    }

    if (update.callback_query?.data === "rules_accept") {
      await sendMessage(recipientId, "Введіть, будь ласка, номер квартири.");
      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_apartment" }));
      return new Response("OK");
    }

    // Введення квартири
    if (userState?.step === "awaiting_apartment" && update.message?.text) {
      const aptNum = parseInt(update.message.text.trim(), 10);
      if (isNaN(aptNum) || aptNum < 1 || aptNum > 120) {
        await sendMessage(recipientId, "Такого номера квартири не існує. Спробуйте ще раз.");
      } else {
        let registered = (await env.Teligy3V.get(`apt:${aptNum}`, { type: "json" })) || [];
        if (registered.length >= 2) {
          await sendMessage(recipientId, "На цю квартиру вже зареєстровано максимум.");
          await env.Teligy3V.delete(`state:${userId}`);
          await env.Teligy3V.delete(`joined_at:${userId}`);
        } else {
          await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_details", apartment: aptNum }));
          await sendMessage(recipientId, "Введіть, будь ласка, ім'я та телефон через кому.");
        }
      }
      return new Response("OK");
    }

    // Введення імені та телефону
    if (userState?.step === "awaiting_details" && update.message?.text) {
      const parts = update.message.text.trim().split(",").map(s => s.trim());
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        await sendMessage(recipientId, "Будь ласка, введіть ім'я і телефон через кому.");
        return new Response("OK");
      }
      const [name, phone] = parts;
      const aptNum = userState.apartment;
      let registered = (await env.Teligy3V.get(`apt:${aptNum}`, { type: "json" })) || [];
      if (!registered.find(u => u.userId === userId)) {
        registered.push({ userId, name, phone });
        await env.Teligy3V.put(`apt:${aptNum}`, JSON.stringify(registered));
      }

      // Генеруємо унікальний одноразовий код
      const code = Math.floor(1000 + Math.random() * 9000).toString();
      await env.Teligy3V.put(`code:${userId}`, code);
      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_code" }));

      // Надсилаємо код адміністратору
      if (env.ADMIN_CHAT_ID) {
        await sendMessage(
          env.ADMIN_CHAT_ID,
          `Новий учасник: Квартира ${aptNum}, Ім’я: ${name}, Телефон: ${phone}, Код: ${code}`
        );
      }

      await sendMessage(recipientId, `Код підтвердження надіслано адміністратору. Використайте його для отримання доступу.`);
      return new Response("OK");
    }

    // Введення коду
    if (userState?.step === "awaiting_code" && update.message?.text) {
      const inputCode = update.message.text.trim();
      const savedCode = await env.Teligy3V.get(`code:${userId}`);
      if (inputCode === savedCode) {
        // Генеруємо унікальне одноразове посилання
        const uniqueLink = `https://t.me/+${Math.random().toString(36).substr(2, 10)}`;
        await sendMessage(recipientId, `Ваше персональне посилання для групи: ${uniqueLink}`);
        await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "registered" }));
        await env.Teligy3V.delete(`code:${userId}`);
        await env.Teligy3V.delete(`joined_at:${userId}`);
      } else {
        await sendMessage(recipientId, `Невірний код. Спробуйте ще раз.`);
      }
      return new Response("OK");
    }

    return new Response("OK");
  },
};

// Видалення неактивних користувачів
async function removeInactiveUsers(env) {
  const cutoff = Date.now() - 60000; // 1 хвилина
  const list = await env.Teligy3V.list({ prefix: "joined_at:" });

  for (const key of list.keys) {
    const userId = key.name.split(":")[1];
    const joinedAtStr = await env.Teligy3V.get(`joined_at:${userId}`);
    const stateRaw = await env.Teligy3V.get(`state:${userId}`);

    if (!joinedAtStr || !stateRaw) continue;
    const joinedAt = Number(joinedAtStr);

    let state;
    try { state = JSON.parse(stateRaw); } catch { continue; }

    // Видаляємо користувачів, які не завершили реєстрацію
    if (joinedAt < cutoff && (state.step === "not_registered" || !["awaiting_code", "registered"].includes(state.step))) {
      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/banChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.GROUP_CHAT_ID, user_id: Number(userId) }),
      });

      await env.Teligy3V.delete(`joined_at:${userId}`);
      await env.Teligy3V.delete(`state:${userId}`);
      await env.Teligy3V.delete(`code:${userId}`);
      await env.Teligy3V.delete(`last_active:${userId}`);
    }
  }
}
