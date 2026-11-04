import type { Project } from '../data/types';

/** Header drawing strip: mini elevation, height dimension, section bubble, north arrow, register. */
export function renderHeaderDrawing(el: HTMLElement, p: Project, sheet: string) {
  const H = p.height.toFixed(2);
  el.innerHTML = `
    <svg class="hd-elev" viewBox="0 0 260 80" width="260" aria-label="Mini elevation" fill="none" stroke="currentColor" stroke-width="1.3">
      <g transform="translate(70 6)">
        <path d="M30 0v14M26 5h8"/>
        <path d="M14 22h32M18 22l-4 4h32l-4-4"/>
        <path d="M18 31h24M14 36h32M10 36l4-5M50 36l-4-5"/>
        <path d="M16 44h28M10 48h40"/>
        <path d="M14 56h32M6 60h48"/>
        <path d="M12 60v6h36v-6"/>
      </g>
      <path d="M0 72h200" stroke-width="1"/>
      ${Array.from({ length: 9 }, (_, i) => `<path d="M${10 + i * 22} 68v8" stroke-width="0.8"/>`).join('')}
      <text x="2" y="64" font-family="JetBrains Mono" font-size="8.5" fill="#8b8178" stroke="none" letter-spacing="1">ELEV. S · 1:200</text>
      <g stroke="#9d1125">
        <path d="M156 6v58M151 6h10M151 64h10"/>
        <text x="166" y="38" font-family="JetBrains Mono" font-size="9" fill="#9d1125" stroke="none">H ${H}</text>
      </g>
      <path d="M200 36h34" stroke="#9d1125"/>
    </svg>
    <svg class="hd-sec" viewBox="0 0 130 80" width="130" aria-label="Section marker" fill="none" stroke="currentColor" stroke-width="1.3">
      <circle cx="28" cy="40" r="17"/>
      <path d="M11 40h34"/>
      <path d="M28 6v12M28 62v14" stroke-dasharray="3 3"/>
      <text x="28" y="35" text-anchor="middle" font-family="Source Serif 4" font-size="13" font-weight="700" fill="currentColor" stroke="none">A</text>
      <text x="28" y="52" text-anchor="middle" font-family="JetBrains Mono" font-size="8" fill="#9d1125" stroke="none">A-301</text>
      <path d="M60 40h40" stroke="#9d1125" stroke-width="2"/>
      <path d="M100 34l10 6-10 6Z" fill="#9d1125" stroke="none"/>
    </svg>
    <svg class="hd-north" viewBox="0 0 70 80" width="70" aria-label="North arrow" fill="none" stroke="currentColor" stroke-width="1.3">
      <text x="35" y="10" text-anchor="middle" font-family="Archivo" font-weight="800" font-size="10" fill="currentColor" stroke="none">N</text>
      <circle cx="35" cy="44" r="22"/>
      <path d="M35 18v52M9 44h52"/>
      <path d="M35 20l7 24-7 4-7-4Z" fill="currentColor"/>
      <path d="M35 68l7-24-7 4-7-4Z" fill="#fff"/>
    </svg>
    <svg viewBox="0 0 110 80" width="110" aria-label="Drawing register" fill="none" stroke="currentColor" stroke-width="1.1">
      <rect x="2" y="12" width="104" height="60"/>
      <path d="M2 32h104M2 52h104M44 12v60"/>
      <g font-family="JetBrains Mono" font-size="8.5" stroke="none" fill="#8b8178">
        <text x="8" y="26">DWG</text><text x="8" y="46">REV</text><text x="8" y="66">SHEET</text>
      </g>
      <g font-family="JetBrains Mono" font-size="9" stroke="none">
        <text x="50" y="26" fill="currentColor">${p.id}</text>
        <text x="50" y="46" fill="#9d1125">${p.rev} · ${p.revDate}</text>
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
