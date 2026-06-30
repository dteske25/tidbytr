import type { FrameBundle, Panel, RuntimeConfig } from "../core/types.js";

export interface DisplayRenderer {
  render(panel: Panel, now: Date, config: RuntimeConfig): Promise<FrameBundle>;
}

