import type { ChildProfile, HomeAssistantOptions } from "./types.js";

/** Explicit lists, including an empty list, take precedence over legacy single-child settings. */
export function configuredChildren(config: Pick<HomeAssistantOptions, "children" | "babyName" | "babyBirthDate">): ChildProfile[] {
  return config.children ?? (config.babyBirthDate ? [{ id: "legacy", name: config.babyName || "BABY", birthDate: config.babyBirthDate, style: "neutral" }] : []);
}

export function childPanelId(child: ChildProfile): string {
  return child.id === "legacy" ? "baby-age" : `baby-age-${child.id}`;
}
