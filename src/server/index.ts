import { buildApp } from "./app.js";
import { loadRuntimeConfig } from "../core/config.js";

const config = loadRuntimeConfig();
const app = await buildApp({ config });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0), (error: unknown) => {
      app.log.error(error);
      process.exit(1);
    });
  });
}
