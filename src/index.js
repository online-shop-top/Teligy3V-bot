export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      try {
        const update = await request.json();
        console.log("Incoming:", JSON.stringify(update).slice(0, 500));

        const kv = env.Teligy3V;

        // === Хелпер: надсилання повідомлень ===
        async function sendMessage(to, text, extra = {}) {
          const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
          const body = { chat_id: to, text, ...extra };
          const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await resp.text();
          console.log("Telegram resp:", data.slice(0, 200));
        }

        // === Хелпер: зберегти заявку з терміном дії ===
        async function savePending(userId, data) {
          // додаємо timestamp для автоочищення
          data.timestamp = Date.now();
          await kv.put(`pending:${userId}`, JSON.stringify(data));
        }

        // === Хелпер: перевірка терміну дії заявки ===
        async function isExpired(pending) {
          const EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 години
          return Date.now() - (pending.timestamp || 0) > EXPIRATION_MS;
        }

        // === Початок приєднання (/start join) ===
        if (update.message?.text === "/start join") {
          const chatId = update.message.chat.id;
          const userId = update.message.from.id;

          await kv.delete(`pending:${userId}`);

          const joinButton = {
            reply_markup: {
              inline_keyboard: [[{ text: "🔑 Приєднатися до групи", callback_data: "start_join_process" }]],
            },
          };

          await sendMessage(chatId, "Вітаємо! Натисніть кнопку нижче, щоб подати заявку на приєднання 👇", joinButton);
          return new Response("OK", { status: 200 });
        }

        // === Якщо натиснули кнопку “Приєднатися” ===
        if (update.callback_query?.data === "start_join_process") {
          const userId = update.callback_query.from.id;
          const chatId = userId;

          await savePending(userId, { status: "awaiting_apartment" });
          await sendMessage(chatId, "Введіть номер квартири:");
          return new Response("OK", { status: 200 });
        }

        // === Обробка звичайних повідомлень ===
        if (update.message) {
          const msg = update.message;
          const chatId = msg.chat.id;
          const userId = msg.from.id;
          const text = msg.text?.trim() || "";

          let pendingRaw = await kv.get(`pending:${userId}`);
          if (!pendingRaw) {
            await sendMessage(chatId, "Для початку натисніть /start join");
            return new Response("OK", { status: 200 });
          }

          let pending = JSON.parse(pendingRaw);

          // Якщо заявка прострочена — видаляємо
          if (await isExpired(pending)) {
            await kv.delete(`pending:${userId}`);
            await sendMessage(chatId, "⏰ Термін дії вашої заявки минув. Почніть заново командою /start join.");
            return new Response("OK", { status: 200 });
          }

          // 1️⃣ Очікуємо номер квартири
          if (pending.status === "awaiting_apartment") {
            pending.apartment = text;
            pending.status = "awaiting_contact";
            await savePending(userId, pending);
            await sendMessage(chatId, "Введіть ваше ім’я та номер телефону (через кому):");
            return new Response("OK", { status: 200 });
          }

          // 2️⃣ Очікуємо ім’я та телефон
          if (pending.status === "awaiting_contact") {
            const [name, phone] = text.split(",").map((s) => s.trim());
            if (!name || !phone) {
              await sendMessage(chatId, "Будь ласка, введіть ім’я та телефон через кому, наприклад:\nІван, 0501234567");
              return new Response("OK", { status: 200 });
            }

            const code = Math.floor(1000 + Math.random() * 9000).toString();
            pending.name = name;
            pending.phone = phone;
            pending.code = code;
            pending.status = "awaiting_code";
            await savePending(userId, pending);

            await sendMessage(
              env.ADMIN_CHAT_ID,
              `🏠 Нова заявка на приєднання:\nІм’я: ${name}\nТелефон: ${phone}\nКварт
