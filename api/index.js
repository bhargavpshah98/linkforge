// Vercel entry point: every request that isn't a static dashboard file (API calls and short-link
// redirects) is rewritten here by vercel.json and handled by the same Express app as `npm start`.
import { createApp } from "../server/dist/app.js";

export default createApp();
