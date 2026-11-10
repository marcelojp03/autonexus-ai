import { stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve, sep } from 'node:path';
import { defineConfig } from 'vite';

/** SPA fallback applies to UI routes, never to missing MF scripts/styles/assets. */
function guardModuleAssets(directory: string) {
  const root = resolve(directory);
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!request.url?.startsWith('/mfs/')) return next();
    const reject = () => { response.statusCode = 404; response.end('Microfrontend resource not found'); };
    let file: string;
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (!pathname.startsWith('/mfs/')) return reject();
      file = resolve(root, decodeURIComponent(pathname.slice('/mfs/'.length)));
      if (!file.startsWith(root + sep)) return reject();
    } catch { return reject(); }
    void stat(file).then(info => {
      if (info.isFile()) { response.setHeader('Cache-Control', 'no-cache'); next(); }
      else reject();
    }).catch(reject);
  };
}

export default defineConfig({
  // Stable remote entry names need a new URL when a staged build changes.
  // Their imported chunks already carry content hashes.
  define: {
    __MF_BUILD_VERSION__: JSON.stringify(createHash('sha256').update(
      ['employees', 'operations', 'finance', 'intelligence'].map(app =>
        readFileSync(new URL('./public/mfs/' + app + '/main.js', import.meta.url), 'utf8')
      ).join('\n')
    ).digest('hex'))
  },
  plugins: [{
    name: 'autonexus-module-assets',
    configureServer(server) { server.middlewares.use(guardModuleAssets(resolve(server.config.root, 'public/mfs'))); },
    configurePreviewServer(server) { server.middlewares.use(guardModuleAssets(resolve(server.config.root, server.config.build.outDir, 'mfs'))); }
  }],
  server: { host: '127.0.0.1', port: 4200, strictPort: true },
  preview: { host: '127.0.0.1', port: 4200, strictPort: true }
});
