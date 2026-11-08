import type { SessionPort } from '../../../../contracts/auth/session';
import { openOfflineStore } from './store.ts';
import type { OfflineStore, PreparedWork, QueuedAdvance } from './store.ts';
import { prepareModel, inferPhoto, validatePhoto, inspectionError } from './inference.ts';
import { inspectionLabels, reviewDescription } from './review.ts';
import type { InspectionReview } from './review.ts';
import { syncPending } from './sync.ts';
import { createOfflineCopy, decodeOfflineCopy } from './transfer.ts';

/** Shell-owned CU27 workspace. Local scope is not an authenticated session. */
export class OfflineWorkspace {
  private store!: OfflineStore;
  private subject: string | null = null;
  private prepared: PreparedWork[] = [];
  private busy = false;
  private image?: Blob;
  private prediction?: Awaited<ReturnType<typeof inferPhoto>>;
  private revision = false;
  private reviewReason: InspectionReview['reason'] = 'operator_manual';
  private readonly infer: typeof inferPhoto;
  private requestEpoch = 0;
  private sessionEpoch = 0;
  private sessionKey = '';
  private draftAssignmentId = '';

  private readonly host: HTMLElement;
  private readonly session: SessionPort;
  constructor(host: HTMLElement, session: SessionPort, ports: { infer?: typeof inferPhoto } = {}) { this.host = host; this.session = session; this.infer = ports.infer ?? inferPhoto; }

