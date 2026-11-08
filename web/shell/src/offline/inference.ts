export interface ModelMetadata {
  modelVersion: string;
  runId: string;
  labels: string[];
  qualityStatus: string;
  thresholds: Record<string, number>;
}

interface Asset { url: string; bytes: number; sha256: string }
interface ModelIndex extends ModelMetadata {
  schemaVersion: number;
  modelUrl: string;
  runtime: { version: string; url: string; sha256: string };
  files: Asset[];
}
interface Tensor {
  shape: number[];
  data(): Promise<Float32Array>;
  dispose(): void;
}
interface GraphModel { executeAsync(input: Tensor): Promise<Tensor | Tensor[]>; dispose(): void }
interface TensorFlow {
  version: { tfjs: string };
  ready(): Promise<void>;
  getBackend(): string;
  loadGraphModel(handler: { load(): Promise<unknown> }): Promise<GraphModel>;
  tensor4d(values: Float32Array, shape: number[]): Tensor;
}

const BASE = '/offline-model/';
const SIZE = 224;

async function antialiasResize(imageData: ImageData, width: number, height: number, size: number): Promise<Float32Array> {
  const source = imageData.data;
  const scaleX = width / size;
  const scaleY = height / size;
  const supportX = scaleX < 1 ? 1 : scaleX;
  const supportY = scaleY < 1 ? 1 : scaleY;
  const horizontal = new Float32Array(height * size * 3);

  for (let y = 0; y < height; y++) {
    if (y % 8 === 0) await yieldTask();
    for (let x = 0; x < size; x++) {
      const center = (x + 0.5) * scaleX - 0.5;
      const left = Math.floor(center - supportX + 0.5);
      const right = Math.ceil(center + supportX - 0.5);
      let weightSum = 0;
      let r = 0, g = 0, b = 0;
      for (let sample = left; sample <= right; sample++) {
        const clamped = Math.min(width - 1, Math.max(0, sample));
        const distance = Math.abs(sample - center);
        if (distance > supportX) continue;
        const weight = 1 - distance / supportX;
        if (weight <= 0) continue;
        const index = (y * width + clamped) * 4;
        r += source[index] * weight;
        g += source[index + 1] * weight;
        b += source[index + 2] * weight;
        weightSum += weight;
      }
      const target = (y * size + x) * 3;
      horizontal[target] = weightSum ? r / weightSum : 0;
      horizontal[target + 1] = weightSum ? g / weightSum : 0;
      horizontal[target + 2] = weightSum ? b / weightSum : 0;
    }
  }

  const output = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    if (y % 8 === 0) await yieldTask();
    const center = (y + 0.5) * scaleY - 0.5;
    const top = Math.floor(center - supportY + 0.5);
    const bottom = Math.ceil(center + supportY - 0.5);
    const rows = [];
    const weights = [];
    let weightSum = 0;
    for (let sample = top; sample <= bottom; sample++) {
      const distance = Math.abs(sample - center);
      if (distance > supportY) continue;
      const weight = 1 - distance / supportY;
      if (weight <= 0) continue;
      rows.push(Math.min(height - 1, Math.max(0, sample)));
      weights.push(weight);
      weightSum += weight;
    }
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let index = 0; index < rows.length; index++) {
        const offset = (rows[index] * size + x) * 3;
        r += horizontal[offset] * weights[index];
        g += horizontal[offset + 1] * weights[index];
        b += horizontal[offset + 2] * weights[index];
      }
      const divisor = weightSum || 1;
      const target = (y * size + x) * 3;
      output[target] = r / divisor / 127.5 - 1;
      output[target + 1] = g / divisor / 127.5 - 1;
      output[target + 2] = b / divisor / 127.5 - 1;
    }
  }
  return output;
}
const RUNTIME_HASH = 'cb03f6ad0f992376dcc735dc3426901477ca05c434e0321f072b94869a7cc2bd';
const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
let scriptPromise: Promise<TensorFlow> | undefined;
let modelPromise: Promise<{ metadata: ModelMetadata; model: GraphModel; tf: TensorFlow }> | undefined;

async function hash(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('Offline model missing: ' + url);
  return response.arrayBuffer();
}

function loadRuntime(): Promise<TensorFlow> {
  if (!scriptPromise) {
    scriptPromise = new Promise<TensorFlow>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = BASE + 'vendor/tf.min.js';
      script.async = true;
      script.integrity = 'sha256-' + btoa(String.fromCharCode(...Uint8Array.from(RUNTIME_HASH.match(/../g)!, (part) => parseInt(part, 16))));
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        const tf = (globalThis as typeof globalThis & { tf?: TensorFlow }).tf;
        if (!tf || tf.version.tfjs !== '4.20.0') reject(new Error('Offline TFJS runtime missing or incompatible'));
        else resolve(tf);
      };
      script.onerror = () => { script.remove(); reject(new Error('Offline TFJS runtime missing or corrupt')); };
      document.head.append(script);
    }).catch((error: unknown) => { scriptPromise = undefined; throw error; });
  }
  return scriptPromise;
}

