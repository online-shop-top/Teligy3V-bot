// ==================================================
// Обробка Telegram Webhook
// ==================================================
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

    // Обробка нового учасника
    if (
      update.chat_member &&
      update.chat_member.new_chat_member &&
      update.chat_member.new_chat_member.status === "member"
    ) {
      const newUserId = update.chat_member.new_chat_member.user.id;

      // Зберігаємо час приєднання
      await env.Teligy3V.put(`joined_at:${newUserId}`, Date.now().toString());
      await env.Teligy3V.put(`state:${newUserId}`, JSON.stringify({ step: "not_registered" }));

      // Обмежуємо права нового користувача
      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/restrictChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.GROUP_CHAT_ID,
          user_id: newUserId,
          permissions: { can_send_messages: false, can_add_web_page_previews: false },
        }),
      });

      await sendMessage(
        newUserId,
        "Вітаємо! Щоб отримати повний доступ, будь ласка, надайте ваші дані командою /start"
      );
      return new Response("OK");
    }

    // Обробка команди /start
    if (update.message && update.message.text === "/start") {
      const stateRaw = await env.Teligy3V.get(`state:${userId}`);
      let state = stateRaw ? JSON.parse(stateRaw) : { step: "not_registered" };

      if (state.step === "not_registered") {
        await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_name" }));
        await sendMessage(userId, "Будь ласка, надішліть своє ім'я:");
        return new Response("OK");
      }
    }

    // Обробка введення імені користувача
    if (update.message && update.message.text) {
      const stateRaw = await env.Teligy3V.get(`state:${userId}`);
      let state = stateRaw ? JSON.parse(stateRaw) : { step: "not_registered" };

      if (state.step === "awaiting_name") {
        const name = update.message.text.trim();
        await env.Teligy3V.put(`user_data:${userId}`, JSON.stringify({ name }));
        await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "registered" }));

        // Надання повних прав користувачу
        await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/restrictChatMember`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: env.GROUP_CHAT_ID,
            user_id: userId,
            permissions: {
              can_send_messages: true,
              can_send_media_messages: true,
              can_add_web_page_previews: true,
              can_invite_users: true,
            },
          }),
        });

        await sendMessage(userId, `Дякуємо, ${name}! Тепер у вас повний доступ.`);
        return new Response("OK");
      }
    }

    return new Response("OK");
  },
};

// ==================================================
// Cron: видалення користувачів, що не надали дані
// ==================================================
export async function scheduled(event, env, ctx) {
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

    if (joinedAt < cutoff && state.step !== "registered") {
      // Видаляємо користувача з групи
      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/banChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.GROUP_CHAT_ID, user_id: Number(userId) }),
      });

      await env.Teligy3V.delete(`joined_at:${userId}`);
      await env.Teligy3V.delete(`state:${userId}`);
      await env.Teligy3V.delete(`user_data:${userId}`);
    }
  }
}
