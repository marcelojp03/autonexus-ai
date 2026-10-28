import Keycloak from 'keycloak-js';
import '@fontsource-variable/inter';
import { browserOidcConfig, createBrowserSession } from '../../browser-auth/session.ts';
import { mount, unmount } from './spa.jsx';
import { startStandalone } from './standalone.js';

const owner = createBrowserSession(new Keycloak(browserOidcConfig('finance')), { origin: location.origin, application: 'finance' });
const app = startStandalone({ owner, element: document.getElementById('root'), mount, unmount });
window.addEventListener('pagehide', () => { void app.dispose(); }, { once: true });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
if (import.meta.hot) import.meta.hot.dispose(() => { void app.dispose(); });