async function loadModel() {
  const index = JSON.parse(new TextDecoder().decode(await getBytes(BASE + 'index.json'))) as ModelIndex;
  if (index.schemaVersion !== 1 || index.modelVersion !== 'automotive-damage-mobilenetv2-v1' ||
      index.runId !== '20261101T-with-negatives' ||
      JSON.stringify(index.labels) !== '["crack","dent","glass_shatter","scratch"]' ||
      index.qualityStatus !== 'experimental' || index.modelUrl !== BASE + 'tfjs/model.json' ||
      index.runtime?.version !== '4.20.0' || index.runtime.url !== BASE + 'vendor/tf.min.js' ||
      index.runtime.sha256 !== RUNTIME_HASH || !Array.isArray(index.files) || index.files.length > 64) {
    throw new Error('Offline model metadata corrupt or unsupported');
  }
  const assets = new Map<string, ArrayBuffer>();
  for (const entry of index.files) {
    if (!/^\/offline-model\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(entry.url) ||
        entry.url.includes('..') || assets.has(entry.url) || !Number.isSafeInteger(entry.bytes) ||
        entry.bytes <= 0 || entry.bytes > 32 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error('Offline model asset index corrupt');
    }
    const bytes = await getBytes(entry.url);
    if (bytes.byteLength !== entry.bytes || await hash(bytes) !== entry.sha256) throw new Error('Offline model asset corrupt: ' + entry.url);
    assets.set(entry.url, bytes);
  }
  const json = (path: string) => {
    const bytes = assets.get(BASE + path);
    if (!bytes) throw new Error('Offline model asset missing: ' + path);
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  const manifest = json('manifest.json');
  if (!manifest.thresholds || index.labels.some(name => typeof manifest.thresholds[name] !== 'number'
    || !Number.isFinite(manifest.thresholds[name]) || manifest.thresholds[name] < 0 || manifest.thresholds[name] > 1)) {
    throw new Error('Offline model thresholds corrupt');
  }
  const quality = json('quality.json');
  if (manifest.modelVersion !== index.modelVersion || manifest.runId !== index.runId ||
      JSON.stringify(manifest.labels) !== JSON.stringify(index.labels) || quality.status !== index.qualityStatus ||
      JSON.stringify(manifest.preprocessing?.inputSize) !== '[224,224]' || manifest.preprocessing?.colorMode !== 'RGB' ||
      manifest.preprocessingFingerprint !== '8e1557df3dcdd725088da336d732849196cbac46804776849c62abc58bcf32f8') {
    throw new Error('Offline model metadata mismatch');
  }
  const graph = json('tfjs/model.json');
  if (graph.format !== 'graph-model' || !Array.isArray(graph.weightsManifest) || !graph.weightsManifest.length) throw new Error('Offline graph corrupt');
  const weightSpecs: unknown[] = [];
  const chunks: ArrayBuffer[] = [];
  for (const group of graph.weightsManifest) {
    if (!Array.isArray(group.paths) || !group.paths.length || !Array.isArray(group.weights)) throw new Error('Offline graph weights corrupt');
    weightSpecs.push(...group.weights);
    for (const path of group.paths) {
      if (typeof path !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.bin$/.test(path)) throw new Error('Offline graph has nonlocal weights');
      const chunk = assets.get(BASE + 'tfjs/' + path);
      if (!chunk) throw new Error('Offline graph weight missing');
      chunks.push(chunk);
    }
  }
  const runtime = assets.get(index.runtime.url);
  if (!runtime || await hash(runtime) !== RUNTIME_HASH) throw new Error('Offline runtime corrupt');
  const tf = await loadRuntime();
  await tf.ready();
  if (!['webgl', 'cpu', 'webgpu'].includes(tf.getBackend())) throw new Error('No compatible local TensorFlow backend');
  const weightData = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { weightData.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }
  // A verified in-memory IOHandler prevents graph URLs or a second fetch from changing the weights.
  const model = await tf.loadGraphModel({ load: async () => ({ ...graph, weightSpecs, weightData: weightData.buffer }) });
  const metadata = { modelVersion: index.modelVersion, runId: index.runId, labels: [...index.labels], qualityStatus: index.qualityStatus, thresholds: { ...manifest.thresholds } };
  let input: Tensor | undefined;
  let outputs: Tensor[] = [];
  try {
    input = tf.tensor4d(new Float32Array(SIZE * SIZE * 3), [1, SIZE, SIZE, 3]);
    const result = await model.executeAsync(input);
    outputs = Array.isArray(result) ? result : [result];
    if (outputs.length !== 1 || outputs[0].shape.join(',') !== '1,4' ||
        Array.from(await outputs[0].data()).some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
      throw new Error('Offline model output incompatible');
    }
  } catch (error) { model.dispose(); throw error; }
  finally { input?.dispose(); outputs.forEach((tensor) => tensor.dispose()); }
  return { metadata, model, tf };
}

function prepared() {
  modelPromise ??= loadModel().catch((error: unknown) => { modelPromise = undefined; throw error; });
  return modelPromise;
}

export async function prepareModel(): Promise<ModelMetadata> {
  const { metadata } = await prepared();
  return { ...metadata, labels: [...metadata.labels], thresholds: { ...metadata.thresholds } };
}

function imageDimensions(bytes: ArrayBuffer): [number, number] {
  const view = new DataView(bytes);
  if (view.byteLength >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) {
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (view.byteLength >= 4 && view.getUint16(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset++) !== 0xff) break;
      while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset++;
      if (offset + 3 > view.byteLength) break;
      const marker = view.getUint8(offset++);
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > view.byteLength) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      offset += length;
    }
  }
  throw new Error('Use a valid JPEG or PNG photograph');
}

