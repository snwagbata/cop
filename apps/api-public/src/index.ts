import { app } from "./app.js";

const PORT = Number(process.env.PORT ?? 4001);
const ALLOWED_ORIGIN = process.env.PUBLIC_WEB_ORIGIN ?? "http://localhost:5173";

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`api-public listening on port ${PORT} (CORS origin: ${ALLOWED_ORIGIN})`);
});
