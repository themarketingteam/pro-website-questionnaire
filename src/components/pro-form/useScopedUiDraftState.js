import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { clearUiDraftState, setUiDraftState } from '@/components/store/formSlice';

const EMPTY_DATA = Object.freeze({});

/** Stores recoverable, serializable editor state without capturing raw browser objects. */
export const useScopedUiDraftState = ({
  scopeKey,
  kind,
  enabled = true,
  version = 1,
}) => {
  const dispatch = useDispatch();
  const entry = useSelector((state) => (/** @type {any} */ (state))?.form?.uiDraftState?.[scopeKey]);
  const sourceTabId = useSelector(
    (state) => (/** @type {any} */ (state))?.form?.draftContext?.sourceTabId || null,
  );
  const setData = useCallback((data) => {
    if (!enabled) return;
    dispatch(setUiDraftState({
      scopeKey,
      entry: {
        kind,
        version,
        data,
        updatedAtClient: new Date().toISOString(),
        sourceTabId,
      },
    }));
  }, [dispatch, enabled, kind, scopeKey, sourceTabId, version]);
  const clear = useCallback(() => {
    if (enabled) dispatch(clearUiDraftState({ scopeKey }));
  }, [dispatch, enabled, scopeKey]);
  return Object.freeze({
    data: entry?.data || EMPTY_DATA,
    entry: entry || null,
    setData,
    clear,
    enabled,
  });
};

export const buildQuestionUiDraftScope = (questionId, suffix) => (
  `question:${String(questionId)}:${suffix}`
);

export default useScopedUiDraftState;
