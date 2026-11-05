/** Debug-device UI actions and bounded semantic snapshot. No authentication values are read. */
import { execFileSync } from 'node:child_process';
const adb = 'C:/Users/marcelo/AppData/Local/Android/sdk/platform-tools/adb.exe';
const serial = process.env.CU27_DEVICE ?? 'ff77c09b1c12';
const run = args => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 20000 });
const args = process.argv.slice(2);
const picker = args[0] === '--picker';
if (picker) args.shift();
function snapshot() {
  const result=run(['shell', 'uiautomator', 'dump', '/sdcard/cu27-window.xml']);
  if(!result.includes('dumped to:')) throw new Error('UI_SNAPSHOT_NOT_READY_NO_ACTION');
  const value = run(['exec-out', 'cat', '/sdcard/cu27-window.xml']);
  const allowed = picker ? ['com.android.providers.media.module','com.google.android.providers.media.module','com.android.documentsui','com.google.android.documentsui'] : ['bo.edu.uagrm.autonexus.autonexus_mobile'];
  if (!allowed.some(name => value.includes('package="'+name+'"'))) throw new Error('EXPECTED_APP_NOT_FOREGROUND_NO_ACTION');
  return value;
}
let xml = snapshot();
if (args.length) {
  if (args[0] === 'tap' && args.length === 3 && args.slice(1).every(v => /^\d{1,4}$/.test(v))) run(['shell', 'input', ...args]);
  else if (args[0] === 'swipe' && args.length === 6 && args.slice(1).every(v => /^\d{1,4}$/.test(v))) run(['shell', 'input', ...args]);
  else throw new Error('ONLY_TAP_OR_SWIPE');
  xml = snapshot();
}
const decode = text => text.replaceAll('&#10;', ' / ').replaceAll('&amp;', '&').replaceAll('&quot;', '"');
for (const match of xml.matchAll(/<node\s+([^>]+)>?/g)) {
  const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  if (attrs.password === 'true') continue;
  const text = attrs['content-desc'] || attrs.text;
  if (text && (!picker || /CU27|AutoNexus|sample|Fotos|Photos|Álbum|Album|Buscar|Search|Explorar|Examinar|Browse|Más|More|Descargas|Downloads|Cerrar|Close|Seleccion|Select|Archivos|Files|Hoy|Today|Recent|Menú|menu|Mostrar/i.test(text))) console.log(JSON.stringify({ text: decode(text), bounds: attrs.bounds, clickable: attrs.clickable === 'true' }));
}
