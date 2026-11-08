import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Space, Typography } from 'antd';
import { CONFIRM_DOCUMENT, DOWNLOAD_DOCUMENT, OPERATION, REQUEST_DOCUMENT, errorCode, ledgerError } from './ledger-api';
import { fileRequest } from './ledger-files';

export default function ExpenseDocument({ run, document, onDocument, onBusy, disabled, readOnly = false }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState(null);
  const intent = useRef(null);
  const lock = useRef(false);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const upload = async () => {
    if (lock.current || disabled || !intent.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError(null);
    const command = intent.current;
    try {
      if (command.confirmOnly) {
        try {
          const operation = (await run(OPERATION, { operationId: command.confirmId })).financialOperation;
          if (!alive.current) return;
          if (operation.outcome === 'rejected') { setRejection(operation.errorCode); return; }
          if (operation.outcome === 'applied') {
            const result = JSON.parse(operation.resultJson).document;
            onDocument(result); intent.current = null; setPending(false); onBusy(false); return;
          }
        } catch (failure) { if (errorCode(failure) !== 'OPERATION_NOT_FOUND') throw failure; }
      }
      if (!command.confirmOnly) {
        const result = (await run(REQUEST_DOCUMENT, { input: command.request })).requestExpenseDocument;
        if (!alive.current) return;
        command.documentId = result.document.id;
        command.target = result.upload;
        if (result.document.state === 'available') { onDocument(result.document); intent.current = null; setPending(false); onBusy(false); return; }
      }
      if (!command.confirmOnly) {
        const request = fileRequest(command.target, 'PUT');
        command.confirmOnly = true;
        try {
          await fetch(request.url, { ...request.options, body: command.file });
        } catch { /* Confirmation, not a transport acknowledgement, proves availability. */ }
      }
      const result = (await run(CONFIRM_DOCUMENT, { input: { operationId: command.confirmId, documentId: command.documentId } })).confirmExpenseDocument;
      if (!alive.current) return;
      if (result.state !== 'available') throw new Error('El servidor todavía no confirmó la disponibilidad del respaldo.');
      onDocument(result); intent.current = null; setPending(false); onBusy(false);
    } catch (failure) {
      if (alive.current) {
        setError(ledgerError(failure));
        if (!command.uncertain && !command.documentId && ['DOCUMENT_STORAGE_UNAVAILABLE', 'VALIDATION_ERROR', 'FORBIDDEN', 'DOCUMENT_TYPE_NOT_ALLOWED'].includes(errorCode(failure))) {
          intent.current = null; setPending(false); onBusy(false);
        } else { command.uncertain = true; setPending(true); }
      }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const choose = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || disabled || intent.current || lock.current) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) { setError('Adjuntá una imagen JPEG o PNG de hasta 5 MiB.'); return; }
    lock.current = true; setBusy(true); onBusy(true);
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      if (!alive.current) return;
      intent.current = { file, uncertain: false, confirmId: crypto.randomUUID(), request: { operationId: crypto.randomUUID(), fileName: file.name, contentType: file.type, sizeBytes: file.size, sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('') } };
      setPending(true);
    } catch (failure) { setError(ledgerError(failure)); onBusy(false); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
    if (intent.current) await upload();
  };
  const download = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const target = (await run(DOWNLOAD_DOCUMENT, { documentId: document.id })).expenseDocumentDownload;
      const request = fileRequest(target, 'GET');
      const response = await fetch(request.url, request.options);
      if (!response.ok) throw new Error('No se pudo descargar el respaldo. Solicitá un permiso nuevo.');
      const blob = await response.blob();
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      const anchor = globalThis.document.createElement('a');
      anchor.href = url; anchor.download = document.fileName; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) { if (alive.current) setError(ledgerError(failure)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <section aria-label="Respaldo documental" style={{ marginBottom: readOnly ? 0 : 16 }}>
    {!readOnly && <><Typography.Paragraph>Respaldo opcional · JPEG/PNG, hasta 5 MiB. Solo se adjunta después de la confirmación del servidor.</Typography.Paragraph>
      {!document && !pending && <label>Seleccionar respaldo <input type="file" accept="image/jpeg,image/png" disabled={disabled || busy} onChange={choose} /></label>}
      {pending && <Alert type="warning" title="Respaldo pendiente de confirmación. No se presume adjunto." description={<Space wrap><Typography.Text>Se conservan el archivo y las intenciones exactas durante esta sesión.</Typography.Text><Button disabled={disabled || busy} loading={busy} onClick={upload}>Reintentar y conciliar respaldo</Button></Space>} />}
      {rejection && <Alert type="error" title={`Confirmación rechazada por el servidor: ${rejection}`} description={<Space wrap>
        <Button disabled={disabled || busy} onClick={() => { intent.current.confirmId = crypto.randomUUID(); intent.current.confirmOnly = false; setRejection(null); void upload(); }}>Volver a subir con nueva confirmación</Button>
        <Button disabled={disabled || busy} onClick={() => { intent.current = null; setPending(false); setRejection(null); onBusy(false); }}>Continuar sin este respaldo rechazado</Button>
      </Space>} />}
    </>}
    {document && <Space wrap><Typography.Text>{document.fileName} · {document.state}</Typography.Text><Button disabled={busy} loading={busy} onClick={download}>Descargar respaldo</Button></Space>}
    {error && <Alert type="error" title={error} />}
  </section>;
}
