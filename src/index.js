export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const update = await request.json();
      console.log(JSON.stringify(update).slice(0, 400));

      const kv = env.Teligy3V;
      const msg = update.message;
      if (!msg) return new Response("No message", { status: 200 });

      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const text = msg.text?.trim() || "";

      async function sendMessage(to, text, buttons = null) {
        const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
        const body = { chat_id: to, text, parse_mode: "HTML" };
        if (buttons) body.reply_markup = { inline_keyboard: buttons };
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      // 1️⃣ Якщо повідомлення з групи — показуємо кнопку "ПРИЄДНАТИСЬ"
      if (msg.chat.type !== "private") {
        if (text === "/start" || text.includes("приєднати")) {
          const botUsername = env.BOT_USERNAME; // наприклад: "teligy3v_bot"
          const startUrl = `https://t.me/${botUsername}?start=join`;
          await sendMessage(chatId, "Щоб приєднатися до групи — натисни кнопку нижче 👇", [
            [{ text: "🔑 ПРИЄДНАТИСЬ", url: startUrl }],
          ]);
        }
        return new Response("OK", { status: 200 });
      }

      // 2️⃣ Приватний чат
      if (msg.chat.type === "private") {
        // Якщо користувач почав через /start join
        if (text.startsWith("/start")) {
          if (text.includes("join")) {
            await kv.put(`pending:${userId}`, JSON.stringify({ status: "awaiting_apartment" }));
            await sendMessage(chatId, "Привіт! Щоб приєднатися до групи, введи номер квартири:");
            return new Response("OK", { status: 200 });
          } else {
            await sendMessage(chatId, "Привіт! Використай кнопку 'ПРИЄДНАТИСЬ' у групі, щоб розпочати реєстрацію.");
            return new Response("OK", { status: 200 });
          }
        }

        // Обробка станів користувача
        let userData = await kv.get(`pending:${userId}`);
        if (userData) userData = JSON.parse(userData);

        if (!userData) {
          await sendMessage(chatId, "Будь ласка, натисни кнопку 'ПРИЄДНАТИСЬ' у групі, щоб розпочати.");
          return new Response("OK", { status: 200 });
        }

        if (userData.status === "awaiting_apartment") {
          const apartment = text;
          userData = { status: "awaiting_contact", apartment };
          await kv.put(`pending:${userId}`, JSON.stringify(userData));
          await sendMessage(chatId, "Введи своє ім’я та номер телефону (через кому):");
          return new Response("OK", { status: 200 });
        }

        if (userData.status === "awaiting_contact") {
          const [name, phone] = text.split(",").map(s => s.trim());
          if (!name || !phone) {
            await sendMessage(chatId, "Будь ласка, введи ім’я та телефон через кому, наприклад: Іван, 0501234567");
            return new Response("OK", { status: 200 });
          }

          const code = Math.floor(1000 + Math.random() * 9000).toString();
          userData = { ...userData, status: "awaiting_code", name, phone, code };
          await kv.put(`pending:${userId}`, JSON.stringify(userData));

          await sendMessage(env.ADMIN_CHAT_ID, 
            `🔔 Новий учасник:\nІм’я: ${name}\nКвартира: ${userData.apartment}\nТелефон: ${phone}\nКод: ${code}`
          );
          await sendMessage(chatId, "Тепер введи код підтвердження, який тобі повідомив адміністратор:");
          return new Response("OK", { status: 200 });
        }

        if (userData.status === "awaiting_code") {
          if (text === userData.code) {
            const inviteLink = env.GROUP_INVITE_URL; // посилання на групу
            await sendMessage(chatId, `✅ Дякуємо! Тепер ти можеш приєднатись до групи:\n${inviteLink}`);
            userData.status = "approved";
            await kv.put(`pending:${userId}`, JSON.stringify(userData));
          } else {
            await sendMessage(chatId, "❌ Невірний код. Спробуй ще раз.");
          }
          return new Response("OK", { status: 200 });
        }
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Hello from Worker!", { status: 200 });
  },
};
