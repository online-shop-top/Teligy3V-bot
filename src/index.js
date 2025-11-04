import { getUser, saveState, registerUser } from "./db.js";

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      if (request.headers.get("CF-Worker-Cron") === "true") {
        await removeInactiveUsers(env);
        return new Response("Cron job completed");
      }

      

      // 📌 Admin endpoint to view all users
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/admin/users") {
        if (url.searchParams.get("secret") !== env.ADMIN_CHAT_ID) {
          return new Response("Forbidden", { status: 403 });
        }
        const res = await env.DB.prepare(
          "SELECT tg_id, full_name, apartment, phone, state, created_at FROM users"
        ).all();

        return new Response(JSON.stringify(res.results || []), {
          headers: { "Content-Type": "application/json" }
        });
      }

      if (request.method !== "POST") {
        return new Response("Only POST method is allowed for this endpoint.", { status: 405 });
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

      async function answerCallback(id, text = null) {
        await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: id, text })
        });
      }

      const userId =
        update.message?.from?.id ||
        update.callback_query?.from?.id ||
        update.chat_member?.new_chat_member?.user?.id;

      if (!userId) return new Response("Invalid user data", { status: 400 });

      // 🆕 Отримуємо стан із SQL
      const userRecord = await getUser(env, userId);
      const userState = userRecord?.state || null;

      // ✅ Новий учасник групи
      if (update.chat_member?.new_chat_member?.status === "member") {
        await env.Teligy3V.put(`joined_at:${userId}`, Date.now().toString());
        await saveState(env, userId, { step: "not_registered" });
        return new Response("OK");
      }

      // ✅ activity update
      await env.Teligy3V.put(`last_active:${userId}`, Date.now().toString());

      // ✅ /start
      if (update.message?.text === "/start") {
        const firstName = update.message.from.first_name || "користувач";

        await sendMessage(
          userId,
          `👋 Привіт, ${firstName}!\nНатисни кнопку нижче, щоб подати заявку на приєднання до групи.`,
          { inline_keyboard: [[{ text: "ПРИЄДНАТИСЬ ✅", callback_data: "join_request" }]] }
        );

        await saveState(env, userId, { step: "awaiting_join" });
        return new Response("OK");
      }

      // ✅ join button
      if (update.callback_query?.data === "join_request") {
        await answerCallback(update.callback_query.id);

        await sendMessage(
          userId,
          `👥 Мета чату:\n... (тут правила залишаються як у тебе) ...`,
          { inline_keyboard: [[{ text: "ПОГОДЖУЮСЬ ✅", callback_data: "rules_accept" }]] }
        );

        await saveState(env, userId, { step: "awaiting_rules_accept" });
        return new Response("OK");
      }

      // ✅ rules accepted
      if (update.callback_query?.data === "rules_accept") {
        await answerCallback(update.callback_query.id);
        await sendMessage(userId, "Введіть номер квартири:");
        await saveState(env, userId, { step: "awaiting_apartment" });
        return new Response("OK");
      }

      // ✅ apartment input
      if (userState?.step === "awaiting_apartment" && update.message?.text) {
        const aptNum = parseInt(update.message.text.trim(), 10);

        if (isNaN(aptNum) || aptNum < 1 || aptNum > 120) {
          await sendMessage(userId, "❌ Такої квартири не існує. Спробуйте ще раз.");
          return new Response("OK");
        }

        // 🆕 SQL: count users in apartment
        const current = await env.DB.prepare(
          "SELECT COUNT(*) as c FROM users WHERE apartment = ?"
        ).bind(aptNum).first();

        if (current.c >= 2) {
          await sendMessage(userId, "❌ На цю квартиру вже зареєстровано 2 мешканці.");
          return new Response("OK");
        }

        await saveState(env, userId, { step: "awaiting_details", apartment: aptNum });
        await sendMessage(userId, "Введіть ім'я та телефон через кому. Наприклад: Іван, 0681234567");
        return new Response("OK");
      }

      // ✅ name & phone
      if (userState?.step === "awaiting_details" && update.message?.text) {
        const [name, phone] = update.message.text.trim().split(",").map(s => s.trim());

        if (!name || !phone) {
          await sendMessage(userId, "Будь ласка, введіть ім'я і телефон через кому.");
          return new Response("OK");
        }

        const aptNum = userState.apartment;

        // 🆕 SQL insert
        await registerUser(env, userId, name, phone, aptNum);

        const code = Math.floor(1000 + Math.random() * 9000).toString();
        await env.Teligy3V.put(`code:${userId}`, code);

        await saveState(env, userId, { step: "awaiting_code", apartment: aptNum });

        await sendMessage(env.ADMIN_CHAT_ID, `Новий учасник:
Квартира: ${aptNum}
Ім’я: ${name}
Телефон: ${phone}
Код підтвердження: ${code}`);

        await sendMessage(userId, "✅ Код відправлено адміну. Введіть його:");
        return new Response("OK");
      }

      // ✅ code check
      if (userState?.step === "awaiting_code" && update.message?.text) {
        const savedCode = await env.Teligy3V.get(`code:${userId}`);
        const aptNum = userState.apartment;

        if (update.message.text.trim() !== savedCode) {
          await sendMessage(userId, "❌ Невірний код. Спробуйте ще раз.");
          return new Response("OK");
        }

        const resp = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/createChatInviteLink`, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ chat_id: env.GROUP_CHAT_ID, member_limit: 1 })
        });

        const invite = await resp.json();
        const link = invite.result.invite_link;

        await sendMessage(userId, `✅ Код вірний! Ось посилання:\n${link}`);

        await saveState(env, userId, { step: "registered" });

        await env.Teligy3V.delete(`code:${userId}`);
        await env.Teligy3V.delete(`joined_at:${userId}`);

        return new Response("OK");
      }

      return new Response("OK");
    } catch (e) {
      console.error("Error:", e);
      return new Response("Internal Server Error", { status: 500 });
    }
  },

  async scheduled(event, env) {
    await removeInactiveUsers(env);
  },
};

// ✅ auto purge
async function removeInactiveUsers(env) {
  const cutoff = Date.now() - 60 * 60 * 24 * 1000; // 24h

  const list = await env.Teligy3V.list({ prefix: "joined_at:" });

  for (const key of list.keys) {
    const userId = key.name.split(":")[1];
    const joinedAtStr = await env.Teligy3V.get(`joined_at:${userId}`);
    const stateRaw = await env.Teligy3V.get(`state:${userId}`);

    if (!joinedAtStr || !stateRaw) continue;

    const joinedAt = Number(joinedAtStr);
    const state = JSON.parse(stateRaw);

    if (joinedAt < cutoff && !["awaiting_code", "registered"].includes(state.step)) {
      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/banChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.GROUP_CHAT_ID, user_id: userId })
      });

      await env.Teligy3V.delete(`joined_at:${userId}`);
      await env.Teligy3V.delete(`state:${userId}`);
      await env.Teligy3V.delete(`code:${userId}`);
      await env.Teligy3V.delete(`last_active:${userId}`);
    }
  }
}
