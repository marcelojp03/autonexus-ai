import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const entries = [
  ...['employees', 'operations'].map((app) => ({
    app,
    source: new URL('../../mf-' + app + '/dist/integrated/browser/', import.meta.url),
    destination: new URL('../public/mfs/' + app + '/', import.meta.url),
    required: ['main.js', 'styles.css'],
  })),
  {
    // React microfrontend: single-spa entry plus its assets directory.
    app: 'finance',
    source: new URL('../../mf-finance/dist/integrated/', import.meta.url),
    destination: new URL('../public/mfs/finance/', import.meta.url),
    required: ['main.js'],
  },
];
for (const { app, source, required } of entries) {
  for (const file of required) {
    const path = new URL(file, source);
    const info = await stat(path).catch(() => { throw new Error('Falta ' + fileURLToPath(path) + '. Construye primero mf-' + app + ' en modo integrado.'); });
    if (!info.isFile()) throw new Error('Se esperaba un archivo: ' + fileURLToPath(path));
  }
}
for (const { app, source, destination } of entries) {
  // Only these owned destinations may be replaced, never public/ or mfs/.
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
  console.log('Staged ' + app + ': ' + fileURLToPath(destination));
}
