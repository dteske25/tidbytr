import { useState } from "react";
import type { ChildProfile, SanitizedConfig } from "../../core/types.js";
import { configuredChildren } from "../../core/children.js";

export function ChildrenForm({ config, onSave }: { config: SanitizedConfig; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [children, setChildren] = useState(() => configuredChildren(config));
  const [stars, setStars] = useState(config.starfieldEnabled);
  const update = (id: string, changes: Partial<ChildProfile>) => setChildren((current) => current.map((child) => child.id === id ? { ...child, ...changes } : child));
  return <form onSubmit={(event) => {
    event.preventDefault();
    void onSave({ children, babyBirthDate: "", babyName: "", starfieldEnabled: stars });
  }}>
    <p>Each age slot shows the next child. Ages use calendar months and days in {config.timezone}. Future birth dates stay hidden until that day.</p>
    {children.map((child, index) => <fieldset className="child-profile" key={child.id}>
      <legend>Child {index + 1}</legend>
      <label className="policy-row">Name <input className="child-name" aria-label={`Child ${index + 1} name`} required maxLength={40} value={child.name} onChange={(event) => update(child.id, { name: event.target.value })} /></label>
      <label className="policy-row">Birth date <input type="date" aria-label={`Child ${index + 1} birth date`} required min="1900-01-01" value={child.birthDate} onChange={(event) => update(child.id, { birthDate: event.target.value })} /></label>
      <label className="policy-row">Style <select aria-label={`Child ${index + 1} style`} value={child.style} onChange={(event) => update(child.id, { style: event.target.value as ChildProfile["style"] })}>
        <option value="boy">Boy · Blue</option><option value="girl">Girl · Pink</option><option value="neutral">Neutral · Green</option>
      </select></label>
      <button className="outline-action" type="button" aria-label={`Remove child ${index + 1}`} onClick={() => setChildren((current) => current.filter((entry) => entry.id !== child.id))}>Remove child</button>
    </fieldset>)}
    {children.length === 0 ? <p>No age screens configured.</p> : null}
    <button className="outline-action" type="button" disabled={children.length >= 20} onClick={() => setChildren((current) => [...current, { id: crypto.randomUUID?.() ?? `child-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, name: "", birthDate: "", style: "neutral" }])}>Add child</button>
    <label className="policy-row">Star flight <input type="checkbox" aria-label="Star flight enabled" checked={stars} onChange={(event) => setStars(event.target.checked)} /></label>
    <button className="outline-action" type="submit">Save personal screens</button>
  </form>;
}
