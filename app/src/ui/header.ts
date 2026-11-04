import type { Project } from '../data/types';

/** Header drawing strip: mini elevation, height dimension, section marker, north point, register. */
export function renderHeaderDrawing(el: HTMLElement, p: Project, sheet: string) {
  const H = p.height.toFixed(1);
  // a slim elevation of the tower: podium, three stacked bands, crown
  const bands = [
    [52, 58, 30, 4.5],
    [54, 34.5, 26, 24],
    [53, 11, 28, 23.5],
    [55, 3, 24, 8],
  ]
    .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`)
    .join('');
  const floors = Array.from({ length: 13 }, (_, i) => `<path d="M55 ${14 + i * 3.4}h22" stroke-width="0.5"/>`).join('');
  el.innerHTML = `
    <svg class="hd-elev" viewBox="0 0 230 80" width="230" aria-label="Mini elevation" fill="none" stroke="currentColor" stroke-width="1.2">
      <g>${bands}${floors}</g>
      <path d="M49 62.5h36"/>
      <circle cx="80" cy="30" r="3" style="stroke: var(--green)"/>
      <path d="M0 72h170" stroke-width="1"/>
      ${Array.from({ length: 8 }, (_, i) => `<path d="M${8 + i * 22} 68v8" stroke-width="0.8"/>`).join('')}
      <text x="2" y="64" font-family="Geist Mono, monospace" font-size="8" style="fill: var(--muted)" stroke="none" letter-spacing="1">ELEV. S · 1:1000</text>
      <g style="stroke: var(--brand)">
        <path d="M110 3v59.5M105 3h10M105 62.5h10"/>
        <text x="120" y="36" font-family="Geist Mono, monospace" font-size="9" style="fill: var(--brand)" stroke="none">H ${H}</text>
      </g>
      <path d="M170 36h40" style="stroke: var(--brand)"/>
    </svg>
    <svg class="hd-sec" viewBox="0 0 130 80" width="130" aria-label="Section marker" fill="none" stroke="currentColor" stroke-width="1.3">
      <circle cx="28" cy="40" r="17"/>
      <path d="M11 40h34"/>
      <path d="M28 6v12M28 62v14" stroke-dasharray="3 3"/>
      <text x="28" y="35" text-anchor="middle" font-family="Big Shoulders Display, sans-serif" font-size="14" font-weight="800" fill="currentColor" stroke="none">A</text>
      <text x="28" y="52" text-anchor="middle" font-family="Geist Mono, monospace" font-size="8" style="fill: var(--brand)" stroke="none">A-301</text>
      <path d="M60 40h40" style="stroke: var(--brand)" stroke-width="2"/>
      <path d="M100 34l10 6-10 6Z" style="fill: var(--brand)" stroke="none"/>
    </svg>
    <svg class="hd-north" viewBox="0 0 70 80" width="70" aria-label="North point" fill="none" stroke="currentColor" stroke-width="1.3">
      <text x="35" y="10" text-anchor="middle" font-family="Big Shoulders Display, sans-serif" font-weight="800" font-size="11" fill="currentColor" stroke="none">N</text>
      <circle cx="35" cy="44" r="22"/>
      <path d="M35 18v52M9 44h52"/>
      <path d="M35 20l7 24-7 4-7-4Z" fill="currentColor"/>
      <path d="M35 68l7-24-7 4-7-4Z" style="fill: var(--card)"/>
    </svg>
    <svg viewBox="0 0 110 80" width="110" aria-label="Drawing register" fill="none" stroke="currentColor" stroke-width="1.1">
      <rect x="2" y="12" width="104" height="60"/>
      <path d="M2 32h104M2 52h104M44 12v60"/>
      <g font-family="Geist Mono, monospace" font-size="8.5" stroke="none" style="fill: var(--muted)">
        <text x="8" y="26">DWG</text><text x="8" y="46">REV</text><text x="8" y="66">SHEET</text>
      </g>
      <g font-family="Geist Mono, monospace" font-size="9" stroke="none">
        <text x="50" y="26" fill="currentColor">${p.id}</text>
        <text x="50" y="46" style="fill: var(--brand)">${p.rev} · ${p.revDate}</text>
        <text x="50" y="66" fill="currentColor" id="hdrSheet">${sheet}</text>
      </g>
    </svg>`;
}

export function startClock(dateEl: HTMLElement, timeEl: HTMLElement) {
  const tick = () => {
    const d = new Date();
    dateEl.textContent = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase();
    timeEl.textContent = d.toLocaleTimeString('en-GB', { hour12: false });
  };
  tick();
  setInterval(tick, 1000);
}
