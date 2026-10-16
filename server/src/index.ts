import { createApp } from "./app.js";
import { config } from "./config.js";

createApp().listen(config.port, () => {
  console.log(`LinkForge API     ${config.baseUrl}/api/v1`);
  console.log(`API docs          ${config.baseUrl}/api/docs`);
  console.log(`Short links       ${config.baseUrl}/<code>`);
});
