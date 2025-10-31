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

      if (!userId) {
        return new Response("Invalid user data", { status: 400 });
      }

      // ✅ Новий учасник
      if (update.chat_member?.new_chat_member?.status === "member") {
        await env.Teligy3V.put(`joined_at:${userId}`, Date.now().toString());
        await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "not_registered" }));
        return new Response("OK");
      }

      // ✅ Оновлення активності
      await env.Teligy3V.put(`last_active:${userId}`, Date.now().toString());

      let userStateRaw = await env.Teligy3V.get(`state:${userId}`);
      let userState = null;
      try {
        userState = userStateRaw ? JSON.parse(userStateRaw) : null;
      } catch {}

      // ✅ /start
      if (update.message?.text === "/start") {
        const firstName = update.message.from.first_name || "користувач";

        await sendMessage(
          userId,
          `👋 Привіт, ${firstName}!\nНатисни кнопку нижче, щоб подати заявку на приєднання до групи.`,
          { inline_keyboard: [[{ text: "ПРИЄДНАТИСЬ ✅", callback_data: "join_request" }]] }
        );

        await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_join" }));
        return new Response("OK");
      }

      // ✅ Натискання "ПРИЄДНАТИСЬ"
      if (update.callback_query?.data === "join_request") {
        await answerCallback(update.callback_query.id);
        await sendMessage(
          userId,
          `👥 Мета чату:
Комунікація, опитування, прийняття рішень, оперативне інформування про важливі події, аварії тощо.
❗ Не для політики, реклами чи особистих суперечок.

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

        await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_rules_accept" }));
        return new Response("OK");
      }

      // ✅ Погодження правил
      if (update.callback_query?.data === "rules_accept") {
        await answerCallback(update.callback_query.id);
        await sendMessage(userId, "Введіть номер квартири:");
        await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_apartment" }));
        return new Response("OK");
      }

      // ✅ Введення номера квартири
      if (userState?.step === "awaiting_apartment" && update.message?.text) {
        const aptNum = parseInt(update.message.text.trim(), 10);

        if (isNaN(aptNum) || aptNum < 1 || aptNum > 120) {
          await sendMessage(userId, "❌ Такої квартири не існує. Спробуйте ще раз.");
          return new Response("OK");
        }

        let registered = (await env.Teligy3V.get(`apt:${aptNum}`, { type: "json" })) || [];

        if (registered.length >= 2) {
          await sendMessage(userId, "❌ На цю квартиру вже зареєстровано 2 мешканці.");
          await env.Teligy3V.delete(`state:${userId}`);
          await env.Teligy3V.delete(`joined_at:${userId}`);
          return new Response("OK");
        }

        await env.Teligy3V.put(
          `state:${userId}`,
          JSON.stringify({ step: "awaiting_details", apartment: aptNum })
        );

        await sendMessage(userId, "Введіть ім'я та телефон через кому:");
        return new Response("OK");
      }

      // ✅ Введення ім'я та телефону
      if (userState?.step === "awaiting_details" && update.message?.text) {
        const [name, phone] = update.message.text.trim().split(",").map(s => s.trim());

        if (!name || !phone) {
          await sendMessage(userId, "Будь ласка, введіть ім'я і телефон через кому. Наприклад: Іван, 0681234567");
          return new Response("OK");
        }

        const aptNum = userState.apartment;
        let registered = (await env.Teligy3V.get(`apt:${aptNum}`, { type: "json" })) || [];

        registered.push({ userId, name, phone });
        await env.Teligy3V.put(`apt:${aptNum}`, JSON.stringify(registered));

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await env.Teligy3V.put(`code:${userId}`, code);
        await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "awaiting_code", apartment: aptNum }));

        await sendMessage(env.ADMIN_CHAT_ID, `🏠 Квартира ${aptNum}\n👤 ${name}\n📱 ${phone}\n🔑 Код: ${code}`);
        await sendMessage(userId, "✅ Код надіслано адміністратору.");
        return new Response("OK");
      }

      // ✅ Перевірка коду
      if (userState?.step === "awaiting_code" && update.message?.text) {
        const savedCode = await env.Teligy3V.get(`code:${userId}`);
        const aptNum = userState.apartment;

        if (update.message.text.trim() !== savedCode) {
          await sendMessage(userId, "❌ Невірний код. Ще раз:");
          return new Response("OK");
        }

        const resp = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/createChatInviteLink`, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ chat_id: env.GROUP_CHAT_ID, member_limit: 1 })
        });

        const invite = await resp.json();
        const link = invite.result.invite_link;

        await sendMessage(userId, `✅ Код підтверджено!\nОсь ваше посилання:\n${link}`);

        await env.Teligy3V.put(`state:${userId}`, JSON.stringify({ step: "registered" }));
        await env.Teligy3V.delete(`code:${userId}`);
        await env.Teligy3V.delete(`joined_at:${userId}`);

        return new Response("OK");
      }

      return new Response("OK");
    } catch (error) {
      console.error("Error processing request:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },

  async scheduled(event, env) {
    await removeInactiveUsers(env);
  },
};

// ✅ Авто-видалення неактивних
async function removeInactiveUsers(env) {
  const cutoff = Date.now() - 30 * 60 * 1000; // 30 хвилин

  const list = await env.Teligy3V.list({ prefix: "joined_at:" });
  const aptList = await env.Teligy3V.list({ prefix: "apt:" });

  for (const key of list.keys) {
    const userId = key.name.split(":")[1];
    const joinedAtStr = await env.Teligy3V.get(`joined_at:${userId}`);
    const stateRaw = await env.Teligy3V.get(`state:${userId}`);

    if (!joinedAtStr || !stateRaw) continue;

    const joinedAt = Number(joinedAtStr);
    const state = JSON.parse(stateRaw);

    if (
      joinedAt < cutoff &&
      !["awaiting_code", "registered"].includes(state.step)
    ) {
      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/banChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.GROUP_CHAT_ID,
          user_id: userId,
        }),
      });

      await env.Teligy3V.delete(`joined_at:${userId}`);
      await env.Teligy3V.delete(`state:${userId}`);
      await env.Teligy3V.delete(`code:${userId}`);
      await env.Teligy3V.delete(`last_active:${userId}`);
      await env.Teligy3V.delete(`apt:*${userId}`);
    }
  }
}
