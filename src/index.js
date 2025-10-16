// ======= TEST BOT TOKEN =======
async function testBotToken(env) {
  const chatId = 2102040810; // твій Telegram ID
  const text = "Тестове повідомлення від Worker";

  try {
    const resp = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    const data = await resp.json();
    console.log("Test sendMessage response:", data);
  } catch (err) {
    console.error("Error testing TG_BOT_TOKEN:", err);
  }
}

// ==============================
export default {
  async fetch(request, env) {
    await testBotToken(env);  // ← тест
    return new Response("Check logs for test message", { status: 200 });
  },
};


export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    const update = await request.json();
    console.log("Incoming update:", JSON.stringify(update));

    const message = update.message;
    if (!message || !message.chat || !message.text) {
      console.log("No valid message found");
      return new Response("No message", { status: 200 });
    }

    // Переконаємось, що chatId — число
    const chatId = Number(message.chat.id);
    if (isNaN(chatId)) {
      console.log("Invalid chatId:", message.chat.id);
      return new Response("Invalid chat id", { status: 200 });
    }

    const text = message.text.trim();

    // Ключ користувача у KV
    const userKey = `user_${chatId}`;
    let userState = await env.Teligy3V.get(userKey, { type: "json" }) || {};

    // Логіка запитів
    if (!userState.step) {
      userState.step = "flat";
      await env.Teligy3V.put(userKey, JSON.stringify(userState));
      await sendMessage(env, chatId, "Вітаю! Введіть номер вашої квартири (1–120):");
    } 
    else if (userState.step === "flat") {
      const flat = parseInt(text);
      if (isNaN(flat) || flat < 1 || flat > 120) {
        await sendMessage(env, chatId, "❌ Невірний номер квартири. Введіть число від 1 до 120:");
      } else {
        userState.flat = flat;
        userState.step = "name";
        await env.Teligy3V.put(userKey, JSON.stringify(userState));
        await sendMessage(env, chatId, "Добре! Тепер введіть ваше ім’я:");
      }
    } 
    else if (userState.step === "name") {
      userState.name = text;
      userState.step = "phone";
      await env.Teligy3V.put(userKey, JSON.stringify(userState));
      await sendMessage(env, chatId, "Дякую! Введіть ваш номер телефону:");
    } 
    else if (userState.step === "phone") {
      userState.phone = text;
      userState.step = "done";
      await env.Teligy3V.put(userKey, JSON.stringify(userState));
      await sendMessage(env, chatId, `✅ Дякуємо, ${userState.name}! Ваші дані збережено.`);
    }

    return new Response("OK", { status: 200 });
  },
};

// Функція відправки повідомлення у Telegram з логом відповіді
async function sendMessage(env, chatId, text) {
  const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    console.log("Telegram sendMessage response:", data);
  } catch (err) {
    console.error("Error sending message to Telegram:", err);
  }
}

