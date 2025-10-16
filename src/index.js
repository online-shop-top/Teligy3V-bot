export default {
  async fetch(request, env) {
    try {
      const body = await request.json(); // отримуємо дані від Telegram
      const chatId = body.message?.chat?.id;
      const text = body.message?.text;

      if (chatId && text) {
        // надсилаємо відповідь через Telegram API
        await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "Привіт! Я працюю ✅"
          })
        });
      }

      return new Response("OK", { status: 200 });
    } catch (err) {
      return new Response("Error", { status: 500 });
    }
  }
};
