export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
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

    const userId =
      update.message?.from?.id ||
      update.callback_query?.from?.id ||
      update.chat_member?.new_chat_member?.user?.id;
    if (!userId) return new Response("OK");

    const recipientId = userId;

    // Новий користувач приєднався до групи
    if (
      update.chat_member &&
      update.chat_member.new_chat_member &&
      update.chat_member.new_chat_member.status === "member"
    ) {
      const newUserId = update.chat_member.new_chat_member.user.id;

      // Зберігаємо час приєднання
      await env.Teligy3V.put(`joined_at:${newUserId}`, Date.now().toString());
      await env.Teligy3V.put(`state:${newUserId}`, JSON.stringify({ step: "not_registered" }));

      // Обмежуємо права новачка
      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/restrictChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.GROUP_CHAT_ID,
          user_id: newUserId,
          permissions: { can_send_messages: false, can_add_web_page_previews: false },
        }),
      });

      return new Response("OK");
    }

    // Оновлюємо час останньої активності користувача
    await env.Teligy3V.put(`last_active:${userId}`, Date.now().toString());

    let userStateRaw = await env.Teligy3V.get(`state:${userId}`);
    let userState = null;
    try {
      userState = userStateRaw ? JSON.parse(userStateRaw) : null;
    } catch {
      userState = null;
    }

    // Команда /start
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

    // Обробка join_request
    if (update.callback_query?.data === "join_request") {
      const rulesText = `ПРАВИЛА ЧАТУ ...`;
      await sendMessage(recipientId, rulesText, {
        inline_keyboard: [[{ text: "ПОГОДЖУЮСЬ", callback_data: "rules_accept" }]],
      });
      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_rules_accept" }));
      return new Response("OK");
    }

    if (update.callback_query?.data === "rules_accept") {
      await sendMessage(recipientId, "Введіть номер квартири.");
      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_apartment" }));
      return new Response("OK");
    }

    if (userState?.step === "awaiting_apartment" && update.message?.text) {
      const aptNum = parseInt(update.message.text.trim(), 10);
      if (isNaN(aptNum) || aptNum < 1 || aptNum > 120) {
        await sendMessage(recipientId, "Такого номеру квартири не існує. Спробуйте ще раз.");
      } else {
        let registered = (await env.Teligy3V.get(`apt:${aptNum}`, { type: "json" })) || [];
        if (registered.length >= 2) {
          await sendMessage(recipientId, "На цю квартиру вже зареєстровано максимум.");
          await env.Teligy3V.delete(`state:${userId}`);
          await env.Teligy3V.delete(`joined_at:${userId}`);
        } else {
          await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_details", apartment: aptNum }));
          await sendMessage(recipientId, "Введіть ім'я та телефон через кому.");
        }
      }
      return new Response("OK");
    }

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

      // Генеруємо унікальне посилання на групу для цього користувача
      const uniqueLink = `https://t.me/+${Math.random().toString(36).substring(2, 10)}`;

      await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_code", uniqueLink }));
      if (env.ADMIN_CHAT_ID) {
        await sendMessage(
          env.ADMIN_CHAT_ID,
          `Новий учасник: Квартира ${aptNum}, Ім’я: ${name}, Телефон: ${phone}`
        );
      }
      await sendMessage(recipientId, `Ось ваше унікальне посилання для приєднання: ${uniqueLink}`);
      return new Response("OK");
    }

    return new Response("OK");
  },
};

// Функція для видалення неактивних користувачів
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
    try {
      state = JSON.parse(stateRaw);
    } catch {
      continue;
    }

    if (joinedAt < cutoff && state.step === "not_registered") {
      // Видаляємо користувача з групи
      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/banChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.GROUP_CHAT_ID, user_id: Number(userId) }),
      });

      await env.Teligy3V.delete(`joined_at:${userId}`);
      await env.Teligy3V.delete(`state:${userId}`);
      await env.Teligy3V.delete(`last_active:${userId}`);
    }
  }
}

// Експорт функції для cron
export async function scheduled(event, env, ctx) {
  await removeInactiveUsers(env);
}
