import sharp from "sharp";

const iconSvg = `
<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <rect width="128" height="128" rx="24" fill="#111827"/>
  <rect x="20" y="32" width="88" height="48" rx="6" fill="#020617" stroke="#22c55e" stroke-width="4"/>
  <g fill="#f8fafc">
    ${Array.from({ length: 8 }, (_, y) =>
      Array.from({ length: 16 }, (_, x) => `<rect x="${26 + x * 5}" y="${38 + y * 5}" width="3" height="3" rx="1"/>`).join(""),
    ).join("")}
  </g>
  <path d="M28 96h72" stroke="#38bdf8" stroke-width="8" stroke-linecap="round"/>
  <path d="M44 18h40" stroke="#facc15" stroke-width="8" stroke-linecap="round"/>
</svg>`;

const logoSvg = `
<svg width="512" height="128" viewBox="0 0 512 128" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="128" rx="22" fill="#ffffff"/>
  <rect x="22" y="28" width="108" height="66" rx="8" fill="#020617" stroke="#22c55e" stroke-width="5"/>
  <g fill="#f8fafc">
    ${Array.from({ length: 8 }, (_, y) =>
      Array.from({ length: 16 }, (_, x) => `<rect x="${32 + x * 6}" y="${38 + y * 6}" width="4" height="4" rx="1"/>`).join(""),
    ).join("")}
  </g>
  <text x="156" y="76" font-family="Inter, Arial, sans-serif" font-size="48" font-weight="800" fill="#111827">Tidbytr</text>
  <text x="158" y="101" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="600" fill="#138a53">Local display scheduler</text>
</svg>`;

await sharp(Buffer.from(iconSvg)).png().toFile("tidbytr/icon.png");
await sharp(Buffer.from(logoSvg)).png().toFile("tidbytr/logo.png");
