import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App, ConfigProvider } from 'antd';
import { StyleProvider } from '@ant-design/cssinjs';
import esES from 'antd/locale/es_ES';
import IntegratedApp from './integrated/IntegratedApp.jsx';
import templateCss from './index.css?inline';

/** The Shell owns routing and SessionPort. All styles and portals stay local. */
let root;
let host;

export async function bootstrap() {}

export async function mount(props) {
  if (root) throw new Error('Finance is already mounted');
  const snapshot = props.session?.snapshot();
  if (!props.domElement || snapshot?.mode !== 'oidc' || !snapshot.authenticated) throw new Error('Finance requires a host and an authenticated SessionPort');
  host = props.domElement;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.replaceChildren();
  const style = document.createElement('style');
  // The template reset is isolated from the Shell and both Angular apps.
  style.textContent = templateCss.replaceAll(':root', ':host') + ' :host { display:block; font-family:Inter,system-ui,sans-serif; color:#1f1f1f; }';
  const surface = document.createElement('div');
  const portals = document.createElement('div');
  portals.dataset.financePortals = '';
  shadow.append(style, surface, portals);
  let renderError;
  root = createRoot(surface, { onUncaughtError(error) { renderError = error; console.error(error); } });
  try {
    flushSync(() => root.render(
      <React.StrictMode>
        <StyleProvider container={shadow}>
          <ConfigProvider locale={esES} getPopupContainer={() => portals} getTargetContainer={() => portals} theme={{ token: { borderRadius: 6, colorPrimary: '#1677ff' } }}>
            <App message={{ getContainer: () => portals }} notification={{ getContainer: () => portals }}>
              <IntegratedApp session={props.session} basePath={props.basePath} />
            </App>
          </ConfigProvider>
        </StyleProvider>
      </React.StrictMode>,
    ));
    if (renderError) throw renderError;
  } catch (error) {
    await unmount();
    throw error;
  }
}

export async function unmount() {
  root?.unmount();
  root = undefined;
  host?.shadowRoot?.replaceChildren();
  host = undefined;
}
