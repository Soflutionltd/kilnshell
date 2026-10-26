// Renders docs/benchmark.svg from bench/results.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { rows, platform, date, shell } = JSON.parse(readFileSync(join(here, 'results.json'), 'utf8'));
const W = 900, left = 300, right = 120, top = 86, rowH = 46, barH = 15;
const H = top + rows.length * rowH + 40;
// Each row is drawn relative to Desktop Commander's time for that tool, so every speed-up reads at a glance.
const full = W - left - right;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
let y = top;
const bars = rows.map((r) => {
  const scale = (v) => Math.max(3, (v / r.desktopCommander) * full);
  const g = `
  <text x="${left - 14}" y="${y + 19}" text-anchor="end" font-size="14" fill="#C9D1DC">${esc(r.label)}</text>
  <rect x="${left}" y="${y}" width="${scale(r.desktopCommander)}" height="${barH}" rx="4" fill="#3A4354"/>
  <text x="${left + scale(r.desktopCommander) + 8}" y="${y + 12}" font-size="12" fill="#8B95A7">${r.desktopCommander} ms</text>
  <rect x="${left}" y="${y + barH + 3}" width="${scale(r.kilnshell)}" height="${barH}" rx="4" fill="#FF6A1A"/>
  <text x="${left + scale(r.kilnshell) + 8}" y="${y + barH + 15}" font-size="12" font-weight="700" fill="#FF8A3D">${r.kilnshell} ms  ·  ${r.speedup}x</text>`;
  y += rowH;
  return g;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, -apple-system, Segoe UI, Helvetica, Arial, sans-serif">
  <rect width="${W}" height="${H}" rx="18" fill="#0E1116"/>
  <text x="32" y="42" font-size="22" font-weight="800" fill="#E8ECF2">Median time per tool call, relative to Desktop Commander</text>
  <rect x="32" y="58" width="12" height="12" rx="3" fill="#3A4354"/><text x="50" y="68" font-size="13" fill="#8B95A7">Desktop Commander 0.3.1</text>
  <rect x="220" y="58" width="12" height="12" rx="3" fill="#FF6A1A"/><text x="238" y="68" font-size="13" fill="#C9D1DC">Kilnshell</text>
  <text x="${W - 32}" y="68" text-anchor="end" font-size="12" fill="#5B6577">${esc(platform)}, ${esc(String(shell).split('/').pop())} login profile, ${date}</text>${bars}
</svg>
`;
writeFileSync(join(here, '../docs/benchmark.svg'), svg);
console.log('docs/benchmark.svg written');
