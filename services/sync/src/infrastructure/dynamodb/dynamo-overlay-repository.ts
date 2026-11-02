/** DynamoDB single-table store for MS05 (intent, attempts, results). No credentials are stored. */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import type { Overlay, StoredOperation } from '../../domain/overlay.js';
import type { OverlayRepository } from '../../application/ports.js';

export interface DynamoConfiguration {
  readonly table: string;
  readonly region: string;
  readonly endpoint?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
}

export class DynamoOverlayRepository implements OverlayRepository {
  private readonly client: DynamoDBDocumentClient;

  constructor(
    private readonly configuration: DynamoConfiguration,
    client?: DynamoDBDocumentClient,
  ) {
    this.client =
      client ??
      DynamoDBDocumentClient.from(
        new DynamoDBClient({
          region: configuration.region,
          ...(configuration.endpoint ? { endpoint: configuration.endpoint } : {}),
          ...(configuration.accessKeyId && configuration.secretAccessKey
            ? { credentials: { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey } }
            : {}),
        }),
      );
  }

  async ready(): Promise<boolean> {
    try {
      await this.client.send(new GetCommand({ TableName: this.configuration.table, Key: { PK: 'HEALTH#probe', SK: 'probe' } }));
      return true;
    } catch (error) {
      return (error as { name?: string }).name === 'ResourceNotFoundException';
    }
  }

  /** Creates the table when it does not exist (DynamoDB Local has no migrations). */
  async ensureTable(): Promise<void> {
    const { CreateTableCommand, DescribeTableCommand } = await import('@aws-sdk/client-dynamodb');
    const raw = this.client.config.endpoint
      ? new DynamoDBClient({ region: this.configuration.region, endpoint: this.configuration.endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } })
      : new DynamoDBClient({ region: this.configuration.region });
    try {
      await raw.send(new DescribeTableCommand({ TableName: this.configuration.table }));
      return;
    } catch (error) {
      if ((error as { name?: string }).name !== 'ResourceNotFoundException') throw error;
    }
    await raw.send(
      new CreateTableCommand({
        TableName: this.configuration.table,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
      }),
    );
  }

  async save(overlay: Overlay, expiresAt: number): Promise<{ replayed: boolean }> {
    const existing = await this.byId(overlay.subject, overlay.overlayId);
    if (existing) return { replayed: true };
    const pk = this.partition(overlay.subject);
    await this.client.send(
      new PutCommand({
        TableName: this.configuration.table,
        Item: { PK: pk, SK: `OVERLAY#${overlay.overlayId}`, kind: 'overlay', overlayId: overlay.overlayId, subject: overlay.subject, deviceId: overlay.deviceId, createdAt: overlay.createdAt, expiresAt },
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
    await Promise.all(
      overlay.operations.map(operation =>
        this.client.send(
          new PutCommand({
            TableName: this.configuration.table,
            Item: { PK: pk, SK: `OP#${operation.operationId}`, kind: 'operation', overlayId: overlay.overlayId, subject: overlay.subject, state: 'pending', attempts: [], expiresAt, ...operation },
            ConditionExpression: 'attribute_not_exists(SK)',
          }),
        ),
      ),
    );
    return { replayed: false };
  }

  async byId(subject: string, overlayId: string): Promise<{ overlay: Overlay; operations: StoredOperation[] } | undefined> {
    const response = await this.client.send(
      new GetCommand({ TableName: this.configuration.table, Key: { PK: this.partition(subject), SK: `OVERLAY#${overlayId}` } }),
    );
    if (!response.Item) return undefined;
    const operations = await this.operationsByOverlay(subject, overlayId);
    return {
      overlay: { overlayId, subject, deviceId: String(response.Item['deviceId']), createdAt: String(response.Item['createdAt']), operations },
      operations,
    };
  }

  async operationsByOverlay(subject: string, overlayId: string): Promise<StoredOperation[]> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.configuration.table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': this.partition(subject), ':prefix': 'OP#' },
      }),
    );
    return (response.Items ?? [])
      .filter(item => item['overlayId'] === overlayId)
      .map(item => this.toOperation(item));
  }

  async operation(subject: string, operationId: string): Promise<StoredOperation | undefined> {
    const response = await this.client.send(
      new GetCommand({ TableName: this.configuration.table, Key: { PK: this.partition(subject), SK: `OP#${operationId}` } }),
    );
    return response.Item ? this.toOperation(response.Item) : undefined;
  }

  async update(operation: StoredOperation): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.configuration.table,
        Item: { PK: this.partition(operation.subject), SK: `OP#${operation.operationId}`, kind: 'operation', ...operation },
      }),
    );
  }

  private partition(subject: string): string {
    return `SUBJECT#${subject}`;
  }

  private toOperation(item: Record<string, unknown>): StoredOperation {
    return {
      operationId: String(item['operationId']),
      overlayId: String(item['overlayId']),
      subject: String(item['subject']),
      entity: item['entity'] as StoredOperation['entity'],
      target: item['target'] as StoredOperation['target'],
      baseVersion: Number(item['baseVersion']),
      dependsOn: (item['dependsOn'] as string[]) ?? [],
      payload: (item['payload'] as Record<string, unknown>) ?? {},
      ...(item['file'] ? { file: item['file'] as StoredOperation['file'] } : {}),
      ...(item['clientInference'] ? { clientInference: item['clientInference'] as StoredOperation['clientInference'] } : {}),
      state: item['state'] as StoredOperation['state'],
      attempts: (item['attempts'] as StoredOperation['attempts']) ?? [],
      ...(item['lastResult'] ? { lastResult: item['lastResult'] as StoredOperation['lastResult'] } : {}),
      ...(item['lastBody'] ? { lastBody: item['lastBody'] as Record<string, unknown> } : {}),
      expiresAt: Number(item['expiresAt'] ?? 0),
    };
  }
}
