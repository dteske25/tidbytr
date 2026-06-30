import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const source = path.join(process.cwd(), "src", "renderer", "pixlet", "templates");
const target = path.join(process.cwd(), "dist", "renderer", "pixlet", "templates");

await mkdir(path.dirname(target), { recursive: true });
await cp(source, target, { recursive: true });

