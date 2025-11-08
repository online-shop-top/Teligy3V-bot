// db.js
export async function saveState(env, tg_id, stateObj) {
  const key = `state:${tg_id}`;
  await env.Teligy3V.put(key, JSON.stringify(stateObj));
}

export async function getUser(env, tg_id) {
  // Повертає об’єкт стану або null, якщо немає
  const raw = await env.Teligy3V.get(`state:${tg_id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------- REGISTER USER ------------------------

export async function registerUser(env, tg_id, full_name, phone, apartment) {
  try {
    // 1️⃣ Перевіряємо, чи такий користувач вже є
    const existing = await env.DB
      .prepare("SELECT id FROM users WHERE tg_id = ?")
      .bind(tg_id)
      .first();

    if (existing) {
      console.log(`ℹ️ Користувач ${tg_id} вже існує, пропускаємо.`);
      return existing.id;
    }

    // 2️⃣ Створюємо запис
    const created_at = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO users (tg_id, full_name, phone, apartment, state, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .bind(tg_id, full_name, phone, apartment, "registered", created_at)
      .run();

    console.log(`✅ Новий користувач ${full_name} (кв. ${apartment}) доданий.`);
    return true;

  } catch (e) {
    console.error("❌ Помилка при реєстрації користувача:", e);
    return false;
  }
}
