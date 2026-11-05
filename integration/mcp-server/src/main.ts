import { isAbsolute } from 'node:path';
import { loadConfig } from './infrastructure/config.js';
import { FileClientRegistry } from './infrastructure/client-registry.js';
import { AccessTokenVerifier } from './infrastructure/access-token-verifier.js';
import { KeycloakTokenExchange } from './application/token-exchange.js';
import { JsonLineAuditSink } from './infrastructure/audit-sink.js';
import { createConsultationApp } from './http-app.js';

try {
  const config = loadConfig();
  const file = process.env['MCP_AUDIT_FILE'];
  if (!file || !isAbsolute(file)) throw new Error('Private audit path is required');
  const registry = new FileClientRegistry(config.clientRegistryFile);
  const verifier = new AccessTokenVerifier(config, registry);
  const app = createConsultationApp({ config, verify: token => verifier.verify(token),
    exchange: new KeycloakTokenExchange(config, verifier), audit: new JsonLineAuditSink(file) });
  const listener = app.listen(config.port, config.host, () => console.error('AutoNexus read MCP listening'));
  listener.on('error', () => { console.error('MCP_LISTENER_UNAVAILABLE'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { listener.close(); listener.closeIdleConnections(); });
} catch { console.error('MCP_CONFIGURATION_INVALID'); process.exitCode = 1; }
