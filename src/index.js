export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const update = await request.json();
      console.log("Incoming update:", JSON.stringify(update));

      if (update.message.text === "/start") {
        const chatId = update.message.chat.id;
        const body = { chat_id: chatId, text: "Привіт! Введіть номер квартири (1–120):" };

        await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Hello from Worker!", { status: 200 });
  },
};