  async start(): Promise<void> {
    this.store = await openOfflineStore();
    this.subject = await this.store.localSubject();
    if (this.subject) await this.store.recoverInterrupted(this.subject);
    this.host.innerHTML =
      '<h1>Trabajo sin conexión</h1>' +
      '<p>Prepará un trabajo autorizado antes de perder la red. El modelo es opcional: siempre podés registrar una inspección manual. Guardar localmente no confirma cambios en el servidor.</p>' +
      '<p id="offline-status" role="status" aria-live="polite"></p><p id="offline-account"></p>' +
      '<label for="offline-day">Día del trabajo (zona del taller)</label><input id="offline-day" type="date" required><div class="offline-actions"><button type="button" id="offline-download">Descargar trabajos autorizados</button><button type="button" id="offline-model">Preparar modelo local</button><button type="button" id="offline-forget">Descartar copia local</button></div>' +
      '<div id="offline-available"></div>' +
      '<details id="offline-transfer"><summary>Trasladar esta copia local</summary><p>El archivo contiene trabajos y fotografías privados, sin tokens. Guardalo solo en este equipo; no lo publiques ni lo adjuntes al chat. Exportar no borra la copia de origen. Importar requiere la misma cuenta autenticada y un destino sin datos.</p><button type="button" id="offline-export">Exportar copia local</button><label for="offline-import">Importar copia local en esta cuenta</label><input id="offline-import" type="file" accept="application/json,.json"></details>' +
      '<h2>Trabajo preparado</h2><label for="offline-work">Elegí el trabajo descargado</label><select id="offline-work"><option value="">Todavía no hay trabajo preparado</option></select><p id="offline-work-info"></p>' +
      '<form id="offline-form"><label for="offline-description">Descripción del avance</label><textarea id="offline-description" required minlength="3" maxlength="2000" rows="3"></textarea>' +
      '<label for="offline-minutes">Minutos trabajados</label><input id="offline-minutes" type="number" min="1" max="1440" step="1" value="15" required>' +
      '<label for="offline-photo">Fotografía (cámara o archivo, JPEG/PNG hasta 5 MiB)</label><input id="offline-photo" type="file" accept="image/jpeg,image/png" capture="environment">' +
      '<img id="offline-preview" alt="Fotografía pendiente de evidencia" hidden><p id="offline-model-status">Modelo local: todavía no comprobado. Capacidad visual NO validada.</p>' +
      '<button type="button" id="offline-infer" disabled>Inferir en este dispositivo</button><div id="offline-scores"></div>' +
      '<label class="offline-check"><input type="checkbox" id="offline-review"> Registrar mi revisión humana por separado</label><fieldset id="offline-labels" hidden><legend>Etiquetas de mi revisión (ninguna: no concluyente)</legend></fieldset>' +
      '<button type="submit" id="offline-save">Guardar avance pendiente</button></form>' +
      '<h2>Cola de sincronización</h2><p>Conflictos y rechazos se conservan para revisión; no se borran ni se reenvían con otro identificador.</p>' +
      '<button type="button" id="offline-sync">Sincronizar pendientes</button><ul id="offline-queue"></ul>';
    this.el<HTMLButtonElement>('offline-download').onclick = () => void this.run(() => this.download());
    const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const datePart = (type: string) => dateParts.find(item=>item.type===type)!.value;
    this.el<HTMLInputElement>('offline-day').value=datePart('year')+'-'+datePart('month')+'-'+datePart('day');
    this.el<HTMLButtonElement>('offline-model').onclick = () => void this.run(async () => {
      let model;
      try {
        const worker = await this.ensureResources(true);
        model = await prepareModel();
        if (navigator.serviceWorker.controller !== worker) throw new Error('El controlador offline cambió. Volvé a preparar el modelo.');
      } catch (error) {
        const failure = inspectionError(error); this.reviewReason = failure.reason;
        this.el('offline-model-status').textContent = failure.message;
        throw new Error(failure.message + ' La revisión manual sigue disponible.');
      }
      this.el('offline-model-status').textContent = 'Modelo preparado: ' + model.modelVersion + ' · ' + model.runId + '. Capacidad visual NO validada.';
      this.notice('Recursos y modelo disponibles sin red.');
    });
    this.el<HTMLButtonElement>('offline-forget').onclick = () => void this.run(async () => {
      if (!this.subject || !confirm('Se descartarán trabajos, fotografías y pendientes locales de esta cuenta. ¿Continuar?')) return;
      await this.store.forget(this.subject); this.subject = null; this.resetDraft();
      this.notice('Copia local descartada.'); await this.refresh();
    });
    this.el<HTMLButtonElement>('offline-export').onclick = () => void this.run(async () => {
      const subject=this.subject; const epoch=this.sessionEpoch;
      const actor=this.session.snapshot().identity?.subject;
      if(!subject || (actor && actor!==subject)) throw new Error('La copia no pertenece a esta cuenta.');
      const copy=await createOfflineCopy(this.store,subject,location.origin);
      if(epoch!==this.sessionEpoch || subject!==this.subject) throw new Error('La cuenta cambió durante la exportación. Volvé a intentar.');
      const url=URL.createObjectURL(copy); const link=document.createElement('a');
      link.href=url; link.download='autonexus-local-copy.private.json'; link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      this.notice('Copia privada exportada. La fotografía y la cola originales siguen en este navegador.');
    });
    this.el<HTMLInputElement>('offline-import').onchange = () => void this.run(async () => {
      const file=this.el<HTMLInputElement>('offline-import').files?.[0]; if(!file)return;
      await this.importCopy(file);
      this.notice('Copia trasladada: se conservaron los identificadores, archivos, versiones y estados. Todavía debe sincronizarse con autorización del servidor.');
      this.el<HTMLInputElement>('offline-import').value='';
    });
    this.el<HTMLSelectElement>('offline-work').onchange = () => this.changeWork();
    for (const name of inspectionLabels) {
      const label = document.createElement('label'); label.className = 'offline-check';
      const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'human-label'; input.value = name;
      label.append(input, document.createTextNode(name)); this.el('offline-labels').append(label);
    }
    this.el<HTMLInputElement>('offline-photo').onchange = () => void this.run(async () => {
      const file = this.el<HTMLInputElement>('offline-photo').files?.[0];
      if (!file) { this.resetPhoto(); return; }
      const epoch = this.sessionEpoch;
      if (!['image/jpeg', 'image/png'].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024) { if (!this.image) this.reviewReason = 'input_rejected'; this.notice('Elegí una fotografía JPEG o PNG de hasta 5 MiB. La foto anterior se conserva si había una.'); return; }
      try { await validatePhoto(file); } catch (error) { if (!this.image && epoch === this.sessionEpoch) this.reviewReason = 'input_rejected'; throw error; }
      if (epoch !== this.sessionEpoch) return;
      this.resetPhoto();
      this.image = file;
      const preview = this.el<HTMLImageElement>('offline-preview'); preview.src = URL.createObjectURL(file); preview.hidden = false;
      this.el<HTMLButtonElement>('offline-infer').disabled = false;
    });
    this.el<HTMLButtonElement>('offline-infer').onclick = () => void this.run(async () => {
      if (!this.image) return;
      const image = this.image;
      const prediction = await this.analyzePhoto(image);
      if (!prediction) return;
      if (this.image !== image) throw new Error('La fotografía cambió durante la inferencia. Volvé a analizar la imagen seleccionada.');
      this.prediction = prediction;
      const area = this.el('offline-scores'); area.replaceChildren();
      this.reviewReason = prediction.belowThresholds ? 'below_thresholds' : 'operator_manual';
      for (const item of this.prediction.labels) {
        const score = document.createElement('p'); score.textContent = item.name + ': ' + (item.score * 100).toFixed(1) + '%'; area.append(score);

      }
      this.el('offline-model-status').textContent = 'Inferencia local · ' + this.prediction.runId + ' · Capacidad visual NO validada. No es un diagnóstico.';
      this.notice(prediction.belowThresholds ? 'No concluyente: ninguna etiqueta alcanza su umbral experimental; no descarta daño. Registrá tu interpretación humana.' : 'Inferencia realizada localmente; todavía no enviada.');
    });
    this.el<HTMLInputElement>('offline-review').onchange = () => { this.revision = this.el<HTMLInputElement>('offline-review').checked; this.el('offline-labels').hidden = !this.revision; this.el<HTMLTextAreaElement>('offline-description').maxLength = this.revision ? 1600 : 2000; };
    this.el<HTMLFormElement>('offline-form').onsubmit = event => { event.preventDefault(); void this.run(() => this.save()); };
    this.el<HTMLButtonElement>('offline-sync').onclick = () => void this.run(async () => {
      const actor = this.session.snapshot().identity?.subject;
      if (!actor || !this.session.snapshot().authenticated || actor !== this.subject) throw new Error('Restablecé la sesión de la cuenta propietaria antes de sincronizar.');
      const result = await syncPending(this.store, this.session, actor);
      this.notice(result.applied + ' confirmado(s), ' + result.pending + ' pendiente(s), ' + result.failed + ' en conflicto o rechazado(s).');
      await this.refresh();
    });
    this.session.subscribe(snapshot => {
      const key=String(snapshot.authenticated)+':'+(snapshot.identity?.subject ?? '');
      if(key!==this.sessionKey){this.sessionKey=key;this.sessionEpoch++;}
      void this.refresh().catch(() => this.notice('No se pudo leer la copia local.'));
    });
    await this.refresh();
  }

