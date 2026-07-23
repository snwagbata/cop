import { createApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 4002);
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5175";

const app = createApp();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`api-internal listening on port ${PORT} (CORS origin: ${ALLOWED_ORIGIN})`);
});
