export default {
  async fetch(request, env) {
    try {
      const db = env.my_database; // Підключення до D1

      // Крок 1: Створення таблиць, якщо вони не існують
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, -- Унікальний ID користувача
          first_name TEXT,
          last_name TEXT,
          phone TEXT,
          apartment INTEGER,
          status TEXT, -- Статус користувача
          joined_at INTEGER -- Час приєднання
        );
      `).run();

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS confirmation_codes (
          user_id TEXT PRIMARY KEY, -- Зв'язок з користувачем
          code TEXT,
          created_at INTEGER -- Час створення коду
        );
      `).run();

      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      if (request.headers.get("CF-Worker-Cron") === "true") {
        await removeInactiveUsers(db, env);
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

      // Крок 2: Створення нового користувача
      if (update.chat_member?.new_chat_member?.status === "member") {
        await db.prepare("INSERT OR REPLACE INTO users (id, status, joined_at) VALUES (?, ?, ?)")
          .bind(userId, "not_registered", Date.now())
          .run();
        return new Response("OK");
      }

      // Крок 3: Оновлення активності користувача
      await db.prepare("UPDATE users SET joined_at = ? WHERE id = ?")
        .bind(Date.now(), userId)
        .run();

      const userState = await db.prepare("SELECT * FROM users WHERE id = ?")
        .bind(userId)
        .first();

      // Крок 4: Обробка команд
      if (update.message?.text === "/start") {
        const firstName = update.message.from.first_name || "користувач";

        await sendMessage(
          userId,
          `👋 Привіт, ${firstName}!\nНатисни кнопку нижче, щоб подати заявку на приєднання до групи.`,
          { inline_keyboard: [[{ text: "ПРИЄДНАТИСЬ ✅", callback_data: "join_request" }]] }
        );

        await db.prepare("UPDATE users SET status = ? WHERE id = ?")
          .bind("awaiting_join", userId)
          .run();
        return new Response("OK");
      }

      // Натискання "ПРИЄДНАТИСЬ"
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
          { inline_keyboard: [[{ text: "ПОГОДЖУСЬ ✅", callback_data: "rules_accept" }]] }
        );

        await db.prepare("UPDATE users SET status = ? WHERE id = ?")
          .bind("awaiting_rules_accept", userId)
          .run();
        return new Response("OK");
      }

      // Погодження правил
      if (update.callback_query?.data === "rules_accept") {
        await answerCallback(update.callback_query.id);
        await sendMessage(userId, "Введіть номер квартири:");
        await db.prepare("UPDATE users SET status = ? WHERE id = ?")
          .bind("awaiting_apartment", userId)
          .run();
        return new Response("OK");
      }

      // Введення номера квартири
      if (userState.status === "awaiting_apartment" && update.message?.text) {
        const aptNum = parseInt(update.message.text.trim(), 10);

        if (isNaN(aptNum) || aptNum < 1 || aptNum > 120) {
          await sendMessage(userId, "❌ Такої квартири не існує. Спробуйте ще раз.");
          return new Response("OK");
        }

        let registered = await db.prepare("SELECT * FROM users WHERE apartment = ?")
          .bind(aptNum)
          .all();

        if (registered.length >= 2) {
          await sendMessage(userId, "❌ На цю квартиру вже зареєстровано 2 мешканці.");
          return new Response("OK");
        }

        await db.prepare("UPDATE users SET apartment = ? WHERE id = ?")
          .bind(aptNum, userId)
          .run();

        await db.prepare("UPDATE users SET status = ? WHERE id = ?")
          .bind("awaiting_details", userId)
          .run();

        await sendMessage(userId, "Введіть ім'я та телефон через кому. Наприклад: Іван, 0681234567");
        return new Response("OK");
      }

      // Введення ім'я та телефону
      if (userState.status === "awaiting_details" && update.message?.text) {
        const [name, phone] = update.message.text.trim().split(",").map(s => s.trim());

        if (!name || !phone) {
          await sendMessage(userId, "Будь ласка, введіть ім'я і телефон через кому. Наприклад: Іван, 0681234567");
          return new Response("OK");
        }

        const aptNum = userState.apartment;
        await db.prepare("UPDATE users SET first_name = ?, phone = ? WHERE id = ?")
          .bind(name, phone, userId)
          .run();

        const code = Math.floor(1000 + Math.random() * 9000).toString();
        await db.prepare("INSERT OR REPLACE INTO confirmation_codes (user_id, code, created_at) VALUES (?, ?, ?)")
          .bind(userId, code, Date.now())
          .run();

        await sendMessage(env.ADMIN_CHAT_ID, `Новий учасник:\nКвартира: ${aptNum}\nІм’я: ${name}\nТелефон: ${phone}\nКод підтвердження: ${code}`);
        await sendMessage(userId, "✅ Код підтвердження надіслано адміністратору. Будь ласка, введіть код для підтвердження.");
        return new Response("OK");
      }

      // Перевірка коду
      if (userState.status === "awaiting_code" && update.message?.text) {
        const savedCode = await db.prepare("SELECT * FROM confirmation_codes WHERE user_id = ?")
          .bind(userId)
          .first();

        if (update.message.text.trim() !== savedCode.code) {
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

        await sendMessage(userId, `✅ Код вірний! Ось посилання для приєднання до групи:\n${link}`);
        await db.prepare("UPDATE users SET status = ? WHERE id = ?")
          .bind("registered", userId)
          .run();
        await db.prepare("DELETE FROM confirmation_codes WHERE user_id = ?")
          .bind(userId)
          .run();

        return new Response("OK");
      }

      return new Response("OK");
    } catch (error) {
      console.error("Error processing request:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }
};

// Функція для видалення неактивних користувачів (наприклад, після 24 годин)
async function removeInactiveUsers(db, env) {
  const now = Date.now();
  const timeout = 24 * 60 * 60 * 1000; // 24 години

  const users = await db.prepare("SELECT * FROM users WHERE status = ?")
    .bind("not_registered")
    .all();

  for (const user of users) {
    if (now - user.joined_at > timeout) {
      await db.prepare("DELETE FROM users WHERE id = ?")
        .bind(user.id)
        .run();
      await db.prepare("DELETE FROM confirmation_codes WHERE user_id = ?")
        .bind(user.id)
        .run();
      await sendMessage(env.ADMIN_CHAT_ID, `Користувач ${user.id} не пройшов реєстрацію і був видалений.`);
    }
  }
}
