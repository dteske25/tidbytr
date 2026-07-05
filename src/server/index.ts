import { buildApp, buildDisplayApp } from "./app.js";
import { loadRuntimeConfig } from "../core/config.js";
import type { TidbytrRuntime } from "./runtime.js";

const config = loadRuntimeConfig();
const app = await buildApp({ config });
const runtime = app.runtime as TidbytrRuntime;
const displayApp = await buildDisplayApp(runtime);

app.addHook("onClose", async () => {
  await displayApp.close();
});

try {
  await displayApp.listen({ host: config.displayHost, port: config.displayPort });
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await displayApp.close();
  process.exit(1);
}
