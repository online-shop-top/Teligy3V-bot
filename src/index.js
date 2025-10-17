export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const update = await request.json();
      console.log("Incoming update:", JSON.stringify(update));

      if (!update.message) return new Response("OK", { status: 200 });

      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text?.trim() || "";

      const kv = env.Teligy3V;

      // Отримуємо поточний стан користувача
      const userDataRaw = await kv.get(`user:${userId}`);
      let userData = userDataRaw ? JSON.parse(userDataRaw) : null;

      // Крок 1: Новий користувач у приватному чаті починає реєстрацію
      if (!userData) {
        userData = { status: "pending" };
        await kv.put(`user:${userId}`, JSON.stringify(userData));

        return new Response(JSON.stringify({
          text: "Привіт! Щоб приєднатися до групи, введи номер квартири."
        }), { status: 200 });
      }

      // Крок 2: Введення номера квартири
      if (userData.status === "pending") {
        const apartment = text;
        const allUsersRaw = await kv.list({ prefix: "user:" });
        let count = 0;

        // Перевіряємо скільки людей вже на цю квартиру
        for (const key of allUsersRaw.keys) {
          const u = await kv.get(key.name);
          if (u) {
            const parsed = JSON.parse(u);
            if (parsed.apartment === apartment && parsed.status === "approved") count++;
          }
        }

        if (count >= 2) {
          return new Response(JSON.stringify({
            text: "На цю квартиру вже зареєстровано максимальну кількість осіб. Зверніться до адміністратора."
          }), { status: 200 });
        }

        // Зберігаємо номер квартири та змінюємо статус
        userData.apartment = apartment;
        userData.status = "awaiting_contact";
        await kv.put(`user:${userId}`, JSON.stringify(userData));

        return new Response(JSON.stringify({
          text: "Введи своє ім'я та номер телефону у форматі: Ім'я, Телефон"
        }), { status: 200 });
      }

      // Крок 3: Введення імені та телефону
      if (userData.status === "awaiting_contact") {
        const [name, phone] = text.split(",").map(s => s.trim());
        if (!name || !phone) {
          return new Response(JSON.stringify({
            text: "Невірний формат. Введи у форматі: Ім'я, Телефон"
          }), { status: 200 });
        }

        // Генеруємо код для адміністратора
        const adminCode = Math.floor(1000 + Math.random() * 9000).toString();
        userData.name = name;
        userData.phone = phone;
        userData.adminCode = adminCode;
        userData.status = "awaiting_admin_code";

        await kv.put(`user:${userId}`, JSON.stringify(userData));

        // Надсилаємо код адміністратору
        await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: env.ADMIN_CHAT_ID,
            text: `Новий учасник:\nІм'я: ${name}\nКвартира: ${userData.apartment}\nТелефон: ${phone}\nКод підтвердження: ${adminCode}`
          })
        });

        return new Response(JSON.stringify({
          text: "Дані надіслані адміністратору. Введи код підтвердження, який тобі надіслав адміністратор."
        }), { status: 200 });
      }

      // Крок 4: Введення коду підтвердження
      if (userData.status === "awaiting_admin_code") {
        if (text === userData.adminCode) {
          userData.status = "approved";
          await kv.put(`user:${userId}`, JSON.stringify(userData));

          // Тут можна додати додавання користувача до групи через бота (якщо бот має права)
          // Для прикладу надсилаємо повідомлення користувачу
          return new Response(JSON.stringify({
            text: "✅ Ви успішно підтвердили код і приєднані до групи!"
          }), { status: 200 });
        } else {
          return new Response(JSON.stringify({
            text: "Невірний код. Спробуйте ще раз."
          }), { status: 200 });
        }
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Hello from Worker!", { status: 200 });
  },
};
