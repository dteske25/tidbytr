import fs from "node:fs";
import path from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";
import { loadRuntimeConfig } from "../core/config.js";
import type { SourceId } from "../core/types.js";
import { TidbytrRuntime, type TidbytrRuntimeOptions } from "./runtime.js";

declare module "fastify" {
  interface FastifyInstance {
    runtime: TidbytrRuntime;
  }
}

interface BuildAppOptions extends Partial<TidbytrRuntimeOptions> {
  startScheduler?: boolean;
}

const pushBodySchema = z.object({
  panelId: z.string().optional(),
  holdSeconds: z.coerce.number().int().min(20).max(3600).default(60),
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
    publisher: options.publisher,
    renderer: options.renderer,
    logger: app.log,
  });

  app.decorate("runtime", runtime);
  app.addHook("onClose", async () => {
    await runtime.close();
  });
  if (options.startScheduler !== false) {
    runtime.startScheduler();
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "Invalid request", message: error.message });
    app.log.error(error);
    return reply.code(500).send({ error: "Request failed", message: error instanceof Error ? error.message : "Unknown error" });
  });
  await app.register(cors, { origin: true });

  app.get("/api/status", async () => runtime.getStatus());
  app.get("/api/display/current.webp", async (_request, reply) => {
    const frame = await runtime.getPublishedPreview();
    if (!frame) return reply.code(404).send({ error: "No frame published yet" });
    return reply.header("Content-Type", "image/webp").header("Cache-Control", "no-store").send(frame);
  });
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
      const result = await runtime.publish(body.panelId, new Date(), body.holdSeconds);
      if (body.panelId && result.decision.result !== "published") return reply.code(409).send({ ...result, error: "Show was superseded", message: result.decision.reason });
      return result;
    } catch (error) {
      return reply.code(400).send({
        error: "Publish failed",
        message: error instanceof Error ? error.message : "Unknown publish error",
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

export async function buildDisplayApp(runtime: TidbytrRuntime) {
  const app = Fastify({
    logger: false,
  });

  app.get("/current.webp", async (_request, reply) => {
    try {
      const frame = await runtime.getCurrentFrameForPull();
      return reply.header("Content-Type", "image/webp").header("Cache-Control", "no-store").send(frame);
    } catch (error) {
      return reply.code(503).header("Cache-Control", "no-store").send({
        error: "Frame unavailable",
        message: error instanceof Error ? error.message : "Unknown display error",
      });
    }
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "Not found" }));

  return app;
}
