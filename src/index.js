import { getUser, saveState, registerUser, clearState } from "./db.js";

export default {
  async fetch(request, env) {
    try {
      if (request.method !== "POST") {
        return new Response("Only POST requests are supported", { status: 405 });
      }

      const update = await request.json();

      // ---------- Службові функції ----------
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
          body: JSON.stringify({ callback_query_id: id, text }),
        });
      }

      const userId =
        update.message?.from?.id ||
        update.callback_query?.from?.id ||
        update.chat_member?.new_chat_member?.user?.id;

      if (!userId) return new Response("Invalid user data", { status: 400 });

      const record = await getUser(env, userId);
      const userState = record?.state || null;

      // ---------- /start ----------
      if (update.message?.text === "/start") {
        const existing = await env.DB.prepare(
          "SELECT tg_id FROM users WHERE tg_id = ?"
        ).bind(userId).first();

        if (existing) {
          await sendMessage(userId, "✅ Ви вже зареєстровані.");
          return new Response("OK");
        }

        const fn = update.message.from.first_name || "друже";
        await sendMessage(
          userId,
          `👋 Привіт, ${fn}! Натисніть кнопку нижче, щоб подати заявку`,
          { inline_keyboard: [[{ text: "ПРИЄДНАТИСЬ ✅", callback_data: "join_request" }]] }
        );

        await saveState(env, userId, { step: "awaiting_join" });
        return new Response("OK");
      }

      // ---------- Кнопка Почати спочатку ----------
      if (update.callback_query?.data === "restart") {
        await answerCallback(update.callback_query.id);
        await clearState(env, userId);
        await sendMessage(userId, "🔁 Почнемо спочатку!");
        await sendMessage(
          userId,
          "👋 Натисніть кнопку нижче, щоб подати заявку",
          { inline_keyboard: [[{ text: "ПРИЄДНАТИСЬ ✅", callback_data: "join_request" }]] }
        );
        return new Response("OK");
      }

      // ---------- JOIN BUTTON ----------
      if (update.callback_query?.data === "join_request") {
        await answerCallback(update.callback_query.id);

        const existing = await env.DB.prepare(
          "SELECT tg_id FROM users WHERE tg_id = ?"
        ).bind(userId).first();

        if (existing) {
          await sendMessage(userId, "✅ Ви вже зареєстровані.");
          return new Response("OK");
        }

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

      // ---------- ACCEPT RULES ----------
      if (update.callback_query?.data === "rules_accept") {
        await answerCallback(update.callback_query.id);
        await sendMessage(
          userId,
          "Введіть номер квартири:",
          { inline_keyboard: [[{ text: "🔁 Почати спочатку", callback_data: "restart" }]] }
        );
        await saveState(env, userId, { step: "awaiting_apartment" });
        return new Response("OK");
      }

      // ---------- APARTMENT ----------
      if (userState?.step === "awaiting_apartment" && update.message?.text) {
        const apt = parseInt(update.message.text.trim(), 10);

        if (isNaN(apt) || apt < 1 || apt > 120) {
          await sendMessage(userId, "❌ Невірний номер. Спробуйте ще раз.", {
            inline_keyboard: [[{ text: "🔁 Почати спочатку", callback_data: "restart" }]]
          });
          return new Response("OK");
        }

        const current = await env.DB.prepare(
          "SELECT COUNT(*) as c FROM users WHERE apartment = ?"
        ).bind(apt).first();

        if (current.c >= 2) {
          await sendMessage(userId, "❌ 2 мешканці вже зареєстровані.", {
            inline_keyboard: [[{ text: "🔁 Почати спочатку", callback_data: "restart" }]]
          });
          return new Response("OK");
        }

        await saveState(env, userId, { step: "awaiting_details", apartment: apt });
        await sendMessage(
          userId,
          "Введіть ім'я та телефон через кому. Наприклад: Іван, 0681234567",
          { inline_keyboard: [[{ text: "🔁 Почати спочатку", callback_data: "restart" }]] }
        );
        return new Response("OK");
      }

      // ---------- USER DETAILS ----------
      if (userState?.step === "awaiting_details" && update.message?.text) {
        const [name, phone] = update.message.text.trim().split(",").map(s => s.trim());
        const apt = userState.apartment;

        if (!name || !phone) {
          await sendMessage(userId, "⚠️ Введіть у форматі: Ім’я, телефон", {
            inline_keyboard: [[{ text: "🔁 Почати спочатку", callback_data: "restart" }]]
          });
          return new Response("OK");
        }

        // Зберігаємо у state, але ще не в БД
        await saveState(env, userId, { step: "awaiting_code", apartment: apt, name, phone });

        const code = Math.floor(1000 + Math.random() * 9000).toString();
        await env.Teligy3V.put(`code:${userId}`, code);

        await sendMessage(env.ADMIN_CHAT_ID,
`Нова заявка:
🏠 Кв. ${apt}
👤 ${name}
📞 ${phone}
🔐 Код: ${code}`);

        await sendMessage(
          userId,
          "✅ Очікуйте код від адміністратора, потім введіть його:",
          { inline_keyboard: [[{ text: "🔁 Почати спочатку", callback_data: "restart" }]] }
        );
        return new Response("OK");
      }

      // ---------- CODE CHECK ----------
      if (userState?.step === "awaiting_code" && update.message?.text) {
        const saved = await env.Teligy3V.get(`code:${userId}`);
        if (update.message.text.trim() !== saved) {
          await sendMessage(userId, "❌ Невірний код. Спробуйте ще.", {
            inline_keyboard: [[{ text: "🔁 Почати спочатку", callback_data: "restart" }]]
          });
          return new Response("OK");
        }

        const { name, phone, apartment } = userState;

        // ✅ Реєстрація лише після підтвердження коду
        await registerUser(env, userId, name, phone, apartment);

        const resp = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/createChatInviteLink`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: env.GROUP_CHAT_ID, member_limit: 1 })
        });
        const invite = await resp.json();
        const link = invite.result.invite_link;

        await sendMessage(userId, `✅ Вітаємо! Ось посилання на чат:\n${link}`);
        return new Response("OK");
      }

      return new Response("OK");

    } catch (e) {
      console.error("Error", e);
      return new Response("Internal Error", { status: 500 });
    }
  }
};
