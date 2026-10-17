import { spawnSync } from "node:child_process";
const result = spawnSync("pixlet", ["version"], { encoding: "utf8" });
if (result.status !== 0 || !result.stdout.includes("v0.34.0")) throw new Error("Release verification requires Pixlet v0.34.0 on PATH; renderer integration tests must run.");
