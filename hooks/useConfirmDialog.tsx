import { useState, useCallback } from 'react';

export interface ConfirmDialogState {
  visible: boolean;
  loading?: boolean;
  title: string;
  message: string;
  confirmText?: string;
  loadingText?: string;
  cancelText?: string;
  confirmColor?: string;
  icon?: string;
  iconColor?: string;
  onConfirm?: () => void | Promise<void>;
}

export function useConfirmDialog() {
  const [dialogState, setDialogState] = useState<ConfirmDialogState>({
    visible: false,
    loading: false,
    title: '',
    message: '',
  });

  const showConfirm = useCallback(
    (options: Omit<ConfirmDialogState, 'visible' | 'loading'> & { onConfirm: () => void | Promise<void> }) => {
      setDialogState({
        ...options,
        visible: true,
        loading: false,
      });
    },
    []
  );

  const hideConfirm = useCallback(() => {
    setDialogState(prev => ({ ...prev, visible: false }));
  }, []);

  const handleConfirm = useCallback(async () => {
    if (dialogState.loading) {
      return;
    }

    if (dialogState.onConfirm) {
      setDialogState(prev => ({ ...prev, loading: true }));
      try {
        await dialogState.onConfirm();
      } finally {
        hideConfirm();
      }
      return;
    }

    hideConfirm();
  }, [dialogState, hideConfirm]);

  const handleCancel = useCallback(() => {
    if (dialogState.loading) {
      return;
    }
    hideConfirm();
  }, [dialogState.loading, hideConfirm]);

  return {
    dialogState,
    showConfirm,
    hideConfirm,
    handleConfirm,
    handleCancel,
  };
}
