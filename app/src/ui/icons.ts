const s = (body: string, vb = '0 0 24 24', sw = 1.7) =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS: Record<string, string> = {
  logo: `<svg viewBox="0 0 64 64" fill="none" stroke="#9d1125" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M32 4v8"/><path d="M28 8h8"/>
    <path d="M14 20c6-1 12-4 18-7 6 3 12 6 18 7"/><path d="M20 20v5h24v-5"/>
    <path d="M10 33c8-1 15-4 22-7 7 3 14 6 22 7"/><path d="M17 33v6h30v-6"/>
    <path d="M6 47c9-1 18-4 26-7 8 3 17 6 26 7"/><path d="M14 47v11h36V47"/>
    <path d="M28 58v-6h8v6"/><path d="M10 60h44" stroke="#1c160f"/></svg>`,
  pagoda: s('<path d="M12 2.5v3"/><path d="M6 8.5c2.4-.4 4.3-1.4 6-2.6 1.7 1.2 3.6 2.2 6 2.6"/><path d="M8 8.5v3h8v-3"/><path d="M4.5 14.5c2.8-.4 5.3-1.6 7.5-3 2.2 1.4 4.7 2.6 7.5 3"/><path d="M7 14.5V21h10v-6.5"/><path d="M10.5 21v-3h3v3"/>'),
  model: s('<path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5"/><path d="M12 12v9"/>'),
  layers: s('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 16.5 9 5 9-5"/>'),
  parts: s('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M17 14v6M14 17h6"/>'),
  section: s('<path d="M6 3v15h15"/><path d="M3 6h15v15"/><path d="M9 9l6 6M9 13l2 2M13 9l2 2"/>'),
  render: s('<circle cx="12" cy="12" r="8.5"/><path d="M6 18 18 6"/>'),
  settings: s('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/><path d="M4 12h2M10 12h10"/><circle cx="8" cy="12" r="2"/>'),
  language: s('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5S14.6 18.1 12 20.5C9.4 18.1 8.2 15.3 8.2 12S9.4 5.9 12 3.5Z"/>'),
  menu: s('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  music: s('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
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
