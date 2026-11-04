const s = (body: string, vb = '0 0 24 24', sw = 1.7) =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS: Record<string, string> = {
  logo: `<svg viewBox="0 0 64 64" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <g style="stroke: var(--brand)" stroke-width="2.6">
      <path d="M20 58V40h18v18"/><path d="M24 40V24h18v16"/><path d="M19 24V8h18v16"/>
      <path d="M38 40h6M42 24h-5M19 8h18"/>
    </g>
    <g style="stroke: var(--green)" stroke-width="2.4"><circle cx="47" cy="34" r="5"/><path d="M47 39v1"/></g>
    <path d="M8 58h48" style="stroke: var(--ink)" stroke-width="2.6"/></svg>`,
  crane: s('<path d="M7 21V5"/><path d="M4 5h17"/><path d="M7 5l3-2.5L13 5"/><path d="M4 5v3h3"/><path d="M17 5v6"/><path d="M15.5 11h3v2h-3z"/><path d="M5 21h5"/><path d="M7 9l-3 3M7 13l-3 3"/>'),
  model: s('<path d="M8 21V4h8v17"/><path d="M5 21h14"/><path d="M10.5 7.5h3M10.5 11h3M10.5 14.5h3"/><path d="M16 9h3v12"/>'),
  layers: s('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 16.5 9 5 9-5"/>'),
  parts: s('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M17 14v6M14 17h6"/>'),
  section: s('<path d="M6 3v15h15"/><path d="M3 6h15v15"/><path d="M9 9l6 6M9 13l2 2M13 9l2 2"/>'),
  render: s('<circle cx="12" cy="12" r="8.5"/><path d="M6 18 18 6"/>'),
  settings: s('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/><path d="M4 12h2M10 12h10"/><circle cx="8" cy="12" r="2"/>'),
  language: s('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5S14.6 18.1 12 20.5C9.4 18.1 8.2 15.3 8.2 12S9.4 5.9 12 3.5Z"/>'),
  menu: s('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  prev: s('<path d="M6 5v14"/><path d="M18 5 9 12l9 7V5Z" fill="currentColor"/>'),
  next: s('<path d="M18 5v14"/><path d="M6 5l9 7-9 7V5Z" fill="currentColor"/>'),
  pause: s('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
  play: s('<path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor"/>'),
  download: s('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'),
  close: s('<path d="M6 6l12 12M18 6 6 18"/>', '0 0 24 24', 2.2),
  chevL: s('<path d="m15 5-7 7 7 7"/>', '0 0 24 24', 2.2),
  chevR: s('<path d="m9 5 7 7-7 7"/>', '0 0 24 24', 2.2),
};

export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const svg = ICONS[el.dataset.icon!];
    if (svg) el.insertAdjacentHTML('afterbegin', svg);
  });
}

export function setIcon(el: HTMLElement, name: string) {
  el.innerHTML = ICONS[name] ?? '';
}
