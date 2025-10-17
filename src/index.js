export default {
  async fetch(request, env) {
    // 🔍 Перевіряємо, що секрети передаються
    if (!env.TG_BOT_TOKEN) {
      console.log("⚠️ TG_BOT_TOKEN is MISSING");
    } else {
      console.log("✅ TG_BOT_TOKEN is PRESENT");
    }

    if (!env.TG_SECRET_TOKEN) {
      console.log("⚠️ TG_SECRET_TOKEN is MISSING");
    } else {
      console.log("✅ TG_SECRET_TOKEN is PRESENT");
    }

    // --- далі твій основний код ---
    if (request.method === "POST") {
      const update = await request.json();
      console.log("Incoming update:", JSON.stringify(update));

      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text || "";

        const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
        const body = { chat_id: chatId, text: "✅ Бот отримав: " + text };

        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await resp.text();
        console.log("Telegram sendMessage response:", data);
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Hello from Worker!", { status: 200 });
  },
};
