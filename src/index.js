export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK", { status: 200 });

    const update = await request.json();
    const BOT_TOKEN = env.TG_BOT_TOKEN;
    const ADMIN_ID = 2102040810; // Alex R.
    const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
    const KV = env.Teligy3V;

    console.log("Incoming update:", JSON.stringify(update));

    // 🧩 1️⃣ Новий учасник у групі
    if (update.message?.new_chat_member) {
      const chatId = update.message.chat.id;
      const user = update.message.new_chat_member;
      const userId = user.id;
      const firstName = user.first_name || "Користувач";

      // Тимчасово обмежуємо нового учасника
      await fetch(`${BASE_URL}/restrictChatMember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          user_id: userId,
          permissions: {
            can_send_messages: false,
            can_send_media_messages: false,
            can_send_polls: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false
          }
        }),
      });

      // Зберігаємо стан у KV
      await KV.put(`user:${userId}`, JSON.stringify({
        status: "pending",
        chatId,
        firstName,
        step: "await_join",
      }));

      // Надсилаємо кнопку "ПРИЄДНАТИСЬ"
      await fetch(`${BASE_URL}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `👋 Привіт, ${firstName}!\nЩоб приєднатися до групи, натисни кнопку нижче.`,
          reply_markup: {
            inline_keyboard: [[{ text: "✅ ПРИЄДНАТИСЬ", callback_data: `join_${userId}` }]]
          }
        }),
      });
      return new Response("OK", { status: 200 });
    }

    // 🧩 2️⃣ Натискання кнопки "ПРИЄДНАТИСЬ"
    if (update.callback_query) {
      const cb = update.callback_query;
      const userId = cb.from.id;
      const data = cb.data;

      if (data.startsWith("join_")) {
        await KV.put(`user:${userId}`, JSON.stringify({ status: "collecting", step: "ask_flat" }));

        // Повідомлення у приватний чат
        await fetch(`${BASE_URL}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: userId,
            text: `Привіт! 👋\nВведи, будь ласка, номер своєї квартири.`,
          }),
        });

        await fetch(`${BASE_URL}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: cb.id,
            text: "Бот надіслав вам повідомлення у приватний чат 📨",
            show_alert: false
          }),
        });
      }
      return new Response("OK", { status: 200 });
    }

    // 🧩 3️⃣ Приватні повідомлення користувача
    if (update.message && update.message.chat.type === "private") {
      const userId = update.message.from.id;
      const text = update.message.text.trim();
      const userDataRaw = await KV.get(`user:${userId}`);
      let userData = userDataRaw ? JSON.parse(userDataRaw) : null;

      if (!userData) {
        await fetch(`${BASE_URL}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: userId,
            text: "Ви ще не почали процес приєднання. Перейдіть у групу та натисніть кнопку 'ПРИЄДНАТИСЬ'.",
          }),
        });
        return new Response("OK", { status: 200 });
      }

      // 🏠 Крок 1: Користувач вводить номер квартири
      if (userData.step === "ask_flat") {
        const flat = text;
        const flatUsersRaw = await KV.get(`flat:${flat}`);
        const flatUsers = flatUsersRaw ? JSON.parse(flatUsersRaw) : [];

        if (flatUsers.length >= 2) {
          await fetch(`${BASE_URL}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: userId,
              text: "🚫 На цю квартиру вже зареєстровано максимальну кількість осіб. Зверніться до адміністратора.",
            }),
          });
          return new Response("OK", { status: 200 });
        }

        userData.flat = flat;
        userData.step = "ask_name";
        await KV.put(`user:${userId}`, JSON.stringify(userData));

        await fetch(`${BASE_URL}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: userId,
            text: "Вкажіть своє ім’я:",
          }),
        });
        return new Response("OK", { status: 200 });
      }

      // 👤 Крок 2: Ім’я
      if (userData.step === "ask_name") {
        userData.name = text;
        userData.step = "ask_phone";
        await KV.put(`user:${userId}`, JSON.stringify(userData));

        await fetch(`${BASE_URL}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: userId,
            text: "Вкажіть ваш номер телефону:",
          }),
        });
        return new Response("OK", { status: 200 });
      }

      // 📞 Крок 3: Телефон
      if (userData.step === "ask_phone") {
        userData.phone = text;
        userData.status = "awaiting_code";
        const code = Math.floor(1000 + Math.random() * 9000);
        userData.code = code;
        await KV.put(`user:${userId}`, JSON.stringify(userData));

        // надсилаємо адміну
        await fetch(`${BASE_URL}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: ADMIN_ID,
            text: `🆕 Нова заявка:\n👤 ${userData.name}\n🏠 Квартира: ${userData.flat}\n📞 ${userData.phone}\n🆔 ${userId}\nКод підтвердження: ${code}`,
          }),
        });

        await fetch(`${BASE_URL}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: userId,
            text: "Ваші дані відправлено адміністратору. Коли він скаже вам код, введіть його тут:",
          }),
        });
        return new Response("OK", { status: 200 });
      }

      // ✅ Крок 4: Підтвердження коду
      if (userData.step === "awaiting_code") {
        if (text === String(userData.code)) {
          userData.status = "approved";
          await KV.put(`user:${userId}`, JSON.stringify(userData));

          // додаємо користувача до списку квартири
          const flatUsersRaw = await KV.get(`flat:${userData.flat}`);
          const flatUsers = flatUsersRaw ? JSON.parse(flatUsersRaw) : [];
          flatUsers.push({ userId, name: userData.name });
          await KV.put(`flat:${userData.flat}`, JSON.stringify(flatUsers));

          // повідомлення користувачу
          await fetch(`${BASE_URL}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: userId,
              text: "✅ Код підтверджено! Ви приєднані до групи.",
            }),
          });

          // розблоковуємо учасника у групі
          await fetch(`${BASE_URL}/restrictChatMember`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: userData.chatId,
              user_id: userId,
              permissions: {
                can_send_messages: true,
                can_send_media_messages: true,
                can_send_polls: true,
                can_send_other_messages: true,
                can_add_web_page_previews: true
              }
            }),
          });
        } else {
          await fetch(`${BASE_URL}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: userId,
              text: "❌ Невірний код. Спробуйте ще раз.",
            }),
          });
        }
        return new Response("OK", { status: 200 });
      }
    }

    return new Response("OK", { status: 200 });
  },
};
