import { useEffect, useRef, useState } from 'react';
import { ApiFailure, UnknownResult, errorMessage, post } from './http.ts';
import { newRequestId } from './ids.ts';

interface Intent { path: string; body: Record<string, unknown>; status: 'sending' | 'unknown' | 'retryable' | 'rejected'; error: string }
/** Room operations have idempotent replay, but no general receipt lookup endpoint. */
export function useIntent<T>(scope: string, onSuccess: (result: T) => void | Promise<void>, onError?: (error: unknown) => void) {
  const [intent, setIntent] = useState<Intent | null>(null);
  const current = useRef<Intent | null>(null);
  const generation = useRef(0);
  const callbacks = useRef({ onSuccess, onError }); callbacks.current = { onSuccess, onError };
  useEffect(() => { generation.current++; current.current = null; setIntent(null); return () => { generation.current++; current.current = null; }; }, [scope]);
  const send = async (value: Intent) => {
    if (current.current?.status === 'sending') return;
    const ticket = generation.current;
    const pending: Intent = { ...value, status: 'sending', error: '' };
    current.current = pending; setIntent(pending);
    try {
      const result = await post<T>(value.path, value.body);
      if (ticket !== generation.current) return;
      current.current = null; setIntent(null);
      await callbacks.current.onSuccess(result);
    } catch (error) {
      if (ticket !== generation.current) return;
      const status = error instanceof UnknownResult || error instanceof ApiFailure && (error.status >= 500 || error.status === 408) ? 'unknown' : error instanceof ApiFailure && error.status === 429 ? 'retryable' : 'rejected';
      const failed: Intent = { ...value, status, error: errorMessage(status === 'unknown' ? new UnknownResult() : error) };
      current.current = failed; setIntent(failed); callbacks.current.onError?.(error);
    }
  };
  return {
    intent,
    busy: intent?.status === 'sending',
    unresolved: intent?.status === 'unknown' || intent?.status === 'retryable',
    run: (path: string, body: Record<string, unknown> = {}) => {
      if (current.current && current.current.status !== 'rejected') return Promise.resolve();
      return send({ path, body: structuredClone({ ...body, requestId: newRequestId() }), status: 'rejected', error: '' });
    },
    retry: () => current.current && current.current.status !== 'sending' ? send(current.current) : Promise.resolve(),
  };
}
