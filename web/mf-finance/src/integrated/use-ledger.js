import { useCallback, useEffect, useRef, useState } from 'react';
import { OPERATION, errorCode, ledgerError } from './ledger-api';

export function useLedgerQuery(run, query, variables, enabled = true) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const key = JSON.stringify(variables);
  useEffect(() => {
    if (!enabled) return;
    let ignore = false;
    run(query, JSON.parse(key)).then(data => {
      if (!ignore) setState({ data, error: null, loading: false, key, revision });
    }).catch(error => {
      if (!ignore) setState({ data: null, error: ledgerError(error), loading: false, key, revision });
    });
    return () => { ignore = true; };
  }, [run, query, key, revision, enabled]);
  return { ...state, data: enabled && state.key === key && state.revision === revision ? state.data : null,
    loading: enabled && (state.key !== key || state.revision !== revision || state.loading), reload: () => setRevision(value => value + 1) };
}

export function useLedgerCommand(run, onApplied, onRejected) {
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const current = useRef(null);
  const lock = useRef(false);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const finish = (command, result, rejected = false) => {
    current.current = null;
    setPending(null);
    if (rejected) { setError(ledgerError(result)); onRejected?.(command, result); }
    else { setError(null); onApplied(command, result); }
  };
  const execute = async command => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const data = await run(command.query, command.variables);
      if (alive.current) finish(command, data[command.field]);
    } catch (failure) {
      if (!alive.current) return;
      setError(ledgerError(failure));
      // A refusal on retry cannot resolve an earlier uncertain submission.
      if (!command.uncertain && ['VALIDATION_ERROR', 'FORBIDDEN', 'UNAUTHENTICATED', 'GRAPHQL_VALIDATION_FAILED'].includes(errorCode(failure))) {
        current.current = null; setPending(null);
      } else command.uncertain = true;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const start = (query, variables, field) => {
    if (current.current || lock.current) return;
    const command = { query, field, uncertain: false, variables: { ...variables, input: { ...variables.input, operationId: crypto.randomUUID() } } };
    current.current = command;
    setPending(command);
    return execute(command);
  };
  const reconcile = async () => {
    const command = current.current;
    if (!command || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const data = await run(OPERATION, { operationId: command.variables.input.operationId });
      if (!alive.current) return;
      const operation = data.financialOperation;
      if (!['applied', 'rejected'].includes(operation.outcome)) throw new Error('La operación sigue sin resultado definitivo.');
      finish(command, JSON.parse(operation.resultJson), operation.outcome === 'rejected');
    } catch (failure) {
      if (alive.current) setError(errorCode(failure) === 'OPERATION_NOT_FOUND' ? 'Todavía no hay resultado confirmado. Conservá esta intención y reintentá el mismo envío.' : ledgerError(failure));
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return { pending, busy, error, start, reconcile, retry: () => current.current && execute(current.current) };
}

export function useLedgerRun(session) {
  return useCallback(async (query, variables = {}) => {
    const result = await session.requestBusiness(query, variables);
    if (result.errors?.length) throw result.errors[0];
    return result.data;
  }, [session]);
}
