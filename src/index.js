export default {
  async fetch(request, env) {
    // Обробляємо лише POST-запити від Telegram
    if (request.method === "POST") {
      try {
        const update = await request.json();
        console.log("Incoming update:", JSON.stringify(update).slice(0, 500));

        if (!update.message) return new Response("No message", { status: 200 });

        const chat = update.message.chat;
        const user = update.message.from;
        const chatId = chat.id;
        const userId = user.id;
        const text = update.message.text?.trim() || "";

        const kv = env.Teligy3V;

        // 🧩 Хелпер для відправки повідомлень
        async function sendMessage(to, message) {
          const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
          const body = { chat_id: to, text: message };
          const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await resp.text();
          console.log("Telegram response:", data.slice(0, 300));
        }

        // 🚫 Якщо не текстове повідомлення
        if (!text) {
          await sendMessage(chatId, "Будь ласка, надішли текстове повідомлення.");
          return new Response("OK", { status: 200 });
        }

        // 🔹 Отримуємо збережені дані користувача
        let pendingData = await kv.get(`pending:${userId}`);
        if (pendingData) pendingData = JSON.parse(pendingData);

        // 1️⃣ Новий користувач
        if (!pendingData) {
          await kv.put(`pending:${userId}`, JSON.stringify({ status: "awaiting_apartment" }));
          await sendMessage(chatId, "Привіт! Щоб приєднатися до групи, введи номер квартири:");
          return new Response("OK", { status: 200 });
        }

        // 2️⃣ Очікуємо номер квартири
        if (pendingData.status === "awaiting_apartment") {
          const apartmentNumber = text;
          const existingRaw = await kv.get(`apartment:${apartmentNumber}`);
          const existing = existingRaw ? JSON.parse(existingRaw) : [];

          if (existing.length >= 2) {
            await sendMessage(chatId, "На цю квартиру вже зареєстровано максимальну кількість осіб. Зверніться до адміністратора.");
            return new Response("OK", { status: 200 });
          }

          pendingData = { status: "awaiting_contact", apartmentNumber };
          await kv.put(`pending:${userId}`, JSON.stringify(pendingData));
          await sendMessage(chatId, "Введи своє ім'я та номер телефону (через кому):");
          return new Response("OK", { status: 200 });
        }

        // 3️⃣ Очікуємо ім’я та телефон
        if (pendingData.status === "awaiting_contact") {
          const [name, phone] = text.split(",").map(s => s.trim());
          if (!name || !phone) {
            await sendMessage(chatId, "Будь ласка, введи ім’я та телефон через кому, наприклад: Іван, 0501234567");
            return new Response("OK", { status: 200 });
          }

          const code = Math.floor(1000 + Math.random() * 9000).toString();
          pendingData = { status: "awaiting_code", apartmentNumber: pendingData.apartmentNumber, name, phone, code };
          await kv.put(`pending:${userId}`, JSON.stringify(pendingData));

          await sendMessage(env.ADMIN_CHAT_ID, 
            `🏠 Новий учасник:\nІм’я: ${name}\nКвартира: ${pendingData.apartmentNumber}\nТелефон: ${phone}\nКод підтвердження: ${code}`
          );
          await sendMessage(chatId, "Тепер введи код підтвердження, який тобі повідомив адміністратор:");
          return new Response("OK", { status: 200 });
        }

        // 4️⃣ Очікуємо код підтвердження
        if (pendingData.status === "awaiting_code") {
          if (text === pendingData.code) {
            pendingData.status = "approved";
            await kv.put(`pending:${userId}`, JSON.stringify(pendingData));

            const apartmentKey = `apartment:${pendingData.apartmentNumber}`;
            const existingRaw = await kv.get(apartmentKey);
            const existing = existingRaw ? JSON.parse(existingRaw) : [];

            existing.push({ userId, name: pendingData.name, phone: pendingData.phone });
            await kv.put(apartmentKey, JSON.stringify(existing));

            await sendMessage(chatId, "✅ Ви успішно приєднані до групи!");
            return new Response("OK", { status: 200 });
          } else {
            await sendMessage(chatId, "❌ Невірний код. Спробуйте ще раз.");
            return new Response("OK", { status: 200 });
          }
        }

        return new Response("OK", { status: 200 });
      } catch (err) {
        console.error("❌ Error:", err);
        return new Response("Internal error", { status: 500 });
      }
    }

    // Для GET-запитів (наприклад, перевірка стану)
    return new Response("Hello from Worker!", { status: 200 });
  },
};
