export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Hello from Worker!", { status: 200 });
    }

    const update = await request.json();
    console.log("Incoming update:", JSON.stringify(update));

    if (!update.message) return new Response("OK", { status: 200 });

    const chatId = update.message.chat.id;
    const userId = update.message.from.id;
    const text = update.message.text?.trim() || "";

    // Отримуємо дані користувача з KV
    let userData = await env.KV.get(`pending_users:${userId}`, { type: "json" }) || {};

    // --- Логіка нового користувача ---
    if (!userData.status) {
      // Користувач ще не зареєстрований
      userData = {
        status: "pending",
        chat_id: chatId
      };
      await env.KV.put(`pending_users:${userId}`, JSON.stringify(userData));

      // Відправляємо приватне повідомлення користувачу
      await sendMessage(env.TG_BOT_TOKEN, chatId, 
        "Привіт! Щоб приєднатися до групи, введи номер квартири.");
      return new Response("OK", { status: 200 });
    }

    // --- Користувач вводить номер квартири ---
    if (userData.status === "pending") {
      const apartmentNumber = text;

      // Перевіряємо кількість людей на квартиру
      const residents = await env.KV.get(`apartments:${apartmentNumber}`, { type: "json" }) || [];
      if (residents.length >= 2) {
        await sendMessage(env.TG_BOT_TOKEN, chatId, 
          "На цю квартиру вже зареєстровано максимальну кількість осіб. Зверніться до адміністратора.");
        return new Response("OK", { status: 200 });
      }

      // Зберігаємо номер квартири та змінюємо статус
      userData.status = "awaiting_admin_code";
      userData.apartment = apartmentNumber;
      await env.KV.put(`pending_users:${userId}`, JSON.stringify(userData));

      await sendMessage(env.TG_BOT_TOKEN, chatId, 
        "Введіть ваше ім'я та номер телефону у форматі: Ім'я, Телефон");
      return new Response("OK", { status: 200 });
    }

    // --- Користувач вводить ім'я та телефон ---
    if (userData.status === "awaiting_admin_code" && !userData.name) {
      const [name, phone] = text.split(",").map(s => s.trim());
      userData.name = name;
      userData.phone = phone;

      // Генеруємо 4-значний код для адміністратора
      const adminCode = Math.floor(1000 + Math.random() * 9000);
      userData.admin_code = adminCode;

      await env.KV.put(`pending_users:${userId}`, JSON.stringify(userData));

      // Надсилаємо адміністратору повідомлення
      const adminId = Number(env.ADMIN_CHAT_ID); // додайте у wrangler.toml
      await sendMessage(env.TG_BOT_TOKEN, adminId, 
        `Новий учасник:\nІм'я: ${name}\nКвартира: ${userData.apartment}\nТелефон: ${phone}\nКод підтвердження: ${adminCode}`);

      await sendMessage(env.TG_BOT_TOKEN, chatId, 
        "Ваші дані надіслані адміністратору. Введіть отриманий код підтвердження.");
      return new Response("OK", { status: 200 });
    }

    // --- Користувач вводить код підтвердження ---
    if (userData.status === "awaiting_admin_code" && userData.name) {
      const enteredCode = text;
      if (enteredCode === String(userData.admin_code)) {
        // Код вірний → підтверджуємо користувача
        userData.status = "approved";

        // Додаємо користувача у KV по квартирі
        const residents = await env.KV.get(`apartments:${userData.apartment}`, { type: "json" }) || [];
        residents.push(userId);
        await env.KV.put(`apartments:${userData.apartment}`, JSON.stringify(residents));
        await env.KV.put(`pending_users:${userId}`, JSON.stringify(userData));

        await sendMessage(env.TG_BOT_TOKEN, chatId, "✅ Ви успішно приєднані до групи!");
      } else {
        await sendMessage(env.TG_BOT_TOKEN, chatId, "❌ Невірний код. Спробуйте ще раз.");
      }
      return new Response("OK", { status: 200 });
    }

    return new Response("OK", { status: 200 });
  },
};

// --- Функція для відправки повідомлень Telegram ---
async function sendMessage(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  const data = await resp.text();
  console.log("Telegram sendMessage response:", data);
}
