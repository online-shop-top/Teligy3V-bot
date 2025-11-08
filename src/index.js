import { getUser, saveState, registerUser } from "./db.js";

// ---------------------- ADMIN PANEL ------------------------

async function sendAdminMenu(env, chatId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "👥 Мешканці", callback_data: "admin_users" },
        { text: "🏢 Квартири", callback_data: "admin_apartments" }
      ],
      [
        { text: "🆕 Заявки", callback_data: "admin_pending" },
        { text: "📊 Статистика", callback_data: "admin_stats" }
      ],
      [
        { text: "🔄 Перевірити БД", callback_data: "admin_check_db" }
      ]
    ]
  };

  await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "🛠 Адмін-панель",
      reply_markup: keyboard
    })
  });
}

// ---------------------- MAIN BOT LOGIC ------------------------

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      // Cron handler
      if (request.headers.get("CF-Worker-Cron") === "true") {
        await removeInactiveUsers(env);
        return new Response("Cron job completed");
      }

      // ----------------- ADMIN HTTP API -----------------

      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/admin/users") {
        if (url.searchParams.get("secret") !== env.TG_SECRET_TOKEN) {
          return new Response("Forbidden", { status: 403 });
        }

        const res = await env.DB
          .prepare("SELECT tg_id, full_name, apartment, phone, state, created_at FROM users")
          .all();

        return new Response(JSON.stringify(res.results || []), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // ----------------- IF NOT POST → STOP ------------------

      if (request.method !== "POST") {
        return new Response("Only POST method is allowed for this endpoint.", { status: 405 });
      }

      // -------------- TELEGRAM UPDATE HANDLER ---------------

      const update = await request.json();

      async function sendMessage(chatId, text, reply_markup = null) {
        const body = { chat_id: chatId, text, parse_mode: "Markdown" };
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

      // ----------------- SQL LOAD USER -----------------

      const record = await getUser(env, userId);
      const userState = record?.state || null;

      // ----------------- ADMIN COMMANDS -----------------

      if (update.message?.text === "/admin") {
        if (userId.toString() !== env.ADMIN_CHAT_ID.toString()) {
          await sendMessage(userId, "⛔ Доступ заборонено");
          return new Response("OK");
        }

        await sendAdminMenu(env, userId);
        return new Response("OK");
      }

      // ----------------- ADMIN CALLBACKS -----------------

      if (update.callback_query?.data?.startsWith("admin_")) {
        const action = update.callback_query.data.split("_")[1];
        await answerCallback(update.callback_query.id);

        if (userId.toString() !== env.ADMIN_CHAT_ID.toString()) {
          await sendMessage(userId, "⛔ Доступ заборонено");
          return new Response("OK");
        }

        // USERS LIST
        if (action === "users") {
          const res = await env.DB.prepare(
            "SELECT full_name, apartment, phone FROM users ORDER BY apartment ASC"
          ).all();

          let text = "👥 *Мешканці*\n\n";
          if (!res.results.length) text += "_Немає зареєстрованих_";
          else res.results.forEach(u => {
            text += `🏠 Кв. ${u.apartment} 👤 ${u.full_name} 📞 ${u.phone}\n`;
          });

          await sendMessage(userId, text);
        }

        // APARTMENTS
        if (action === "apartments") {
          const res = await env.DB.prepare(
            "SELECT apartment, COUNT(*) as c FROM users GROUP BY apartment ORDER BY apartment"
          ).all();

          let text = "🏢 *Квартири*\n\n";
          if (!res.results.length) text += "_Немає даних_";
          else res.results.forEach(u => {
            text += `Кв. ${u.apartment}: ${u.c} мешканців\n`;
          });

          await sendMessage(userId, text);
        }

        // STATS
        if (action === "stats") {
          const total = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first();
          await sendMessage(userId, `📊 *Статистика*\n👥 Мешканців: ${total.c}`);
        }

        if (action === "pending") {
          await sendMessage(userId, "🆕 Модуль заявок скоро 🛠");
        }

        if (action === "check_db") {
          const total = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first();
          await sendMessage(userId, `✅ БД працює\n👥 Користувачів: ${total.c}`);
        }

        return new Response("OK");
      }

      // ----------------- JOIN FLOW -----------------

      // New chat member auto-track
      if (update.chat_member?.new_chat_member?.status === "member") {
        // Позначаємо користувача як приєднаного (тобто завершена реєстрація)
        await saveState(env, userId, { step: "registered" });
        await env.Teligy3V.delete(`joined_at:${userId}`); // очищаємо тимчасову мітку
        return new Response("OK");
      }

      if (
        update.chat_member?.new_chat_member?.status === "kicked" ||
        update.chat_member?.new_chat_member?.status === "left"
      ) {
        const userId = update.chat_member.new_chat_member.user.id;

        // Очистити всі дані користувача
        await env.Teligy3V.delete(`joined_at:${userId}`);
        await env.Teligy3V.delete(`state:${userId}`);
        await env.Teligy3V.delete(`code:${userId}`);
        await env.Teligy3V.delete(`last_active:${userId}`);

        // Якщо він був у БД — видаляємо запис
        await env.DB.prepare("DELETE FROM users WHERE tg_id = ?").bind(userId).run();

        return new Response("OK");
      }
      await env.Teligy3V.put(`last_active:${userId}`, Date.now().toString());

      // START
      if (update.message?.text === "/start") {
        const fn = update.message.from.first_name || "друже";

        await sendMessage(
          userId,
          `👋 Привіт, ${fn}! Натисніть кнопку нижче, щоб подати заявку`,
          { inline_keyboard: [[{ text: "ПРИЄДНАТИСЬ ✅", callback_data: "join_request" }]] }
        );

        await saveState(env, userId, { step: "awaiting_join" });
        return new Response("OK");
      }

      // JOIN BUTTON
      if (update.callback_query?.data === "join_request") {
        await answerCallback(update.callback_query.id);

        await sendMessage(
          userId,
`👥 Мета чату:
Комунікація, опитування, прийняття рішень, оперативне інформування про важливі події, аварії тощо.

🤝 Поважай інших учасників чату:
– Без образ, хамства чи принижень.
– Критика має бути конструктивною.
– Особисті суперечки — у приват.

🚫 Заборонено:
– Політичні, релігійні, воєнні теми.
– Реклама, спам, продаж товарів/послуг.
– Поширення неперевіреної інформації.
– Ненормативна лексика, образливі жарти, токсичність.

🕗 Час для повідомлень: З 08:00 до 22:00.
🚨 Уночі — лише термінові аварійні повідомлення!

👮 За порушення правил — обмеження або видалення.

✅ Вступ до чату = згода з правилами.

❤️ Будьмо ввічливими, активними та відповідальними — разом зробимо наш будинок комфортним!`,
          { inline_keyboard: [[{ text: "ПОГОДЖУЮСЬ ✅", callback_data: "rules_accept" }]] }
        );

        await saveState(env, userId, { step: "awaiting_rules_accept" });
        return new Response("OK");
      }

      // ACCEPT RULES
      if (update.callback_query?.data === "rules_accept") {
        await answerCallback(update.callback_query.id);
        await sendMessage(userId, "Введіть номер квартири:");
        await saveState(env, userId, { step: "awaiting_apartment" });
        return new Response("OK");
      }

      // APARTMENT
      if (userState?.step === "awaiting_apartment" && update.message?.text) {
        const apt = parseInt(update.message.text.trim(), 10);

        if (isNaN(apt) || apt < 1 || apt > 120) {
          await sendMessage(userId, "❌ Невірний номер. Спробуйте ще раз.");
          return new Response("OK");
        }

        const current = await env.DB.prepare(
          "SELECT COUNT(*) as c FROM users WHERE apartment = ?"
        ).bind(apt).first();

        if (current.c >= 2) {
          await sendMessage(userId, "❌ 2 мешканці вже зареєстровані.");
          return new Response("OK");
        }

        await saveState(env, userId, { step: "awaiting_details", apartment: apt });
        await sendMessage(userId, "Введіть ім'я та телефон через кому. Наприклад: Іван, 0681234567");
        return new Response("OK");
      }

      // USER DETAILS
      if (userState?.step === "awaiting_details" && update.message?.text) {
        const [name, phone] = update.message.text.trim().split(",").map(s => s.trim());
        const apt = userState.apartment;

        if (!name || !phone) {
          await sendMessage(userId, "Введіть ім'я та телефон через кому. Наприклад: Іван, 0681234567");
          return new Response("OK");
        }

        await registerUser(env, userId, name, phone, apt);

        const code = Math.floor(1000 + Math.random() * 9000).toString();
        await env.Teligy3V.put(`code:${userId}`, code);

        await saveState(env, userId, { step: "awaiting_code", apartment: apt });

        await sendMessage(env.ADMIN_CHAT_ID,
`Нова заявка:
🏠 Кв. ${apt}
👤 ${name}
📞 ${phone}
🔐 Код: ${code}`);

        await sendMessage(userId, "✅ Очікуйте код від адміністратора. Потім введіть його:");
        return new Response("OK");
      }

      // CODE CHECK
      if (userState?.step === "awaiting_code" && update.message?.text) {
        const saved = await env.Teligy3V.get(`code:${userId}`);
        if (update.message.text.trim() !== saved) {
          await sendMessage(userId, "❌ Невірно. Спробуйте ще.");
          return new Response("OK");
        }

        const resp = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/createChatInviteLink`, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ chat_id: env.GROUP_CHAT_ID, member_limit: 1 })
        });
        const invite = await resp.json();
        const link = invite.result.invite_link;

        await sendMessage(userId, `✅ Вітаємо! Ось посилання на чат групи:\n${link}`);

        await saveState(env, userId, { step: "registered" });

        await env.Teligy3V.delete(`code:${userId}`);
        await env.Teligy3V.delete(`joined_at:${userId}`);

        return new Response("OK");
      }

      return new Response("OK");

    } catch (e) {
      console.error("Error", e);
      return new Response("Internal Error", { status: 500 });
    }
  },

  async scheduled(event, env) {
    await removeInactiveUsers(env);
  }
};

// ------------------- CLEANUP ---------------------

async function removeInactiveUsers(env) {
  const cutoff = Date.now() - 24 * 3600 * 1000;

  const list = await env.Teligy3V.list({ prefix: "joined_at:" });
  for (const key of list.keys) {
    const userId = key.name.split(":")[1];
    const ts = Number(await env.Teligy3V.get(`joined_at:${userId}`));
    const raw = await env.Teligy3V.get(`state:${userId}`);

    if (!ts || !raw) continue;

    const st = JSON.parse(raw);
    if (ts < cutoff && st.step !== "registered") {
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
