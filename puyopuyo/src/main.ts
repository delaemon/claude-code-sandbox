/**
 * Placeholder Vite entry point. The game loop, input handling and rendering
 * are deliberately not implemented yet (see docs/worklog/core.md); this exists
 * only so `npm run dev` and `npm run build` have something to serve.
 */

import { createBoard, formatBoard } from './core/index.js';

const app = document.querySelector('#app');
if (app !== null) {
  const pre = document.createElement('pre');
  pre.textContent = formatBoard(createBoard());
  app.append(pre);
}
