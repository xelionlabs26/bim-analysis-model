import type { Project } from '../data/types';
import { fmtInt } from '../engine/timeline';

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

/** What the status card says about the project in place of a clock: its sheet number, height and floor area. */
export function projectFacts(p: Pick<Project, 'id' | 'name' | 'rev' | 'height' | 'storeys' | 'gifa' | 'parts'>): { head: string; main: string; sub: string; label: string } {
  const height = `${p.height.toFixed(1)} m`;
  const parts = `${fmtInt(p.parts.length)} parts`;
  const area = Number.isFinite(p.gifa) && p.gifa > 0 ? `${fmtInt(p.gifa)} m² GIA` : '';
  const storeys = `${p.storeys} ${p.storeys === 1 ? 'storey' : 'storeys'}`;
  return {
    // an imported model has no revision of its own ('—')
    head: `${p.id}${/[A-Za-z0-9]/.test(p.rev) ? ` · REV ${p.rev}` : ''}`,
    main: height,
    sub: area || parts,
    label: [p.name, storeys, `${height} high`, area, parts].filter(Boolean).join(' · '),
  };
}

/** A carbon figure as a number and its unit: kgCO₂e under a tonne, one decimal under 10 t. */
function carbonParts(kg: number): { n: string; unit: string } {
  if (!Number.isFinite(kg) || kg < 1) return { n: '—', unit: '' };
  if (kg < 1000) return { n: String(Math.round(kg)), unit: 'kgCO₂e' };
  const t = kg / 1000;
  return { n: t < 10 ? t.toFixed(1) : fmtInt(t), unit: 'tCO₂e' };
}

/**
 * What the status card says about carbon, always in view with its caveat: the
 * indicative A1–A3 total for the whole build, its intensity per m² of floor
 * area, and in `label` the basis in full. `assumed` is how many elements had
 * their material assumed (an imported model's defaulted materials).
 */
export function carbonFacts(
  p: Pick<Project, 'totalCarbonKg' | 'totalBiogenicKg' | 'gifa'>,
  assumed = 0,
): { head: string; main: string; unit: string; sub: string; label: string } {
  const total = carbonParts(p.totalCarbonKg);
  const area = Number.isFinite(p.gifa) && p.gifa > 0 ? p.gifa : 0;
  const perM2 = area && total.unit ? Math.round(p.totalCarbonKg / area) : null;
  const stored = carbonParts(p.totalBiogenicKg);
  const label = [
    total.unit ? `Indicative A1–A3 embodied carbon: about ${total.n} ${total.unit}` : 'Indicative A1–A3 embodied carbon: none counted',
    perM2 !== null ? `, ${fmtInt(perM2)} kgCO₂e per m² over ${fmtInt(area)} m² GIA` : '',
    '. Worked out from generic factors per material, not from product EPDs; transport, construction, use and end of life (A4 onwards) are not included.',
    stored.unit ? ` Carbon stored in timber, about ${stored.n} ${stored.unit}, is reported separately.` : '',
    assumed > 0 ? ` ${fmtInt(assumed)} ${assumed === 1 ? 'element has' : 'elements have'} an assumed material (see Import).` : '',
  ].join('');
  return {
    head: 'INDICATIVE A1–A3',
    main: total.n,
    unit: total.unit,
    sub: perM2 !== null ? `${fmtInt(perM2)} kg/m² GIA` : 'no floor area',
    label,
  };
}
