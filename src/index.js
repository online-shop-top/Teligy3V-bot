export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const update = await request.json();
      console.log("Incoming update:", JSON.stringify(update));

      if (!update.message) return new Response("No message", { status: 200 });

      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text?.trim() || "";

      const kv = env.Teligy3V;

      // Helper для надсилання повідомлень
      async function sendMessage(to, message) {
        const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
        const body = { chat_id: to, text: message };
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await resp.text();
        console.log("Telegram sendMessage response:", data);
      }

      // Отримуємо стан користувача
      let pendingData = await kv.get(`pending:${userId}`, "json");

      // 1️⃣ Новий користувач без даних
      if (!pendingData) {
        // Додаємо користувача у pending
        await kv.put(`pending:${userId}`, JSON.stringify({ status: "awaiting_apartment" }));
        await sendMessage(userId, "Привіт! Щоб приєднатися до групи, введи номер квартири:");
        return new Response("OK", { status: 200 });
      }

      // 2️⃣ Очікуємо номер квартири
      if (pendingData.status === "awaiting_apartment") {
        const apartmentNumber = text;
        // Перевіряємо кількість зареєстрованих на цю квартиру
        const existing = await kv.get(`apartment:${apartmentNumber}`, "json") || [];
        if (existing.length >= 2) {
          await sendMessage(userId, "На цю квартиру вже зареєстровано максимальну кількість осіб. Зверніться до адміністратора.");
          return new Response("OK", { status: 200 });
        }
        pendingData = { status: "awaiting_contact", apartmentNumber };
        await kv.put(`pending:${userId}`, JSON.stringify(pendingData));
        await sendMessage(userId, "Введи своє ім'я та номер телефону (через кому):");
        return new Response("OK", { status: 200 });
      }

      // 3️⃣ Очікуємо ім'я та телефон
      if (pendingData.status === "awaiting_contact") {
        const [name, phone] = text.split(",").map(s => s.trim());
        if (!name || !phone) {
          await sendMessage(userId, "Будь ласка, введи ім'я та телефон через кому, наприклад: Іван, 0501234567");
          return new Response("OK", { status: 200 });
        }

        // Генеруємо 4-значний код
        const code = Math.floor(1000 + Math.random() * 9000).toString();

        pendingData = { status: "awaiting_code", apartmentNumber: pendingData.apartmentNumber, name, phone, code };
        await kv.put(`pending:${userId}`, JSON.stringify(pendingData));

        // Надсилаємо код тобі (адміністратору)
        await sendMessage(env.ADMIN_CHAT_ID, `Новий учасник:\nІм'я: ${name}\nКвартира: ${pendingData.apartmentNumber}\nТелефон: ${phone}\nКод підтвердження: ${code}`);
        await sendMessage(userId, "Тепер введи код підтвердження, який тобі повідомив адміністратор:");
        return new Response("OK", { status: 200 });
      }

      // 4️⃣ Очікуємо код підтвердження
      if (pendingData.status === "awaiting_code") {
        if (text === pendingData.code) {
          // Змінюємо статус на approved
          pendingData.status = "approved";
          await kv.put(`pending:${userId}`, JSON.stringify(pendingData));

          // Додаємо користувача до квартири
          const apartmentKey = `apartment:${pendingData.apartmentNumber}`;
          const existing = await kv.get(apartmentKey, "json") || [];
          existing.push({ userId, name: pendingData.name, phone: pendingData.phone });
          await kv.put(apartmentKey, JSON.stringify(existing));

          await sendMessage(userId, "✅ Ви успішно приєднані до групи!");
          return new Response("OK", { status: 200 });
        } else {
          await sendMessage(userId, "❌ Невірний код. Спробуйте ще раз.");
          return new Response("OK", { status: 200 });
        }
      }

      return new Response("OK", { status: 200 });
    }

    // Для GET запитів
    return new Response("Hello from Worker!", { status: 200 });
  },
};
