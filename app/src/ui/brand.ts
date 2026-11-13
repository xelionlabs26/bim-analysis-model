/**
 * The product name in the header, in one place, so the app can be shown
 * under another name: change DEFAULT_BRAND, or open the page with
 * ?brand=Name (for example ?brand=Northside%20Build). The last word is set
 * in the accent colour, as BUILD is in ARBOR BUILD.
 */

export const DEFAULT_BRAND = 'Arbor Build';

/** Longest name the header has room for. */
const MAX_LENGTH = 24;

/** The name to show: the ?brand= value when it is usable, else the default. */
export function brandName(param: string | null | undefined): string {
  // letters (any script), digits, spaces and a little punctuation; nothing that could pass for markup
  const clean = (param ?? '').replace(/[^\p{L}\p{N} &'.\-]/gu, '').replace(/\s+/g, ' ').trim();
  return clean && clean.length <= MAX_LENGTH ? clean : DEFAULT_BRAND;
}

/** The wordmark in two parts: the lead in ink and the last word in the accent colour (empty for a one-word name). */
export function wordmark(name: string): { lead: string; accent: string } {
  const words = name.toUpperCase().split(' ').filter(Boolean);
  if (words.length < 2) return { lead: words[0] ?? '', accent: '' };
  return { lead: words.slice(0, -1).join(' '), accent: words[words.length - 1] };
}

/** Put the name in the header wordmark and the page title. */
export function applyBrand(name: string, mark: HTMLElement, doc: Pick<Document, 'title'>) {
  const { lead, accent } = wordmark(name);
  mark.textContent = accent ? `${lead} ` : lead;
  if (accent) {
    const em = mark.ownerDocument.createElement('em');
    em.textContent = accent;
    mark.append(em);
  }
  doc.title = name;
}
