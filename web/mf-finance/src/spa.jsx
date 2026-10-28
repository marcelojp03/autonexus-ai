import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import esES from 'antd/locale/es_ES';
import IntegratedApp from './integrated/IntegratedApp.jsx';
import './index.css';

/**
 * Explicit single-spa lifecycles. The Shell owns navigation and session; this
 * microfrontend renders only its business surface, never a login, and keeps no
 * token. React 19 mounts and unmounts on the host element the Shell provides.
 */
let root = null;

export async function bootstrap() {
  // Nothing to prepare: styles are bundled and the session arrives by props.
}

export async function mount(props) {
  const element = props.domElement ?? document.getElementById('mf-finance');
  if (!element) throw new Error('No host element for Finance');
  root = createRoot(element);
  root.render(
    <React.StrictMode>
      <ConfigProvider locale={esES} theme={{ token: { borderRadius: 6, colorPrimary: '#1677ff' } }}>
        <IntegratedApp session={props.session} basePath={props.basePath ?? '/finance'} />
      </ConfigProvider>
    </React.StrictMode>,
  );
}

export async function unmount() {
  if (root) {
    root.unmount();
    root = null;
  }
}
