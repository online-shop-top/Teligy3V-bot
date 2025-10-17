export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const update = await request.json();
      console.log("Incoming update:", JSON.stringify(update));

      const api = (method, body) =>
        fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

      // ---- Повідомлення користувача ----
      if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text || "";

        // 🟢 Крок 1: /start join — показує кнопку “✅ Приєднатись”
        if (text === "/start join") {
          await api("sendMessage", {
            chat_id: chatId,
            text: "Привіт! Натисни кнопку нижче, щоб приєднатися до спільноти 🏘️",
            reply_markup: {
              inline_keyboard: [[{ text: "✅ Приєднатись", callback_data: "start_join" }]],
            },
          });
          return new Response("OK");
        }

        // 🟢 Отримання стану користувача
        const pending = await env.Teligy3V.get(`user_${chatId}`, { type: "json" });

        // 🟠 Введення номера квартири
        if (pending && pending.status === "awaiting_flat") {
          const flat = text.trim();

          // Отримуємо список усіх користувачів
          const listKeys = await env.Teligy3V.list({ prefix: "user_" });
          let sameFlatCount = 0;

          for (const k of listKeys.keys) {
            const user = await env.Teligy3V.get(k.name, { type: "json" });
            if (user && user.flat === flat && user.status === "approved") {
              sameFlatCount++;
            }
          }

          // 🔴 Якщо на квартиру вже є 2+ осіб
          if (sameFlatCount >= 2) {
            await api("sendMessage", {
              chat_id: chatId,
              text: `❌ На квартиру №${flat} вже зареєстровано максимальну кількість мешканців (2).\nЗверніться до адміністратора.`,
            });
            await env.Teligy3V.delete(`user_${chatId}`);
            return new Response("OK");
          }

          // ✅ Інакше — продовжуємо збір даних
          await env.Teligy3V.put(`user_${chatId}`, JSON.stringify({ ...pending, flat, status: "awaiting_name" }));
          await api("sendMessage", { chat_id: chatId, text: "Введи своє ім’я:" });
          return new Response("OK");
        }

        // 🟠 Введення імені
        if (pending && pending.status === "awaiting_name") {
          await env.Teligy3V.put(`user_${chatId}`, JSON.stringify({ ...pending, name: text, status: "awaiting_phone" }));
          await api("sendMessage", { chat_id: chatId, text: "Введи свій номер телефону:" });
          return new Response("OK");
        }

        // 🟠 Введення телефону → надсилання адміністратору
        if (pending && pending.status === "awaiting_phone") {
          const user = { ...pending, phone: text, status: "awaiting_code" };
          const code = Math.floor(1000 + Math.random() * 9000).toString();
          user.code = code;

          await env.Teligy3V.put(`user_${chatId}`, JSON.stringify(user));

          // Надсилаємо адміністратору
          await api("sendMessage", {
            chat_id: 2102040810, // ID адміністратора
            text: `👤 Новий учасник:\n🏢 Квартира: ${user.flat}\n👋 Ім’я: ${user.name}\n📞 Телефон: ${user.phone}\n🔑 Код підтвердження: ${code}`,
          });

          await api("sendMessage", {
            chat_id: chatId,
            text: "Очікується підтвердження адміністратора. Введи код, коли отримаєш його.",
          });
          return new Response("OK");
        }

        // 🟠 Перевірка коду підтвердження
        if (pending && pending.status === "awaiting_code") {
          if (text === pending.code) {
            await env.Teligy3V.put(`user_${chatId}`, JSON.stringify({ ...pending, status: "approved" }));

            await api("sendMessage", {
              chat_id: chatId,
              text: "✅ Вітаємо! Тебе підтверджено. Тепер ти можеш приєднатися до групи 🎉",
            });

            // Посилання на групу
            await api("sendMessage", {
              chat_id: chatId,
              text: "Ось посилання для вступу до групи: https://t.me/your_private_group_link",
            });
          } else {
            await api("sendMessage", { chat_id: chatId, text: "❌ Невірний код. Спробуй ще раз." });
          }
          return new Response("OK");
        }
      }

      // ---- Натискання кнопки ----
      if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.from.id; // важливо! chat.id може бути іншим
        const data = query.data;

        if (data === "start_join") {
          await env.Teligy3V.put(`user_${chatId}`, JSON.stringify({ chatId, status: "awaiting_flat" }));
          await api("sendMessage", { chat_id: chatId, text: "Введи номер своєї квартири:" });
        }

        await api("answerCallbackQuery", { callback_query_id: query.id });
        return new Response("OK");
      }

      return new Response("OK");
    }

    return new Response("Worker is running", { status: 200 });
  },
};
