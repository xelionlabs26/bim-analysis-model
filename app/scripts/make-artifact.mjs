// Turns dist-artifact/ into one self-contained page fragment for the
// claude.ai Artifact host (which supplies <!doctype>, <head> and <body>).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist-artifact');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const threeVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies.three;
if (!/^\d+\.\d+\.\d+$/.test(threeVersion)) throw new Error(`three must be pinned to an exact version, got ${threeVersion}`);

const pick = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`could not find ${what} in dist-artifact/index.html`);
  return m[1];
};
const title = pick(/<title>([^<]*)<\/title>/, 'title');
const cssPath = pick(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"/, 'stylesheet');
const jsPath = pick(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"/, 'module script');
const body = pick(/<body>([\s\S]*)<\/body>/, 'body').replace(/<script type="module"[^>]*><\/script>/g, '').trim();

const css = readFileSync(join(dist, cssPath), 'utf8').replace(/<\/style/gi, '<\\/style');
const js = readFileSync(join(dist, jsPath), 'utf8').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
if (/@font-face/.test(css)) throw new Error('bundled @font-face rules leaked into the artifact CSS');

const cdn = `https://cdn.jsdelivr.net/npm/three@${threeVersion}`;
const importMap = { imports: { three: `${cdn}/build/three.module.min.js`, 'three/examples/jsm/': `${cdn}/examples/jsm/` } };
const fonts =
  'https://fonts.googleapis.com/css2?family=Archivo:wght@600;800;900&family=JetBrains+Mono:wght@400;700' +
  '&family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&display=swap';

const page = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts}">
<style>
${css}
</style>
<script type="importmap">${JSON.stringify(importMap)}</script>
${body}
<script type="module">
${js}
</script>
`;
const out = join(dist, 'pagoda-build.html');
writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(1)} KB; three@${threeVersion} from jsDelivr)`);
