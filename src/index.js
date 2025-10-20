export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Hello from Telegram Group Bot!", { status: 200 });
    }

    const update = await request.json();
    console.log("Incoming update:", JSON.stringify(update));

    // --- 1️⃣ Новий учасник приєднався ---
    if (update.message && update.message.new_chat_members) {
      for (const member of update.message.new_chat_members) {
        const chatId = update.message.chat.id;
        const userId = member.id;
        const firstName = member.first_name || "Користувач";

        // Тимчасово блокуємо нового учасника
        await restrictMember(env.TG_BOT_TOKEN, chatId, userId);

        // Відправляємо повідомлення з кнопкою "Приєднатися"
        await sendJoinMessage(env.TG_BOT_TOKEN, chatId, userId, firstName);
      }
      return new Response("OK", { status: 200 });
    }

    // --- 2️⃣ Обробка callback кнопки ---
    if (update.callback_query) {
      const chatId = update.callback_query.message.chat.id;
      const userId = update.callback_query.from.id;

      if (update.callback_query.data === `join_${userId}`) {
        // Створюємо запис у KV якщо його ще нема
        let userData = (await env.KV.get(`pending_users:${userId}`, { type: "json" })) || {
          status: "pending",
          chat_id: chatId,
        };
        await env.KV.put(`pending_users:${userId}`, JSON.stringify(userData));

        // Відправляємо приватне повідомлення користувачу
        await sendMessage(env.TG_BOT_TOKEN, userId, "Привіт! Введіть номер квартири.");
      }

      // Відповідаємо на callback
      await answerCallback(env.TG_BOT_TOKEN, update.callback_query.id, "✅ Введіть дані у приватному чаті!");
      return new Response("OK", { status: 200 });
    }

    // --- 3️⃣ Обробка текстових повідомлень користувача ---
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text.trim();

      let userData = (await env.KV.get(`pending_users:${userId}`, { type: "json" })) || null;
      if (!userData) return new Response("OK", { status: 200 });

      // --- Введення номера квартири ---
      if (userData.status === "pending") {
        const apartmentNumber = text;

        const residents = (await env.KV.get(`apartments:${apartmentNumber}`, { type: "json" })) || [];
        if (residents.length >= 2) {
          await sendMessage(env.TG_BOT_TOKEN, userId, "На цю квартиру вже зареєстровано максимальну кількість осіб.");
          return new Response("OK", { status: 200 });
        }

        userData.status = "awaiting_name_phone";
        userData.apartment = apartmentNumber;
        await env.KV.put(`pending_users:${userId}`, JSON.stringify(userData));

        await sendMessage(env.TG_BOT_TOKEN, userId, "Введіть ваше ім'я та номер телефону у форматі: Ім'я, Телефон");
        return new Response("OK", { status: 200 });
      }

      // --- Введення імені та телефону ---
      if (userData.status === "awaiting_name_phone") {
        const parts = text.split(",").map(s => s.trim());
        if (parts.length !== 2) {
          await sendMessage(env.TG_BOT_TOKEN, userId, "❌ Некоректний формат. Введіть: Ім'я, Телефон");
          return new Response("OK", { status: 200 });
        }

        const [name, phone] = parts;
        const adminCode = Math.floor(1000 + Math.random() * 9000);

        userData.name = name;
        userData.phone = phone;
        userData.admin_code = adminCode;
        userData.status = "awaiting_admin_code";
        await env.KV.put(`pending_users:${userId}`, JSON.stringify(userData));

        // Надсилаємо адміністратору
        const adminId = Number(env.ADMIN_CHAT_ID);
        await sendMessage(env.TG_BOT_TOKEN, adminId, 
          `Новий учасник:\nІм'я: ${name}\nКвартира: ${userData.apartment}\nТелефон: ${phone}\nКод підтвердження: ${adminCode}`
        );

        await sendMessage(env.TG_BOT_TOKEN, userId, "Ваші дані надіслані адміністратору. Введіть отриманий код підтвердження.");
        return new Response("OK", { status: 200 });
      }

      // --- Введення коду адміністратором ---
      if (userData.status === "awaiting_admin_code") {
        const enteredCode = text;
        if (enteredCode === String(userData.admin_code)) {
          // Підтверджуємо користувача
          userData.status = "approved";
          await env.KV.put(`pending_users:${userId}`, JSON.stringify(userData));

          const residents = (await env.KV.get(`apartments:${userData.apartment}`, { type: "json" })) || [];
          residents.push(userId);
          await env.KV.put(`apartments:${userData.apartment}`, JSON.stringify(residents));

          // Знімаємо обмеження
          await restrictMember(env.TG_BOT_TOKEN, userData.chat_id, userId, true);

          await sendMessage(env.TG_BOT_TOKEN, userId, `✅ Ви успішно приєднані до групи!`);
        } else {
          await sendMessage(env.TG_BOT_TOKEN, userId, "❌ Невірний код. Спробуйте ще раз.");
        }
        return new Response("OK", { status: 200 });
      }
    }

    return new Response("OK", { status: 200 });
  },
};

// --- Функції допоміжні ---
async function sendMessage(token, chatId, text, keyboard) {
  const body = { chat_id: chatId, text };
  if (keyboard) body.reply_markup = keyboard;

  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!data.ok) console.error("Telegram sendMessage error:", data);
}

async function answerCallback(token, callbackId, text) {
  const resp = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: false }),
  });
  const data = await resp.json();
  if (!data.ok) console.error("Telegram answerCallbackQuery error:", data);
}

async function restrictMember(token, chatId, userId, unrestrict = false) {
  const permissions = unrestrict
    ? {
        can_send_messages: true,
        can_send_media_messages: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_invite_users: true,
      }
    : { can_send_messages: false };

  const resp = await fetch(`https://api.telegram.org/bot${token}/restrictChatMember`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, user_id: userId, permissions }),
  });
  const data = await resp.json();
  if (!data.ok) console.error("Telegram restrictChatMember error:", data);
}

async function sendJoinMessage(token, chatId, userId, firstName) {
  const keyboard = { inline_keyboard: [[{ text: "✅ Приєднатися", callback_data: `join_${userId}` }]] };
  await sendMessage(token, chatId,
    `👋 Ласкаво просимо, ${firstName}!\nНатисни кнопку нижче, щоб приєднатися до чату.`,
    keyboard
  );
}
