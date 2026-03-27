import { itemsPartialUpdate, PatchedItemWritable } from '@/services/django';
import { useCallback, useRef, useState } from 'react';

export type FieldStatus = 'idle' | 'saving' | 'success' | 'error';

export type FieldSaveState = {
  status: FieldStatus;
  errorMessage?: string;
};

export type FieldStates = Record<string, FieldSaveState>;

export const useFieldAutoSave = (itemUuid: string | undefined) => {
  const [fieldStates, setFieldStates] = useState<FieldStates>({});
  const timeoutRefs = useRef<Record<string, NodeJS.Timeout>>({});

  const setFieldState = useCallback((fieldName: string, state: FieldSaveState) => {
    setFieldStates(prev => ({ ...prev, [fieldName]: state }));
  }, []);

  const resetFieldState = useCallback((fieldName: string) => {
    setFieldStates(prev => {
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
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
    async (fieldName: string, value: unknown) => {
      if (!itemUuid) return;

      setFieldState(fieldName, { status: 'saving' });

      try {
        const body: PatchedItemWritable = { [fieldName]: value };
        await itemsPartialUpdate({
          path: { id: itemUuid },
          body,
        });

        setFieldState(fieldName, { status: 'success' });
        clearSuccessAfterDelay(fieldName);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to save field';
        setFieldState(fieldName, { status: 'error', errorMessage });
      }
    },
    [itemUuid, setFieldState, clearSuccessAfterDelay],
  );

  const saveFields = useCallback(
    async (fields: Record<string, unknown>, primaryField?: string) => {
      if (!itemUuid) return;

      const fieldNames = Object.keys(fields);
      const displayField = primaryField || fieldNames[0];

      for (const fieldName of fieldNames) {
        setFieldState(fieldName, { status: 'saving' });
      }

      try {
        const body: PatchedItemWritable = fields as PatchedItemWritable;
        await itemsPartialUpdate({
          path: { id: itemUuid },
          body,
        });

        for (const fieldName of fieldNames) {
          setFieldState(fieldName, { status: 'success' });
          clearSuccessAfterDelay(fieldName);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to save fields';
        for (const fieldName of fieldNames) {
          setFieldState(fieldName, { status: 'error', errorMessage });
        }
      }
    },
    [itemUuid, setFieldState, clearSuccessAfterDelay],
  );

  return {
    fieldStates,
    saveField,
    saveFields,
    resetFieldState,
    setFieldState,
  };
};
