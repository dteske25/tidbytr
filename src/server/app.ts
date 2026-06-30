import fs from "node:fs";
import path from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";
import { loadRuntimeConfig } from "../core/config.js";
import type { SourceId } from "../core/types.js";
import { TidbytrRuntime, type TidbytrRuntimeOptions } from "./runtime.js";

interface BuildAppOptions extends Partial<TidbytrRuntimeOptions> {
  startScheduler?: boolean;
}

const pushBodySchema = z.object({
  panelId: z.string().optional(),
});

const skipBodySchema = z.object({
  panelId: z.string().optional(),
});

const snoozeBodySchema = z.object({
  minutes: z.coerce.number().int().min(1).max(1440).default(15),
});

const sourceBodySchema = z.object({
  sourceId: z.enum(["clock", "nws", "sports"]),
  enabled: z.boolean(),
});

export async function buildApp(options: BuildAppOptions = {}) {
  const config = options.config ?? loadRuntimeConfig();
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  });
  const runtime = new TidbytrRuntime({
    config,
    store: options.store,
    weatherProvider: options.weatherProvider,
    sportsProvider: options.sportsProvider,
    transport: options.transport,
    renderer: options.renderer,
    logger: app.log,
  });

  app.decorate("runtime", runtime);
  app.addHook("onClose", async () => {
    runtime.close();
  });
  if (options.startScheduler !== false) {
    runtime.startScheduler();
  }

  await app.register(cors, { origin: true });

  app.get("/api/status", async () => runtime.getStatus());
  app.get("/api/config", async () => runtime.getEditableConfig());
  app.put("/api/config", async (request, reply) => {
    try {
      return await runtime.updateConfig(request.body);
    } catch (error) {
      return reply.code(400).send({
        error: "Invalid config",
        message: error instanceof Error ? error.message : "Unknown config error",
      });
    }
  });

  app.get("/api/panels", async () => ({ panels: await runtime.getPanels() }));
  app.get("/api/panels/:id/preview.webp", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const preview = await runtime.preview(id);
      if (!preview) {
        return reply.code(404).send({ error: "Panel not found" });
      }

      return reply.header("Content-Type", "image/webp").send(preview);
    } catch (error) {
      return reply.code(500).send({
        error: "Render failed",
        message: error instanceof Error ? error.message : "Unknown render error",
      });
    }
  });

  app.post("/api/actions/push", async (request, reply) => {
    try {
      const body = pushBodySchema.parse(request.body ?? {});
      return await runtime.push(body.panelId);
    } catch (error) {
      return reply.code(400).send({
        error: "Push failed",
        message: error instanceof Error ? error.message : "Unknown push error",
      });
    }
  });

  app.post("/api/actions/skip", async (request) => {
    const body = skipBodySchema.parse(request.body ?? {});
    return runtime.skip(body.panelId);
  });

  app.post("/api/actions/snooze", async (request) => {
    const body = snoozeBodySchema.parse(request.body ?? {});
    return runtime.snooze(body.minutes);
  });

  app.post("/api/actions/source", async (request) => {
    const body = sourceBodySchema.parse(request.body ?? {}) as { sourceId: SourceId; enabled: boolean };
    return runtime.setSourceEnabled(body.sourceId, body.enabled);
  });

  const staticRoot = path.join(process.cwd(), "dist", "web");
  if (fs.existsSync(staticRoot)) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith("/api/")) {
        return reply.code(404).send({ error: "Not found" });
      }

      return reply.sendFile("index.html");
    });
  }

  return app;
}