  private async analyzePhoto(image: Blob): Promise<Awaited<ReturnType<typeof inferPhoto>> | undefined> {
    const epoch = this.sessionEpoch;
    try {
      const result = await this.infer(image);
      return image === this.image && epoch === this.sessionEpoch ? result : undefined;
    } catch (error) {
      if (image !== this.image || epoch !== this.sessionEpoch) return;
      const failure = inspectionError(error); this.reviewReason = failure.reason;
      this.el('offline-model-status').textContent = failure.message;
      throw new Error(failure.message + ' Podés reintentar o registrar una revisión manual.');
    }
  }
  private el<T extends HTMLElement = HTMLElement>(id: string): T { return this.host.querySelector<T>('#' + id)!; }
  async clearForLogout(): Promise<boolean> {
    const store = this.store ?? await openOfflineStore();
    const subject = this.session.snapshot().identity?.subject;
    if (subject) {
      const queue = await store.queue(subject);
      if (queue.some(item=>item.state!=='applied') && !confirm('Cerrar sesión descartará fotos y pendientes locales de esta cuenta. ¿Continuar?')) return false;
      await store.forget(subject);
      if (this.subject===subject) { this.subject=null; if(this.store) { this.resetDraft(); await this.refresh(); } }
    }
    return true;
  }
  private notice(message: string): void { this.el('offline-status').textContent = message; }
  private async importCopy(file: Blob): Promise<void> {
    const snapshot=this.session.snapshot(); const subject=snapshot.identity?.subject; const epoch=this.sessionEpoch;
    if(!snapshot.authenticated || !subject) throw new Error('Restablecé la sesión de la cuenta propietaria para importar.');
    const copy=await decodeOfflineCopy(file,subject);
    if(epoch!==this.sessionEpoch || this.session.snapshot().identity?.subject!==subject) throw new Error('La cuenta cambió; no se importó la copia.');
    const guard = () => {
      const current=this.session.snapshot();
      if(epoch!==this.sessionEpoch || !current.authenticated || current.identity?.subject!==subject) {
        throw new Error('La cuenta cambió; la copia permanece ligada a su propietario y no se muestra a esta sesión.');
      }
    };
    await this.store.restoreCopy(copy); guard();
    await this.store.recoverInterrupted(subject); guard();
    this.subject=subject; await this.refresh();
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.host.setAttribute('aria-busy', 'true');
    const controls = Array.from(this.host.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('button,input,select,textarea'));
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try { await action(); } catch (error) { this.notice(error instanceof Error ? error.message : 'No se pudo completar la acción; la cola local se conserva.'); }
    finally { this.busy = false; this.host.setAttribute('aria-busy', 'false'); controls.forEach((control,index) => { control.disabled = disabled[index]!; }); this.el<HTMLButtonElement>('offline-infer').disabled = !this.image; }
  }
  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const result = await this.session.requestBusiness(query, variables);
    if (result.errors?.length) throw new Error(result.errors[0]!.code + ': ' + result.errors[0]!.message);
    if (!result.data) throw new Error('Respuesta de negocio incompleta.');
    return result.data as T;
  }
  private async adoptSubject(): Promise<string> {
    const actor = this.session.snapshot().identity?.subject;
    if (!actor || !this.session.snapshot().authenticated) throw new Error('Ingresá con conexión para preparar el trabajo.');
    if (this.subject && this.subject !== actor) {
      const queue = await this.store.queue(this.subject);
      if (!confirm('Esta sesión es de otra cuenta. La copia anterior tiene ' + queue.filter(item => item.state !== 'applied').length + ' pendiente(s). ¿Descartar esa copia para cambiar de cuenta?')) throw new Error('Cambio cancelado. La copia anterior se conserva y no se muestra a esta cuenta.');
      await this.store.forget(this.subject); this.resetDraft();
    }
    this.subject = actor; await this.store.setLocalSubject(actor); return actor;
  }
  private async download(): Promise<void> {
    const actor = await this.adoptSubject();
    const date = this.el<HTMLInputElement>('offline-day').value;
    if (!date) throw new Error('Elegí el día del trabajo antes de descargar.');
    const result = await this.query<{myAgenda:{items:{assignmentId:string;orderNumber:string;executionStatus:string}[]}}>('query OfflineAgenda($from:Date!,$to:Date!){myAgenda(from:$from,to:$to,limit:50){items{assignmentId orderNumber executionStatus}}}', { from: date, to: date });
    if (this.session.snapshot().identity?.subject !== actor) throw new Error('La cuenta cambió durante la descarga.');
    const list = this.el('offline-available'); list.replaceChildren();
    for (const work of result.myAgenda.items) {
      const line = document.createElement('p'); line.textContent = work.orderNumber + ' · ' + work.executionStatus + ' ';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Preparar ' + work.orderNumber;
      button.disabled = work.executionStatus !== 'in_progress';
      button.onclick = () => void this.run(async () => {
        const { myExecution: execution } = await this.query<{myExecution:{orderId:string;orderNumber:string;assignmentId:string;version:number;status:string}}>('query PrepareOffline($id:UUID!){myExecution(assignmentId:$id){orderId orderNumber assignmentId version status}}',{id:work.assignmentId});
        if (execution.status !== 'in_progress' || this.session.snapshot().identity?.subject !== actor) throw new Error('El trabajo no es editable o la cuenta cambió.');
        await this.ensureResources();
        if (this.session.snapshot().identity?.subject !== actor) throw new Error('La cuenta cambió durante la preparación.');
        const now = new Date();
        await this.store.saveWork({ subject: actor, assignmentId: execution.assignmentId, orderId: execution.orderId, orderNumber: execution.orderNumber, version: execution.version, preparedAt: now.toISOString(), expiresAt: new Date(now.getTime()+7*86400000).toISOString() });
        this.notice('Trabajo preparado para usar sin conexión. La revisión manual está disponible sin modelo.'); await this.refresh();
      });
      line.append(button); list.append(line);
    }
    this.notice(result.myAgenda.items.length ? 'Seleccioná un trabajo en ejecución para prepararlo.' : 'No hay trabajos autorizados para el día del taller.');
  }
  private async ensureResources(requireModel = false): Promise<ServiceWorker | undefined> {
    if (!('serviceWorker' in navigator)) throw new Error('El navegador no admite preparación offline.');
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ready = await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Los recursos offline no terminaron de descargarse.')), 60000); })]).finally(() => clearTimeout(timer));
    if (!registration.active && !ready.active) throw new Error('La aplicación todavía no está preparada sin red.');
    if (requireModel) {
      const unavailable = () => new Error('No se pudo conservar el modelo para usarlo sin red. La revisión manual sigue disponible; comprobá los artefactos y el espacio antes de reintentar.');
      const serviceWorker = navigator.serviceWorker;
      if (!serviceWorker.controller) await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timeout); serviceWorker.removeEventListener('controllerchange', changed); };
        const changed = () => { if (serviceWorker.controller) { cleanup(); resolve(); } };
        const timeout = setTimeout(() => { cleanup(); reject(unavailable()); }, 15000);
        serviceWorker.addEventListener('controllerchange', changed); changed();
      });
      const worker = serviceWorker.controller;
      if (!worker) throw unavailable();
      if (worker.state === 'activating') await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timeout); worker.removeEventListener('statechange', changed); };
        const changed = () => {
          if (worker.state === 'activated') { cleanup(); resolve(); }
          else if (worker.state === 'redundant') { cleanup(); reject(unavailable()); }
        };
        const timeout = setTimeout(() => { cleanup(); reject(unavailable()); }, 15000);
        worker.addEventListener('statechange', changed); changed();
      });
      if (worker.state !== 'activated' || serviceWorker.controller !== worker) throw unavailable();
      await new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel();
        const requestId = crypto.randomUUID();
        const cleanup = () => {
          clearTimeout(timeout); serviceWorker.removeEventListener('controllerchange', changed);
          channel.port1.onmessage = null; channel.port1.onmessageerror = null;
          channel.port1.close(); channel.port2.close();
        };
        const fail = () => { cleanup(); reject(unavailable()); };
        const changed = () => { if (serviceWorker.controller !== worker) fail(); };
        const timeout = setTimeout(fail, 35000);
        serviceWorker.addEventListener('controllerchange', changed);
        channel.port1.onmessageerror = fail;
        channel.port1.onmessage = event => {
          const receipt = event.data;
          if (!receipt || Object.keys(receipt).sort().join(',') !== 'code,modelVersion,ok,protocol,requestId,runId,type,version'
            || receipt.type !== 'AUTONEXUS_MODEL_PREPARED' || receipt.protocol !== 1 || receipt.requestId !== requestId
            || receipt.ok !== true || receipt.code !== 'MODEL_CACHED' || typeof receipt.version !== 'string'
            || !/^[a-f0-9]{64}$/.test(receipt.version) || receipt.modelVersion !== 'automotive-damage-mobilenetv2-v1'
            || receipt.runId !== '20261101T-with-negatives' || serviceWorker.controller !== worker) { fail(); return; }
          cleanup(); resolve();
        };
        try { worker.postMessage({ type: 'AUTONEXUS_PREPARE_MODEL', protocol: 1, requestId }, [channel.port2]); } catch { fail(); }
      });
      return worker;
    }
  }
  private async refresh(): Promise<void> {
    if (!this.store) return;
    const request = ++this.requestEpoch;
    const actor = this.session.snapshot().identity?.subject;
    const wrongAccount = !!actor && !!this.subject && actor !== this.subject;
    this.el('offline-form').hidden = wrongAccount;
    if (wrongAccount) {
      this.resetDraft();
      this.el('offline-available').replaceChildren();
    }
    this.el('offline-account').textContent = wrongAccount ? 'Copia anterior oculta: la sesión pertenece a otra cuenta.' : this.subject ? 'Copia por usuario preparada en este navegador; sincronizar requiere la sesión de su propietario.' : 'Todavía no hay una copia preparada en este navegador.';
    const select = this.el<HTMLSelectElement>('offline-work'); const previous = select.value;
    const works = this.subject && !wrongAccount ? await this.store.works(this.subject) : [];
    const queue = this.subject && !wrongAccount ? await this.store.queue(this.subject) : [];
    if (request !== this.requestEpoch) return;
    this.prepared = works; select.replaceChildren();
    if (!works.length) select.append(Object.assign(document.createElement('option'), { value: '', textContent: 'Todavía no hay trabajo preparado' }));
    for (const work of works) select.append(Object.assign(document.createElement('option'), { value: work.assignmentId, textContent: work.orderNumber }));
    if (works.some(work => work.assignmentId === previous)) select.value = previous;
    else if (previous && this.draftAssignmentId === previous && this.hasDraft()) {
      // Losing a prepared entry must not silently attach its draft to the first remaining work.
      select.append(Object.assign(document.createElement('option'), { value: previous, textContent: 'Trabajo anterior no disponible · borrador conservado' }));
      select.value = previous;
    }
    this.showWork();
    const ul = this.el('offline-queue'); ul.replaceChildren();
    for (const item of queue) {
      const li = document.createElement('li');
      li.textContent = item.description + ' · ' + item.minutesWorked + ' min · ' + item.state + (item.lastCode ? ' · ' + item.lastCode : '') + (item.photo ? ' · foto local conservada' : '') + (item.clientInference?.humanReview ? ' · revisión humana conservada' : ''); ul.append(li);
    }
    if (!queue.length) ul.append(Object.assign(document.createElement('li'),{textContent:'Sin avances guardados en esta copia.'}));
  }
  private showWork(): void {
    if (!this.hasDraft()) this.draftAssignmentId = this.el<HTMLSelectElement>('offline-work').value;
    const work = this.prepared.find(item => item.assignmentId === this.el<HTMLSelectElement>('offline-work').value);
    this.el('offline-work-info').textContent = work ? 'Versión ' + work.version + ' · preparado ' + work.preparedAt + ' · vigente hasta ' + work.expiresAt + (Date.parse(work.expiresAt)<=Date.now() ? ' · vencido: revalidar con conexión antes de sincronizar' : '') : 'Descargá un trabajo autorizado antes de trabajar sin red.';
  }
  private hasDraft(): boolean {
    return !!(this.image || this.prediction || this.revision || this.el<HTMLTextAreaElement>('offline-description').value.trim()
      || this.el<HTMLInputElement>('offline-minutes').value !== '15');
  }
  private changeWork(): void {
    const select = this.el<HTMLSelectElement>('offline-work');
    if (select.value === this.draftAssignmentId) { this.showWork(); return; }
    if (this.hasDraft() && !confirm('El texto, la foto y la revisión sin guardar pertenecen al trabajo anterior. ¿Descartar ese borrador y cambiar de trabajo? Cancelar conserva el trabajo y todo su borrador.')) {
      select.value = this.draftAssignmentId; return;
    }
    this.resetDraft(); this.draftAssignmentId = select.value; this.showWork();
  }
  private resetDraft(): void {
    this.el<HTMLTextAreaElement>('offline-description').value = '';
    this.el<HTMLInputElement>('offline-minutes').value = '15';
    this.el<HTMLInputElement>('offline-photo').value = '';
    this.resetPhoto(); this.draftAssignmentId = '';
  }
  private resetPhoto(): void {
    const preview = this.el<HTMLImageElement>('offline-preview'); if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    preview.hidden = true; preview.removeAttribute('src'); this.image = undefined; this.prediction = undefined; this.revision = false; this.reviewReason = 'operator_manual';
    this.host.querySelectorAll<HTMLInputElement>('input[name="human-label"]').forEach(input => { input.checked = false; });
    this.el('offline-scores').replaceChildren(); this.el('offline-labels').hidden = true; this.el<HTMLInputElement>('offline-review').checked = false;
    this.el<HTMLTextAreaElement>('offline-description').maxLength = 2000;
    this.el<HTMLButtonElement>('offline-infer').disabled = true;
  }
  private async save(): Promise<void> {
    const work = this.prepared.find(item=>item.assignmentId===this.el<HTMLSelectElement>('offline-work').value);
    if (!work || !this.subject || work.subject !== this.subject) throw new Error('Primero seleccioná un trabajo preparado de esta cuenta.');
    if (this.draftAssignmentId && this.draftAssignmentId !== work.assignmentId) throw new Error('El borrador pertenece a otro trabajo. Volvé a seleccionarlo antes de guardar.');
    const actor = this.session.snapshot().identity?.subject;
    if (actor && actor !== this.subject) throw new Error('La copia local pertenece a otra cuenta.');
    const subject = this.subject;
    const epoch = this.sessionEpoch;
    const image = this.image;
    const prediction = this.prediction;
    const revision = this.revision;
    const humanLabels=Array.from(this.host.querySelectorAll<HTMLInputElement>('input[name="human-label"]:checked')).map(el=>el.value);
    const description = this.el<HTMLTextAreaElement>('offline-description').value.trim();
    const minutesWorked = Number(this.el<HTMLInputElement>('offline-minutes').value);
    const descriptionLimit = revision ? 1600 : 2000;
    if (description.length < 3 || description.length > descriptionLimit || !Number.isInteger(minutesWorked) || minutesWorked < 1 || minutesWorked > 1440) throw new Error('Descripción: 3–' + descriptionLimit + ' caracteres. Minutos: entero entre 1 y 1440.');
    const photoSha256 = image ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await image.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('') : undefined;
    if(epoch!==this.sessionEpoch || subject!==this.subject || image!==this.image || prediction!==this.prediction || this.el<HTMLSelectElement>('offline-work').value !== work.assignmentId) throw new Error('La cuenta o la fotografía cambió durante el guardado, o se seleccionó otro trabajo. No se creó un avance incompleto; verificá la cuenta y volvé a intentar.');
    const inspectionReview: InspectionReview | undefined = revision ? { schemaVersion: 1, mode: prediction ? 'assisted' : 'manual', reason: this.reviewReason, interpretation: description, labels: humanLabels, reviewedAt: new Date().toISOString() } : undefined;
    const inference = prediction ? { runId: prediction.runId, modelVersion: prediction.modelVersion, imageSha256: prediction.imageSha256, labels: prediction.labels, ...(revision ? {humanReview:{modelVersion:prediction.modelVersion,labels:humanLabels}} : {}) } : undefined;
    const item: QueuedAdvance = { operationId:crypto.randomUUID(), subject, assignmentId:work.assignmentId, baseVersion:work.version, description: inspectionReview ? reviewDescription(inspectionReview) : description, ...(inspectionReview ? { inspectionReview } : {}), minutesWorked, createdAt:new Date().toISOString(), state:'pending', ...(image?{photo:image,photoSha256}:{}), ...(inference?{clientInference:inference}:{}) };
    try { await this.store.enqueue(item); } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') throw new Error('Sin espacio local. No se guardó: conservamos el texto y la foto para reintentar después de liberar espacio.');
      throw error;
    }
    if (epoch !== this.sessionEpoch || subject !== this.subject || image !== this.image) return;
    this.resetDraft();
    this.notice('Avance, foto y revisión guardados localmente como pendientes; todavía no confirmados por el servidor.'); await this.refresh();
  }
}
