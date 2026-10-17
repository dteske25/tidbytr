// HA builds with only the add-on folder as its Docker context.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, copyFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(path.join(os.tmpdir(), "tidbytr-package-"));
const output = path.join(temporary, "source.tar.gz");
const destination = path.join(root, "tidbytr", "source.tar.gz");
try {
  execFileSync("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "--mode=u=rwX,go=rX", "-czf", output,
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "tsconfig.server.json", "vite.config.ts", "src", "scripts"], { cwd: root });
  if (process.argv.includes("--check")) {
    if (!readFileSync(destination).equals(readFileSync(output))) throw new Error("Add-on source bundle is stale. Run pnpm package:addon and include tidbytr/source.tar.gz.");
  } else { copyFileSync(output, destination); chmodSync(destination, 0o644); console.log("Updated tidbytr/source.tar.gz from this checkout"); }
} finally { rmSync(temporary, { recursive: true, force: true }); }
