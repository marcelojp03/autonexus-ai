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
          maxAttempts: 3,
          requestHandler: { requestTimeout: 4000, connectionTimeout: 3000 },
          ...(configuration.endpoint ? { endpoint: configuration.endpoint } : {}),
          // A local emulator ignores the signature but the SDK still needs credentials; without them
          // it falls back to the default provider chain.
          credentials: configuration.endpoint
            ? { accessKeyId: configuration.accessKeyId ?? 'local', secretAccessKey: configuration.secretAccessKey ?? 'local' }
            : configuration.accessKeyId && configuration.secretAccessKey
              ? { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey }
              : undefined,
        }),
      );
  }

  async ready(): Promise<boolean> {
    try {
      await this.client.send(new GetCommand({ TableName: this.configuration.table, Key: { PK: 'HEALTH#probe', SK: 'probe' } }));
      return true;
    } catch (error) {
      // A missing table still means the store answered.
      return (error as { name?: string }).name === 'ResourceNotFoundException';
    }
  }

  /** Creates the table when it does not exist (DynamoDB Local has no migrations). */
  async ensureTable(): Promise<void> {
    const { CreateTableCommand, DescribeTableCommand } = await import('@aws-sdk/client-dynamodb');
    const raw = new DynamoDBClient({
      region: this.configuration.region,
      maxAttempts: 3,
      requestHandler: { requestTimeout: 4000, connectionTimeout: 3000 },
      ...(this.configuration.endpoint ? { endpoint: this.configuration.endpoint } : {}),
      ...(this.configuration.endpoint
        ? { credentials: { accessKeyId: this.configuration.accessKeyId ?? 'local', secretAccessKey: this.configuration.secretAccessKey ?? 'local' } }
        : {}),
    });
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

  async save(overlay: Overlay, expiresAt: number): Promise<{ replayed: boolean; replayedOperations: string[] }> {
    const existing = await this.byId(overlay.subject, overlay.overlayId);
    if (existing) return { replayed: true, replayedOperations: [] };
    // An operation is global to the subject: a second overlay that declares the same operationId is
    // a replay of that operation, so the coordinator keeps the original record instead of writing a
    // duplicate row (the table key is OP#<operationId>).
    const replayedOperations: string[] = [];
    const fresh = [];
    for (const operation of overlay.operations) {
      const known = await this.operation(overlay.subject, operation.operationId);
      if (known) replayedOperations.push(operation.operationId);
      else fresh.push(operation);
    }
    const pk = this.partition(overlay.subject);
    await this.client.send(
      new PutCommand({
        TableName: this.configuration.table,
        Item: { PK: pk, SK: `OVERLAY#${overlay.overlayId}`, kind: 'overlay', overlayId: overlay.overlayId, subject: overlay.subject, deviceId: overlay.deviceId, createdAt: overlay.createdAt, expiresAt },
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
    await Promise.all(
      fresh.map(operation =>
        this.client.send(
          new PutCommand({
            TableName: this.configuration.table,
            Item: { PK: pk, SK: `OP#${operation.operationId}`, kind: 'operation', overlayId: overlay.overlayId, subject: overlay.subject, state: 'pending', attempts: [], expiresAt, ...operation },
            ConditionExpression: 'attribute_not_exists(SK)',
          }),
        ),
      ),
    );
    return { replayed: false, replayedOperations };
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
