export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const update = await request.json();
      console.log("Incoming update:", JSON.stringify(update));

      // 1️⃣ Новий учасник приєднався
      if (update.message && update.message.new_chat_members) {
        for (const member of update.message.new_chat_members) {
          const chatId = update.message.chat.id;
          const userId = member.id;
          const firstName = member.first_name || "Користувач";

          // 🔒 Тимчасово блокуємо нового учасника
          await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/restrictChatMember`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              user_id: userId,
              permissions: { can_send_messages: false },
            }),
          });

          // 💬 Повідомлення з кнопкою
          const keyboard = {
            inline_keyboard: [
              [{ text: "✅ Приєднатися", callback_data: `join_${userId}` }],
            ],
          };

          const messageResp = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `👋 Ласкаво просимо, ${firstName}!\n\nНатисни кнопку нижче, щоб приєднатися до чату.\n\n⏳ Якщо не натиснеш протягом 2 хвилин — тебе буде видалено.`,
              reply_markup: keyboard,
            }),
          });

          const msgData = await messageResp.json();
          console.log("Join message:", JSON.stringify(msgData));

          // ⚠️ Плануємо видалення, якщо користувач не підтвердить
          const cleanupUrl = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/kickChatMember`;
          const cleanupData = { chat_id: chatId, user_id: userId };

          // Використовуємо Cloudflare's scheduled task через setTimeout-подібну логіку
          // (але у Worker це робиться через setTimeout у Promise)
          setTimeout(async () => {
            try {
              // Перевіряємо, чи користувач ще має обмеження (mute)
              const chatMemberResp = await fetch(
                `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getChatMember?chat_id=${chatId}&user_id=${userId}`
              );
              const chatMember = await chatMemberResp.json();

              // Якщо досі обмежений (ще не приєднався)
              if (
                chatMember.ok &&
                chatMember.result &&
                chatMember.result.status === "restricted"
              ) {
                console.log(`Removing inactive member: ${userId}`);

                // Видаляємо користувача
                await fetch(cleanupUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(cleanupData),
                });

                // Повідомлення у групі
                await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: chatId,
                    text: `❌ ${firstName} не підтвердив участь і був видалений.`,
                  }),
                });
              }
            } catch (err) {
              console.error("Cleanup error:", err);
            }
          }, 2 * 60 * 1000); // 2 хвилини
        }
      }

      // 2️⃣ Натискання кнопки "Приєднатися"
      if (update.callback_query) {
        const data = update.callback_query.data;
        const chatId = update.callback_query.message.chat.id;
        const userId = update.callback_query.from.id;
        const text = update.message.text?.trim() || "";

        if (data === `join_${userId}`) {
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
          // 🔓 Знімаємо обмеження
          await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/restrictChatMember`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              user_id: userId,
              permissions: {
                can_send_messages: true,
                can_send_media_messages: true,
                can_send_polls: true,
                can_send_other_messages: true,
                can_add_web_page_previews: true,
                can_invite_users: true,
              },
            }),
          });

          // ✅ Підтвердження
          await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callback_query_id: update.callback_query.id,
              text: "✅ Ти приєднався до чату!",
              show_alert: false,
            }),
          });

          // 🗑 Видаляємо повідомлення з кнопкою
          await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: update.callback_query.message.message_id,
            }),
          });

          // 🗨 Вітальне повідомлення
          await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `🎉 Вітаємо, ${update.callback_query.from.first_name}, тепер ти повноцінний учасник групи!`,
            }),
          });
        }
      }

      return new Response("OK", { status: 200 });
    }

    // 3️⃣ Перевірка доступу через браузер
    return new Response("Hello from Telegram Group Bot!", { status: 200 });
  },
};
