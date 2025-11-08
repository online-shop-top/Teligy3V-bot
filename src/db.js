// src/db.js
export async function getUser(env, userId) {
  // 1) Пробуємо отримати з D1
  const row = await env.DB.prepare(
    "SELECT tg_id, full_name, apartment, phone, is_admin, state FROM users WHERE tg_id = ?"
  ).bind(userId.toString()).first();

  if (row) {
    return {
      userId: row.tg_id,
      name: row.full_name,
      apartment: row.apartment,
      phone: row.phone,
      isAdmin: row.is_admin === 1,
      state: row.state ? JSON.parse(row.state) : null
    };
  }

  // 2) Якщо в D1 немає — шукаємо в KV
  const kvState = await env.Teligy3V.get(`state:${userId}`);
  if (!kvState) return null;

  // 3) Lazy-migration: переносимо у D1
  const state = JSON.parse(kvState);
  const apartment = state.apartment || null;
  const name = state.name || null;
  const phone = state.phone || null;

  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (tg_id, full_name, apartment, phone, state) VALUES (?, ?, ?, ?, ?)"
  ).bind(
    userId.toString(),
    name,
    apartment,
    phone,
    JSON.stringify(state)
  ).run();

  return { userId, name, apartment, phone, state };
}

export async function saveState(env, userId, state) {
  await env.DB.prepare(
    "UPDATE users SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE tg_id = ?"
  ).bind(JSON.stringify(state), userId.toString()).run();

  // fallback для старих користувачів (на перехідний період)
  await env.Teligy3V.put(`state:${userId}`, JSON.stringify(state));
}

export async function registerUser(env, userId, name, phone, apartment) {
  await env.DB.prepare(
    `INSERT INTO users (tg_id, full_name, apartment, phone, state) 
     VALUES (?, ?, ?, ?, ?) 
     ON CONFLICT(tg_id) DO UPDATE SET 
       full_name = excluded.full_name,
       apartment = excluded.apartment,
       phone = excluded.phone,
       state = excluded.state,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    userId.toString(),
    name,
    apartment,
    phone,
    JSON.stringify({ step: "registered" })
  ).run();

  await env.Teligy3V.delete(`state:${userId}`);
  await env.Teligy3V.delete(`code:${userId}`);
  await env.Teligy3V.delete(`joined_at:${userId}`);
}
