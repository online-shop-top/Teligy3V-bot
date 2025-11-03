// src/index.js

import { someFunction } from './myModule.js';  // Імпортуємо функцію з myModule.js

export default {
  async fetch(req, env) {
    // Викликаємо функцію з myModule.js
    const message = someFunction();

    // Повертаємо відповідь
    return new Response(message, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  },
};
