export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      try {
        const update = await request.json();
        console.log("Incoming update:", JSON.stringify(update));

        if (!update.message) return new Response("No message", { status: 200 });

        const chatId = update.message.chat.id;
        const userId = update.message.from.id;
        const text = update.message.text?.trim() || "";

        const kv = env.Teligy3V;

        async function sendMessage(to, message) {
          try {
            const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
            const body = { chat_id: to, text: message };
            const resp = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const data = await resp.text();
            console.log("Telegram sendMessage response:", data);
          } catch (error) {
            console.error("Failed to send message:", error);
          }
        }

        // Кодове слово для тестування
        if (text.toLowerCase() === "тестбот") {
          await sendMessage(userId, "🚀 Починаємо повне тестування логіки бота...");

          let testApartment = "123";
          let testName = "Тестовий Користувач";
          let testPhone = "+380501234567";
          let testCode = Math.floor(1000 + Math.random() * 9000).toString();

          await kv.put(`pending:${userId}`, JSON.stringify({ status: "awaiting_apartment" }));
          await sendMessage(userId, `Тест: Чекаємо номер квартири (імітація)`);

          // Імітація введення номера квартири
          await kv.put(`pending:${userId}`, JSON.stringify({ status: "awaiting_contact", apartmentNumber: testApartment }));
          await sendMessage(userId, `Тест: Введено номер квартири: ${testApartment}`);

          // Імітація введення ім'я та телефон
          await kv.put(`pending:${userId}`, JSON.stringify({ status: "awaiting_code", apartmentNumber: testApartment, name: testName, phone: testPhone, code: testCode  }));
          await sendMessage(userId, `Тест: Введено ім'я та телефон: ${testName}, ${testPhone}`);

          // Підтвердження коду
          await kv.put(`pending:${userId}`, JSON.stringify({ status: "approved", apartmentNumber: testApartment, name: testName, phone: testPhone }));
          const apartmentKey = `apartment:${testApartment}`;
          const existing = (await kv.get(apartmentKey, "json")) || [];
          existing.push({ userId, name: testName, phone: testPhone });
          await kv.put(apartmentKey, JSON.stringify(existing));

          await sendMessage(userId, `✅ Тестування пройшло успішно! Ваш код підтвердження був '${testCode}'. Основні функції працюють.`);
          return new Response("OK", { status: 200 });
        }

        let pendingData = await kv.get(`pending:${userId}`, "json");

        if (!pendingData) {
          await kv.put(`pending:${userId}`, JSON.stringify({ status: "awaiting_apartment" }));
          await sendMessage(userId, "Привіт! Щоб приєднатися до групи, введи номер квартири:");
          return new Response("OK", { status: 200 });
        }

        if (pendingData.status === "awaiting_apartment") {
          const apartmentNumber = text;
          if (!/^\d+$/.test(apartmentNumber)) {
            await sendMessage(userId, "Будь ласка, введи коректний номер квартири (тільки цифри).");
            return new Response("OK", { status: 200 });
          }
          const existing = (await kv.get(`apartment:${apartmentNumber}`, "json")) || [];
          if (existing.length >= 2) {
            await sendMessage(userId, "На цю квартиру вже зареєстровано максимальну кількість осіб. Зверніться до адміністратора.");
            return new Response("OK", { status: 200 });
          }
          pendingData = { status: "awaiting_contact", apartmentNumber };
          await kv.put(`pending:${userId}`, JSON.stringify(pendingData));
          await sendMessage(userId, "Введи своє ім'я та номер телефону (через кому):");
          return new Response("OK", { status: 200 });
        }

        if (pendingData.status === "awaiting_contact") {
          const [name, phone] = text.split(",").map(s => s.trim());
          if (!name || !phone || !/^\+?\d{7,15}$/.test(phone)) {
            await sendMessage(userId, "Будь ласка, введи ім'я та телефон через кому, наприклад: Іван, +380501234567");
            return new Response("OK", { status: 200 });
          }

          const code = Math.floor(1000 + Math.random() * 9000).toString();

          pendingData = { status: "awaiting_code", apartmentNumber: pendingData.apartmentNumber, name, phone, code };
          await kv.put(`pending:${userId}`, JSON.stringify(pendingData));

          await sendMessage(env.ADMIN_CHAT_ID, `Новий учасник:\nІм'я: ${name}\nКвартира: ${pendingData.apartmentNumber}\nТелефон: ${phone}\nКод підтвердження: ${code}`);
          await sendMessage(userId, "Тепер введи код підтвердження, який тобі повідомив адміністратор:");
          return new Response("OK", { status: 200 });
        }

        if (pendingData.status === "awaiting_code") {
          if (text === pendingData.code) {
            pendingData.status = "approved";
            await kv.put(`pending:${userId}`, JSON.stringify(pendingData));

            const apartmentKey = `apartment:${pendingData.apartmentNumber}`;
            const existing = (await kv.get(apartmentKey, "json")) || [];
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
      } catch (error) {
        console.error("Error handling request:", error);
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    return new Response("Hello from Worker!", { status: 200 });
  },
};
