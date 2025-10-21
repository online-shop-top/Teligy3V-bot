export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      try {
        const update = await request.json();
        console.log("Incoming update:", JSON.stringify(update));

        if (update.message) {
          const chatId = update.message.chat.id;
          const text = update.message.text || "";

          let reply = "✅ Бот отримав: " + text;

          // Простий приклад команд
          if (text === "/start") {
            reply = "Привіт! 👋 Я Cloudflare Worker Bot 🚀";
          } else if (text === "/help") {
            reply = "Доступні команди:\n/start — привітання\n/help — допомога";
          }

          const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
          const body = { chat_id: chatId, text: reply };

          const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (!resp.ok) {
            console.error("Telegram API error:", await resp.text());
          }
        }

        return new Response("OK", { status: 200 });
      } catch (err) {
        console.error("Error:", err);
        return new Response("Error processing request", { status: 500 });
      }
    }

    return new Response("Hello from Worker!", { status: 200 });
  },
};
