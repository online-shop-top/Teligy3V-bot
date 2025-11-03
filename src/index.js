// src/index.js

// Імпортуємо необхідні функції та бібліотеки
import { someFunction } from './myModule.js';

// Функція, яка буде обробляти запити до Worker
export default {
  async fetch(req, env) {
    // Ваш основний код тут, наприклад:
    // Якщо це GET-запит на головну сторінку, повертаємо відповідь.
    if (req.method === 'GET') {
      return new Response('Hello from Teligy3V Bot!', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
        },
      });
    }

    // Обробка D1 бази даних або інших запитів
    const databaseResponse = await env.my_database.get('some_key');
    if (databaseResponse) {
      return new Response(`Database Response: ${databaseResponse}`, {
        status: 200,
      });
    }

    // Якщо запит не підтримується
    return new Response('Unsupported method or resource', {
      status: 405, // Method Not Allowed
    });
  },
};
