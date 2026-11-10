import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { EmployeesFailure } from '../employees/employees-api';
import { SecurityApi } from './security-api';
import { MCP_SCOPES, type McpClientRegistration, type McpPublicConfig, type McpScope } from './security.contract';

const ERROR_TEXT: Readonly<Record<string, string>> = Object.freeze({
  FORBIDDEN: 'Tu permiso efectivo no habilita la administración de clientes MCP.',
  CLIENT_DUPLICATE: 'Ese clientId ya está registrado.',
  VALIDATION_ERROR: 'Revisá el ID, el nombre y los alcances seleccionados.',
  SERVICE_UNAVAILABLE:
    'No se pudo contactar la administración privada del servidor MCP. El cambio no se confirmó; actualizá la lista antes de reintentar.'
});

@Component({
  selector: 'anx-mcp-integrations',
  imports: [
    CommonModule,
    FormsModule,
    NzAlertModule,
    NzButtonModule,
    NzCheckboxModule,
    NzEmptyModule,
    NzInputModule,
    NzPageHeaderModule,
    NzPopconfirmModule,
    NzTagModule
  ],
  templateUrl: './mcp-integrations.component.html',
  styles: [
    `
      .integration-layout {
        display: grid;
        grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.7fr);
        gap: 28px;
        margin-block: 20px;
      }
      .connection {
        padding-block: 8px;
      }
      .connection h2,
      .registry h2,
      .tutorial h2 {
        margin: 0 0 10px;
        font-size: 18px;
      }
      .endpoint {
        display: block;
        overflow-wrap: anywhere;
        padding: 12px;
        background: rgba(0, 0, 0, 0.035);
        font-size: 13px;
      }
      .tutorial {
        max-width: 72ch;
      }
      .tutorial ol {
        padding-left: 22px;
      }
      .tutorial li {
        margin-block: 10px;
        line-height: 1.55;
      }
      .client-row {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) auto;
        gap: 16px;
        padding-block: 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.12);
      }
      .client-name {
        margin: 0 0 6px;
        font-weight: 600;
      }
      .client-id {
        overflow-wrap: anywhere;
        color: rgba(0, 0, 0, 0.68);
      }
      .scope-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 8px;
        margin-block: 14px;
      }
      .scope-list label {
        line-height: 1.4;
      }
      .editor {
        margin-block: 24px;
        padding-block: 16px;
        border-top: 1px solid rgba(0, 0, 0, 0.12);
      }
      .editor-fields {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
        max-width: 720px;
      }
      .field {
        display: grid;
        gap: 5px;
        font-size: 13px;
      }
      .toolbar,
      .row-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .muted {
        color: rgba(0, 0, 0, 0.66);
      }
      @media (max-width: 820px) {
        .integration-layout {
          grid-template-columns: 1fr;
        }
        .client-row {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class McpIntegrationsComponent implements OnInit {
  private readonly api = inject(SecurityApi);
  readonly clients = signal<McpClientRegistration[]>([]);
  readonly config = signal<McpPublicConfig | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly allowed = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly scopeOptions = MCP_SCOPES;
  editing = signal<string | null>(null);
  clientId = '';
  displayName = '';
  enabled = true;
  scopes: McpScope[] = ['mcp'];

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const catalog = await this.api.catalog();
      this.allowed.set(catalog.effective.includes('mcp-clients:manage'));
      if (!this.allowed()) return;
      const [clients, config] = await Promise.all([this.api.mcpClients(), this.api.mcpPublicConfig()]);
      this.clients.set(clients);
      this.config.set(config);
    } catch (failure) {
      this.handle(failure);
    } finally {
      this.loading.set(false);
    }
  }

  beginCreate(): void {
    this.editing.set(null);
    this.clientId = '';
    this.displayName = '';
    this.enabled = true;
    this.scopes = ['mcp'];
    this.error.set(null);
  }
  beginEdit(client: McpClientRegistration): void {
    this.editing.set(client.clientId);
    this.clientId = client.clientId;
    this.displayName = client.displayName;
    this.enabled = client.enabled;
    this.scopes = [...client.scopes];
    this.error.set(null);
  }
  toggleScope(scope: McpScope, checked: boolean): void {
    if (scope === 'mcp') return;
    this.scopes = checked ? [...new Set([...this.scopes, scope])] : this.scopes.filter(value => value !== scope);
  }
  hasScope(scope: McpScope): boolean {
    return this.scopes.includes(scope);
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    if (!this.scopes.includes('mcp')) {
      this.error.set('El alcance base `mcp` es obligatorio.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const draft: McpClientRegistration = {
        clientId: this.clientId.trim(),
        displayName: this.displayName.trim(),
        enabled: this.enabled,
        scopes: [...this.scopes]
      };
      const item = this.editing() ? await this.api.updateMcpClient(draft) : await this.api.createMcpClient(draft);
      this.notice.set(`Cliente ${item.displayName} guardado. AutoNexus no almacena el client secret.`);
      this.beginCreate();
      await this.load();
    } catch (failure) {
      this.handle(failure);
    } finally {
      this.saving.set(false);
    }
  }

  async setEnabled(client: McpClientRegistration, value: boolean): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.api.setMcpClientEnabled(client.clientId, value);
      this.notice.set(value ? 'Cliente MCP habilitado.' : 'Cliente MCP suspendido; las nuevas llamadas se rechazan.');
      await this.load();
    } catch (failure) {
      this.handle(failure);
    } finally {
      this.saving.set(false);
    }
  }

  async revoke(client: McpClientRegistration): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.api.revokeMcpClient(client.clientId);
      this.notice.set('Acceso del cliente revocado.');
      await this.load();
    } catch (failure) {
      this.handle(failure);
    } finally {
      this.saving.set(false);
    }
  }

  statusLabel(config: McpPublicConfig | null): string {
    switch (config?.endpointReachability) {
      case 'not_configured':
        return 'Endpoint no configurado';
      case 'local_or_private':
        return 'Solo local o privado · ChatGPT cloud no puede alcanzarlo';
      case 'https_configured_unverified':
        return 'HTTPS configurado · alcance público no verificado';
      case 'not_public_https':
        return 'No es un endpoint HTTPS público';
      default:
        return 'Estado no disponible';
    }
  }

  private handle(failure: unknown): void {
    const code = (failure as EmployeesFailure)?.failure?.code ?? 'SERVICE_UNAVAILABLE';
    this.error.set(ERROR_TEXT[code] ?? 'No se pudo completar la operación. Actualizá los datos e intentá de nuevo.');
  }
}