function checkDimensions(width: number, height: number) {
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 24_000_000) {
    throw new Error('Photograph exceeds 24 megapixels or 8192 pixels per side');
  }
  if (width < 32 || height < 32) throw new Error('Calidad insuficiente: mínimo 32 píxeles por lado. Retomá la imagen o registrá manualmente.');
}

export async function validatePhoto(blob: Blob): Promise<void> {
  if (!blob.size || blob.size > 5 * 1024 * 1024) throw new Error('Photograph must be between 1 byte and 5 MiB');
  checkDimensions(...imageDimensions(await blob.arrayBuffer()));
}

export function belowThresholds(labels: { name: string; score: number }[], thresholds: Record<string, number>): boolean {
  if (labels.some(label => !Number.isFinite(thresholds[label.name]))) throw new Error('Offline model thresholds corrupt');
  return labels.every(label => label.score < thresholds[label.name]!);
}

export function inspectionError(error: unknown): { reason: 'model_unavailable' | 'inference_failed' | 'insufficient_resources' | 'input_rejected'; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RangeError || /memory|alloc|resource|context lost|out of/i.test(message)) return { reason: 'insufficient_resources', message: 'Recursos insuficientes para la IA local. Cerrá otras tareas y reintentá.' };
  if (/model|runtime|backend|fetch/i.test(message) && !/output|scores/i.test(message)) return { reason: 'model_unavailable', message: 'Modelo local ausente, incompatible o dañado. Preparalo con conexión.' };
  if (/photograph|JPEG|PNG|calidad/i.test(message)) return { reason: 'input_rejected', message };
  return { reason: 'inference_failed', message: 'Falló la inferencia local. No se generó una predicción.' };
}

export async function inferPhoto(blob: Blob): Promise<{
  runId: string; modelVersion: string; imageSha256: string; labels: { name: string; score: number }[]; belowThresholds: boolean;
}> {
  if (!blob.size || blob.size > 5 * 1024 * 1024) throw new Error('Photograph must be between 1 byte and 5 MiB');
  const bytes = await blob.arrayBuffer();
  checkDimensions(...imageDimensions(bytes));
  const imageSha256 = await hash(bytes);
  const { metadata, model, tf } = await prepared();
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  let canvas: HTMLCanvasElement | undefined;
  let input: Tensor | undefined;
  let outputs: Tensor[] = [];
  try {
    checkDimensions(bitmap.width, bitmap.height);
    canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Photograph decoder canvas unavailable');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    canvas.width = canvas.height = 0;
    const values = await antialiasResize(pixels, bitmap.width, bitmap.height, SIZE);
    await yieldTask();
    input = tf.tensor4d(values, [1, SIZE, SIZE, 3]);
    const result = await model.executeAsync(input);
    outputs = Array.isArray(result) ? result : [result];
    if (outputs.length !== 1 || outputs[0].shape.join(',') !== '1,4') throw new Error('Offline model output incompatible');
    const scores = await outputs[0].data();
    if (scores.length !== metadata.labels.length || Array.from(scores).some((score) => !Number.isFinite(score) || score < 0 || score > 1)) throw new Error('Offline model returned invalid scores');
    return { runId: metadata.runId, modelVersion: metadata.modelVersion, imageSha256,
      belowThresholds: belowThresholds(metadata.labels.map((name, index) => ({ name, score: scores[index]! })), metadata.thresholds),
      labels: metadata.labels.map((name, index) => ({ name, score: scores[index] })) };
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    bitmap.close();
    input?.dispose();
    outputs.forEach((tensor) => tensor.dispose());
  }
}
