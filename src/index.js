export default {
  async fetch(request, env) {
    // Обробка OPTIONS запиту для CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // Обробка scheduled (cron) події
    if (request.headers.get("CF-Worker-Cron") === "true") {
      await removeInactiveUsers(env);
      return new Response("Cron job completed");
    }

    // Перевірка методу
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let update;
    try {
      update = await request.json(); // Обробка JSON з запиту
    } catch (err) {
      console.error("Error parsing JSON:", err);
      return new Response("Invalid JSON", { status: 400 });
    }

    // Функція для відправки повідомлення через Telegram API
    async function sendMessage(chatId, text, reply_markup = null) {
      const body = { chat_id: chatId, text };
      if (reply_markup) body.reply_markup = reply_markup;

      try {
        const resp = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          throw new Error(`Telegram API error: ${resp.statusText}`);
        }
        const data = await resp.json();
        console.log("Telegram sendMessage response:", data);
      } catch (err) {
        console.error("Error sending message to Telegram:", err);
      }
    }

    const userId = update.message?.from?.id || update.callback_query?.from?.id || update.chat_member?.new_chat_member?.user?.id;
    if (!userId) return new Response("OK");

    // Оновлення часу останньої активності користувача
    await updateUserLastActive(env, userId);

    // Отримання стану користувача
    let userState = await getUserState(env, userId);
    if (!userState) {
      console.log(`No state found for user: ${userId}`);
    }

    // Основна логіка для обробки повідомлень і callback'ів
    if (update.message?.text === "/start") {
      const firstName = update.message.from.first_name || "користувач";
      await sendMessage(
        userId,
        `👋 Привіт, ${firstName}!\nНатисни кнопку нижче, щоб подати заявку на приєднання до групи.`,
        { inline_keyboard: [[{ text: "ПРИЄДНАТИСЬ", callback_data: "join_request" }]] }
      );
      await setUserState(env, userId, "awaiting_join");
      return new Response("OK");
    }

    // Обробка callback запитів
    if (update.callback_query?.data === "join_request") {
      await sendMessage(userId, `ПРАВИЛА ЧАТУ ...`, {
        inline_keyboard: [[{ text: "ПОГОДЖУЮСЬ", callback_data: "rules_accept" }]],
      });
      await setUserState(env, userId, "awaiting_rules_accept");
      return new Response("OK");
    }

    if (update.callback_query?.data === "rules_accept") {
      await sendMessage(userId, "Дякуємо! Тепер введіть номер квартири.");
      await setUserState(env, userId, "awaiting_apartment");
      return new Response("OK");
    }

    // Обробка введення номера квартири
    if (userState?.step === "awaiting_apartment" && update.message?.text) {
      const aptNum = parseInt(update.message.text.trim(), 10);
      if (isNaN(aptNum) || aptNum < 1 || aptNum > 120) {
        await sendMessage(userId, "Такого номеру квартири не існує. Спробуйте ще раз.");
      } else {
        let registered = (await env.Teligy3V.get(`apt:${aptNum}`, { type: "json" })) || [];
        if (registered.length >= 2) {
          await sendMessage(userId, "На цю квартиру вже зареєстровано максимум.");
          await clearUserState(env, userId);
        } else {
          await setUserState(env, userId, "awaiting_details", { apartment: aptNum });
          await sendMessage(userId, "Введіть, будь ласка, ім'я та телефон через кому.");
        }
      }
      return new Response("OK");
    }

    // Обробка введення ім'я та телефону
    if (userState?.step === "awaiting_details" && update.message?.text) {
      const parts = update.message.text.trim().split(",").map(s => s.trim());
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        await sendMessage(userId, "Будь ласка, введіть ім'я і телефон через кому.");
        return new Response("OK");
      }
      const [name, phone] = parts;
      const aptNum = userState.apartment;
      let registered = (await env.Teligy3V.get(`apt:${aptNum}`, { type: "json" })) || [];
      if (!registered.find(u => u.userId === userId)) {
        registered.push({ userId, name, phone });
        await env.Teligy3V.put(`apt:${aptNum}`, JSON.stringify(registered));
      }
      const code = Math.floor(1000 + Math.random() * 9000).toString();
      await env.Teligy3V.put(`code:${userId}`, code);
      await setUserState(env, userId, "awaiting_code");
      await sendMessage(userId, `Код підтвердження надіслано адміністратору.`);
      return new Response("OK");
    }

    // Обробка введення коду підтвердження
    if (userState?.step === "awaiting_code" && update.message?.text) {
      const inputCode = update.message.text.trim();
      const savedCode = await env.Teligy3V.get(`code:${userId}`);
      if (inputCode === savedCode) {
        await sendMessage(userId, `Код вірний! Ось посилання для групи: https://t.me/+6_OJtJfRHSZjZjQy`);
        await setUserState(env, userId, "registered");
        await clearUserState(env, userId);
      } else {
        await sendMessage(userId, `Невірний код. Спробуйте ще раз.`);
      }
      return new Response("OK");
    }

    return new Response("OK");
  },
};

// Функції для оновлення, збереження та очищення стану користувача
async function setUserState(env, userId, step, additionalState = {}) {
  const state = { step, ...additionalState };
  await env.Teligy3V.put(`state:${userId}`, JSON.stringify(state));
}

async function getUserState(env, userId) {
  let userStateRaw = await env.Teligy3V.get(`state:${userId}`);
  let userState = null;
  try {
    userState = userStateRaw ? JSON.parse(userStateRaw) : null;
  } catch {
    userState = null;
  }
  return userState;
}

async function clearUserState(env, userId) {
  await env.Teligy3V.delete(`state:${userId}`);
  await env.Teligy3V.delete(`joined_at:${userId}`);
  await env.Teligy3V.delete(`code:${userId}`);
}

// Оновлення часу останньої активності користувача
async function updateUserLastActive(env, userId) {
  await env.Teligy3V.put(`last_active:${userId}`, Date.now().toString());
}

// Функція для видалення "незареєстрованих" користувачів
async function removeInactiveUsers(env) {
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
    if (joinedAt < cutoff && (state.step === "not_registered" || !["awaiting_code", "registered"].includes(state.step))) {
      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/banChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.GROUP_CHAT_ID, user_id: Number(userId) }),
      });
      await env.Teligy3V.delete(`joined_at:${userId}`);
      await env.Teligy3V.delete(`state:${userId}`);
      await env.Teligy3V.delete(`code:${userId}`);
    }
  }
}
