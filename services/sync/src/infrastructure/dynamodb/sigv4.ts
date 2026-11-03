/**
 * SigV4 signing for the DynamoDB JSON protocol.
 *
 * DynamoDB Local rejects unsigned requests ("Request must contain either a valid (authenticated) AWS
 * access key..."), and a hand-rolled signer is easy to get subtly wrong, so the well-tested `aws4`
 * package does the work. The credentials are configuration: for the local emulator any value is
 * accepted because the emulator does not verify the signature, and a real AWS table needs real keys.
 */
import aws4 from 'aws4';

export interface Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export interface SignedRequest {
  readonly headers: Record<string, string>;
}

export function signRequest(options: {
  readonly region: string;
  readonly service: string;
  readonly host: string;
  readonly path: string;
  readonly target: string;
  readonly body: string;
  readonly credentials: Credentials;
  readonly now?: Date;
}): SignedRequest {
  const request = {
    host: options.host,
    path: options.path,
    method: 'POST',
    service: options.service,
    region: options.region,
    headers: {
      'Content-Type': 'application/x-amz-json-1.0',
      'X-Amz-Target': options.target,
    },
    body: options.body,
  } as Parameters<typeof aws4.sign>[0];

  const signed = aws4.sign(request, {
    accessKeyId: options.credentials.accessKeyId,
    secretAccessKey: options.credentials.secretAccessKey,
    ...(options.credentials.sessionToken ? { sessionToken: options.credentials.sessionToken } : {}),
  });

  const forbidden = new Set(['host', 'content-length', 'connection']);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(signed.headers ?? {})) {
    // etch sets Host/Content-Length itself and rejects attempts to override them; the signature
    // still covers Host because the value it derives from the URL is the same one sent.
    if (typeof value === 'string' && !forbidden.has(key.toLowerCase())) headers[key] = value;
  }
  return { headers };
}
