# OSBB Telegram Bot

Бот для реєстрації мешканців (квартира, ім'я, телефон).

## 🚀 Як запустити

1. Створи репозиторій на GitHub.
2. Завантаж ці файли.
3. У Settings → Secrets додай:
   - `CF_API_TOKEN` — токен Cloudflare
   - `TG_BOT_TOKEN` — токен Telegram
   - `TG_SECRET_TOKEN` — довільний секрет
4. Створи KV namespace `USERS` у Cloudflare.
5. Деплой відбудеться автоматично через GitHub Actions.
6. Налаштуй webhook:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook"   -d "url=https://osbb-bot.<your-account>.workers.dev"   -d "secret_token=<YOUR_TG_SECRET_TOKEN>"
```

✅ Готово!
Готово
