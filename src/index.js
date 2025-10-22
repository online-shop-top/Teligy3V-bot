export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const update = await request.json();
      console.log("Incoming update:", JSON.stringify(update));

      if (update.message) {
        const chatId = update.message.chat.id;
        const text = (update.message.text || "").trim();

        // Отримуємо попередній стан користувача з KV
        const stateKey = `state_${chatId}`;
        const state = await env.Teligy3V.get(stateKey, { type: "json" }) || {};

        let reply = "";

        // 1️⃣ Якщо користувач вводить номер квартири
        if (!state.step && !isNaN(parseInt(text)) && parseInt(text) >= 1 && parseInt(text) <= 120) {
          state.apartment = parseInt(text);
          state.step = "waiting_name";
          reply = `🏠 Ви вказали квартиру №${state.apartment}.\nВведіть ім’я мешканця:`;
        }

        // 2️⃣ Якщо користувач вводить ім’я
        else if (state.step === "waiting_name") {
          state.name = text;
          state.step = "waiting_phone";
          reply = `📞 Дякую, ${state.name}!\nТепер введіть номер телефону:`;
        }

        // 3️⃣ Якщо користувач вводить номер телефону
        else if (state.step === "waiting_phone") {
          state.phone = text;
          state.step = "done";

          // Зберігаємо дані в KV
          const apartmentKey = `apartment_${state.apartment}`;
          await env.Teligy3V.put(apartmentKey, JSON.stringify({
            apartment: state.apartment,
            name: state.name,
            phone: state.phone,
            chatId: chatId,
            timestamp: Date.now()
          }));

          reply = `✅ Дані збережено!\n\n🏠 Квартира №${state.apartment}\n👤 ${state.name}\n📞 ${state.phone}`;

          // Видаляємо тимчасовий стан
          await env.Teligy3V.delete(stateKey);
        }

        // 4️⃣ Якщо нічого не співпало — пояснення
        else {
          reply = `🤖 Введіть номер квартири (1–120), щоб розпочати.`;
        }

        // Оновлюємо стан користувача (якщо ще не закінчив)
        if (state.step && state.step !== "done") {
          await env.Teligy3V.put(stateKey, JSON.stringify(state));
        }

        // Відправка відповіді користувачу
        const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
        const body = { chat_id: chatId, text: reply };

        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      return new Response("OK", { status: 200 });
    }

    // 5️⃣ Опціонально: отримання списку квартир GET-запитом (для перевірки)
    if (request.method === "GET") {
      const list = await env.Teligy3V.list();
      const result = [];

      for (const key of list.keys) {
        if (key.name.startsWith("apartment_")) {
          const value = await env.Teligy3V.get(key.name, { type: "json" });
          result.push(value);
        }
      }

      return new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Hello from Worker!", { status: 200 });
  },
};
