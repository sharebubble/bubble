import { profilesMePartialUpdate, type PatchedProfile } from '@/services/django';
import { useCallback, useRef, useState } from 'react';
import type { FieldSaveState, FieldStates } from './useFieldAutoSave';

export const useProfileFieldAutoSave = () => {
  const [fieldStates, setFieldStates] = useState<FieldStates>({});
  const timeoutRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const setFieldState = useCallback((fieldName: string, state: FieldSaveState) => {
    setFieldStates(prev => ({ ...prev, [fieldName]: state }));
  }, []);

  const clearSuccessAfterDelay = useCallback((fieldName: string, delay = 2000) => {
    if (timeoutRefs.current[fieldName]) {
      clearTimeout(timeoutRefs.current[fieldName]);
    }
    timeoutRefs.current[fieldName] = setTimeout(() => {
      setFieldStates(prev => {
        if (prev[fieldName]?.status === 'success') {
          const next = { ...prev };
          delete next[fieldName];
          return next;
        }
        return prev;
      });
      delete timeoutRefs.current[fieldName];
    }, delay);
  }, []);

  const saveField = useCallback(
    async (fieldName: string, value: unknown): Promise<boolean> => {
      setFieldState(fieldName, { status: 'saving' });
      try {
        const body: PatchedProfile = { [fieldName]: value };
        await profilesMePartialUpdate({ body });
        setFieldState(fieldName, { status: 'success' });
        clearSuccessAfterDelay(fieldName);
        return true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to save field';
        setFieldState(fieldName, { status: 'error', errorMessage });
        return false;
      }
    },
    [setFieldState, clearSuccessAfterDelay],
  );

  return { fieldStates, saveField };
};
