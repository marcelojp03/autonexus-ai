import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Row, Space, Spin, Table, Tag, Typography } from 'antd';
import {
  ANALYSES, ANALYZE, EXECUTION, MODEL, PERMISSIONS, WORKS,
  canAnalyze, explain, labelText, percent, summary, workshopDate,
} from './vision-api.js';

const { Title, Paragraph, Text } = Typography;

const SIGNAL_NOTICE = 'Señal para revisión humana. No es un diagnóstico, una medición ni un presupuesto.';

function LabelTable({ analysis }) {
  const columns = [
    { title: 'Etiqueta', dataIndex: 'name', render: value => labelText(value) },
    { title: 'Puntaje', dataIndex: 'score', render: value => percent(value) + '%' },
    { title: 'Umbral', dataIndex: 'threshold', render: value => percent(value) + '%' },
    { title: 'Sobre umbral', dataIndex: 'flagged', render: value => <Tag color={value ? 'orange' : 'default'}>{value ? 'sí' : 'no'}</Tag> },
  ];
  return <Table rowKey="name" size="small" pagination={false} columns={columns} dataSource={[...(analysis?.labels ?? [])]} />;
}

function AnalysisCard({ analysis, title }) {
  return (
    <Card size="small" title={title ?? 'Análisis ' + String(analysis.analysisId).slice(0, 8)} style={{ marginBottom: 12 }}>
      <Paragraph style={{ marginBottom: 8 }}>
        <Text strong>{summary(analysis)}</Text>
      </Paragraph>
      <LabelTable analysis={analysis} />
      <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
        Modelo {analysis.modelVersion} · {new Date(analysis.createdAt).toLocaleString('es-BO')}
        {analysis.replayed ? ' · resultado ya guardado para esta imagen' : ''}
        {analysis.insufficientData ? ' · datos de evaluación insuficientes para la etiqueta' : ''}
      </Paragraph>
      <Paragraph type="warning" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>{SIGNAL_NOTICE}</Paragraph>
    </Card>
  );
}

