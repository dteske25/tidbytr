import sharp from "sharp";

export const SPORTS_LOGO_SIZE = 10;
const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_LOGOS = 128;
const SUCCESS_TTL_MS = 24 * 3600_000;
const RETRY_TTL_MS = 5 * 60_000;

interface LogoEntry {
  pixels?: Buffer;
  expiresAt: number;
  loading?: Promise<void>;
}

export class SportsLogoCache {
  private readonly entries = new Map<string, LogoEntry>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /** Return cached art immediately and start at most one download per URL. */
  get(value?: string): Buffer | undefined {
    const url = logoUrl(value);
    if (!url) return undefined;

    const now = Date.now();
    const key = url.href;
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= MAX_LOGOS) {
        const evict = [...this.entries].find(([, candidate]) => !candidate.loading);
        if (!evict) return undefined;
        this.entries.delete(evict[0]);
      }
      entry = { expiresAt: 0 };
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (!entry.loading && entry.expiresAt <= now) {
      const target = entry;
      target.loading = this.load(url).then((pixels) => {
        target.pixels = pixels;
        target.expiresAt = Date.now() + SUCCESS_TTL_MS;
      }, () => {
        target.expiresAt = Date.now() + RETRY_TTL_MS;
      }).finally(() => { target.loading = undefined; });
    }
    return entry.pixels;
  }

  private async load(url: URL): Promise<Buffer> {
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(6500), redirect: "error" });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error("Team logo unavailable");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          throw new Error("Team logo is too large");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const image = sharp(Buffer.concat(chunks), { limitInputPixels: 1_100_000 });
    const { format } = await image.metadata();
    if (format !== "png" && format !== "webp") throw new Error("Unsupported team logo format");
    return image.toColourspace("srgb").ensureAlpha().trim({ threshold: 12 })
      .resize(SPORTS_LOGO_SIZE, SPORTS_LOGO_SIZE, { fit: "contain", background: "#00000000" })
      .raw().toBuffer();
  }
}

function logoUrl(value?: string): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.origin === "https://a.espncdn.com" && !url.username && !url.password &&
      /^\/i\/teamlogos\/[a-z0-9_/-]+\.png$/i.test(url.pathname)) {
      return new URL(url.pathname, url.origin);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export const sportsLogos = new SportsLogoCache();
