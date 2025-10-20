export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Hello from Telegram Group Bot!", { status: 200 });
    }

    const update = await request.json();
    const TG_API = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}`;

    // Функція відправки повідомлення
    async function sendMessage(chat_id, text, reply_markup) {
      const body = { chat_id, text };
      if (reply_markup) body.reply_markup = reply_markup;
      await fetch(`${TG_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    // Функція обмеження користувача у чаті
    async function restrictUser(chat_id, user_id) {
      await fetch(`${TG_API}/restrictChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id,
          user_id,
          permissions: {
            can_send_messages: false,
            can_send_media_messages: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false,
          },
        }),
      });
    }

    if (update.message && update.message.new_chat_members) {
      for (const member of update.message.new_chat_members) {
        const chatId = update.message.chat.id;
        const userId = member.id;
        const firstName = member.first_name || "Користувач";

        // Обмежуємо нового користувача
        await restrictUser(chatId, userId);

        // Зберігаємо pending_users: ID і дата входу
        const now = new Date().toISOString();
        await env.KV.put(`pending_users:${userId}`, JSON.stringify({ userId, joinedAt: now, status: "pending" }));

        // Відправляємо у групу повідомлення з кнопкою "ПРИЄДНАТИСЬ"
        const keyboard = {
          inline_keyboard: [[{ text: "ПРИЄДНАТИСЬ", callback_data: `join_${userId}` }]],
        };
        await sendMessage(
          chatId,
          `👋 Привіт, ${firstName}!\nНатисни кнопку нижче, щоб подати заявку на приєднання.`,
          keyboard
        );
      }
    }

    if (update.callback_query) {
      const data = update.callback_query.data;
      const chatId = update.callback_query.message.chat.id;
      const userId = update.callback_query.from.id;

      if (data === `join_${userId}`) {
        let userData = (await env.KV.get(`pending_users:${userId}`, { type: "json" })) || {};
        if (!userData.status || userData.status === "pending") {
          userData.status = "awaiting_apartment";
          await env.KV.put(`pending_users:${userId}`, JSON.stringify(userData));

          // Відправляємо приватне повідомлення з проханням ввести номер квартири
          await sendMessage(userId, "Привіт! Щоб приєднатися до групи, введи номер квартири (від 1 до 120).");
          
          // Підтверджуємо натискання кнопки
          await fetch(`${TG_API}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callback_query_id: update.callback_query.id,
              text: "✅ Тепер введи номер квартири у приватному чаті.",
              show_alert: false,
            }),
          });

          // Видаляємо повідомлення кнопки
          await fetch(`${TG_API}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: update.callback_query.message.message_id,
            }),
          });
        }
      }
      return new Response("OK", { status: 200 });
    }

    // Обробка текстових повідомлень в приватному чаті для збору даних
    if (update.message && update.message.chat.type === "private") {
      const userId = update.message.from.id;
      const text = (update.message.text || "").trim();
      let userData = (await env.KV.get(`pending_users:${userId}`, { type: "json" })) || null;
      if (!userData) {
        return new Response("OK", { status: 200 }); // Якщо користувача немає у pending_users — ігноруємо
      }

      if (userData.status === "awaiting_apartment") {
        const aptNum = Number(text);
        if (isNaN(aptNum) || aptNum < 1 || aptNum > 120) {
          await sendMessage(userId, "Такого номеру квартири не існує. Спробуйте ще раз.");
          return new Response("OK", { status: 200 });
        }

        // Перевірка кількості зареєстрованих
        const residents = (await env.KV.get(`apartments:${aptNum}`, { type: "json" })) || [];
        if (residents.length >= 2) {
          await sendMessage(userId, "На цю квартиру вже зареєстровано максимальну кількість осіб. Зверніться до адміністратора.");
          return new Response("OK", { status: 200 });
        }

        userData.status = "awaiting_name_phone";
        userData.apartment = aptNum;
        await env.KV.put(`pending_users:${userId}`, JSON.stringify(userData));
        await sendMessage(userId, "Введіть ваше ім'я та номер телефону у форматі: Ім'я, Телефон");
        return new Response("OK", { status: 200 });
      }

      if (userData.status === "awaiting_name_phone") {
        const parts = text.split(",").map(s => s.trim());
        if (parts.length < 2) {
          await sendMessage(userId, "Будь ласка, введіть ім'я та телефон у форматі: Ім'я, Телефон");
          return new Response("OK", { status: 200 });
        }
        const [name, phone] = parts;
        userData.name = name;
        userData.phone = phone;

        // Генерація коду для адміністратора
        const adminCode = Math.floor(1000 + Math.random() * 9000);
        userData.admin_code = adminCode;
        userData.status = "awaiting_code";
        await env.KV.put(`pending_users:${userId}`, JSON.stringify(userData));

        // Надсилаємо адміністратору повідомлення
        const adminId = Number(env.ADMIN_CHAT_ID);
        await sendMessage(adminId, `Новий учасник:\nІм'я: ${name}\nКвартира: ${userData.apartment}\nТелефон: ${phone}\nКод підтвердження: ${adminCode}`);

        await sendMessage(userId, "Ваші дані надіслані адміністратору. Введіть отриманий код підтвердження.");
        return new Response("OK", { status: 200 });
      }

      if (userData.status === "awaiting_code") {
        if (text === String(userData.admin_code)) {
          userData.status = "approved";
          // Додаємо користувача у список мешканців квартири
          const residents = (await env.KV.get(`apartments:${userData.apartment}`, { type: "json" })) || [];
          residents.push(userId);
          await env.KV.put(`apartments:${userData.apartment}`, JSON.stringify(residents));
          await env.KV.put(`pending_users:${userId}`, JSON.stringify(userData));

          // Знімаємо обмеження з користувача
          await fetch(`${TG_API}/restrictChatMember`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: userData.chat_id || null,
              user_id: userId,
              permissions: {
                can_send_messages: true,
                can_send_media_messages: true,
                can_send_polls: true,
                can_send_other_messages: true,
                can_add_web_page_previews: true,
                can_invite_users: true,
              },
            }),
          });

          await sendMessage(userId, "✅ Ви успішно приєднані до групи!");
        } else {
          await sendMessage(userId, "❌ Невірний код. Спробуйте ще раз.");
        }
        return new Response("OK", { status: 200 });
      }
    }

    return new Response("OK", { status: 200 });
  },
};