export default function IntelligenceApp({ session }) {
  const [permissions, setPermissions] = useState(null);
  const [model, setModel] = useState(null);
  const [works, setWorks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [execution, setExecution] = useState(null);
  const [analyses, setAnalyses] = useState([]);
  const [latest, setLatest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const request = useRef(0);

  const query = useCallback(async (queryText, variables) => {
    const result = await session.requestBusiness(queryText, variables);
    if (result.errors?.length) throw result.errors[0];
    return result.data;
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const catalogue = await query(PERMISSIONS);
        if (cancelled) return;
        const effective = catalogue?.securityCatalog?.effective ?? [];
        setPermissions(effective);
        if (!effective.includes('intelligence:read')) return;
        const data = await query(MODEL);
        if (cancelled) return;
        setModel(data?.visionModel ?? null);
        const agenda = await query(WORKS, { from: workshopDate(new Date(), -30), to: workshopDate(), limit: 25 });
        if (cancelled) return;
        setWorks(agenda?.myAgenda?.items ?? []);
      } catch (failure) {
        if (!cancelled) setError(explain(failure));
      }
    })();
    return () => { cancelled = true; };
  }, [query]);

  const open = useCallback(async work => {
    const ticket = ++request.current;
    setSelected(work);
    setLatest(null);
    setError(null);
    setBusy(true);
    try {
      const [detail, history] = await Promise.all([
        query(EXECUTION, { assignmentId: work.assignmentId }),
        query(ANALYSES, { assignmentId: work.assignmentId }),
      ]);
      if (ticket !== request.current) return;
      setExecution(detail?.myExecution ?? null);
      setAnalyses(history?.assignmentAnalyses?.items ?? []);
    } catch (failure) {
      if (ticket === request.current) setError(explain(failure));
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  }, [query]);

  const analyze = useCallback(async evidence => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const data = await query(ANALYZE, { assignmentId: selected.assignmentId, evidenceId: evidence.id });
      const analysis = data?.analyzeEvidence;
      setLatest(analysis ?? null);
      const history = await query(ANALYSES, { assignmentId: selected.assignmentId });
      setAnalyses(history?.assignmentAnalyses?.items ?? []);
    } catch (failure) {
      setError(explain(failure));
    } finally {
      setBusy(false);
    }
  }, [query, selected]);

  // Deep link from the CU16 execution screen: /intelligence?assignmentId=<uuid>. The record is
  // still authorised by the owner on open; the parameter only selects which work to inspect.
  const deepLink = useMemo(() => new URLSearchParams(globalThis.location?.search ?? '').get('assignmentId'), []);
  const openedDeepLink = useRef(false);
  useEffect(() => {
    if (!deepLink || openedDeepLink.current || permissions === null || !permissions.includes('intelligence:read')) return;
    openedDeepLink.current = true;
    void open({ assignmentId: deepLink, orderId: null, executionStatus: 'in_progress' });
  }, [deepLink, open, permissions]);

  const evidences = useMemo(
    () => (execution?.advances ?? []).flatMap(advance => (advance.evidences ?? []).map(evidence => ({ ...evidence, advance: advance.sequence, description: advance.description }))),
    [execution],
  );
  const allowed = canAnalyze(permissions, model);

  if (error && permissions === null) return <Alert type="error" showIcon message="No se pudo cargar Inteligencia" description={error} />;
  if (permissions !== null && !permissions.includes('intelligence:read')) {
    return <Alert type="warning" showIcon message="Sin acceso a Inteligencia" description="Tu cuenta no tiene el permiso intelligence:read. Pedile a administración que revise tus roles." />;
  }

  return (
    <div data-testid="intelligence-app">
      <Title level={3} style={{ marginTop: 0 }}>Inteligencia visual</Title>
      <Paragraph type="secondary">
        Analiza las fotografías que el mecánico adjuntó a un avance y devuelve las etiquetas que el modelo reconoce. {SIGNAL_NOTICE}
      </Paragraph>

      {model && !model.ready ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Modelo no disponible (MODEL_NOT_READY)"
          description={'El servicio no tiene un artefacto de modelo cargado (' + String(model.reason ?? 'sin detalle') + '). No se generan puntajes hasta que el modelo esté disponible.'}
        />
      ) : null}
      {model?.ready ? (
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Modelo <Text code>{model.modelVersion}</Text> · etiquetas: {model.labels.map(labelText).join(', ')}
          {model.insufficientData ? ' · evaluación declarada insuficiente para alguna etiqueta' : ''}
        </Paragraph>
      ) : null}
      {error ? <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} closable onClose={() => setError(null)} /> : null}

      <Row gutter={16}>
        <Col xs={24} lg={9}>
          <Card size="small" title="Trabajos con evidencia (últimos 30 días)">
            {works.length === 0 ? <Empty description="No hay trabajos asignados con evidencia" /> : (
              <Space direction="vertical" style={{ width: '100%' }}>
                {works.map(work => (
                  <Button
                    key={work.assignmentId}
                    block
                    type={selected?.assignmentId === work.assignmentId ? 'primary' : 'default'}
                    onClick={() => void open(work)}
                    data-testid={'work-' + work.orderNumber}
                  >
                    {work.orderNumber} · {work.vehicle?.plate} · {work.executionStatus} · evidencias: {work.executionProgress?.availableEvidence ?? 0}
                  </Button>
                ))}
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={15}>
          <Card
            size="small"
            title={selected ? 'Evidencias de ' + selected.orderNumber : 'Elegí un trabajo'}
            extra={busy ? <Spin size="small" /> : null}
          >
            {!selected ? <Empty description="Elegí un trabajo para ver sus evidencias" /> : null}
            {selected && evidences.length === 0 && !busy ? <Empty description="Este trabajo no tiene evidencias confirmadas" /> : null}
            {evidences.map(evidence => (
              <Card key={evidence.id} size="small" style={{ marginBottom: 8 }} data-testid={'evidence-' + evidence.id}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Text strong>{evidence.fileName}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Avance {evidence.advance} · {evidence.contentType} · {evidence.sizeBytes} bytes · estado <Tag color={evidence.state === 'available' ? 'green' : 'default'}>{evidence.state}</Tag>
                  </Text>
                  <Button
                    type="primary"
                    size="small"
                    disabled={!allowed || evidence.state !== 'available'}
                    loading={busy}
                    onClick={() => void analyze(evidence)}
                    data-testid={'analyze-' + evidence.id}
                  >
                    Analizar imagen
                  </Button>
                </Space>
              </Card>
            ))}
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          {latest ? <AnalysisCard analysis={latest} title="Resultado del último análisis" /> : null}
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title={'Historial del trabajo (' + analyses.length + ')'}>
            {analyses.length === 0 ? <Empty description="Sin análisis guardados para este trabajo" /> : analyses.map(analysis => <AnalysisCard key={analysis.analysisId} analysis={analysis} />)}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
