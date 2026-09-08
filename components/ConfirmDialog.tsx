import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, View, Text, TextInput, StyleSheet, TouchableOpacity, Modal, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface ConfirmDialogProps {
  visible: boolean;
  loading?: boolean;
  title: string;
  message: string;
  confirmText?: string;
  loadingText?: string;
  cancelText?: string | null;
  hideCancel?: boolean;
  confirmColor?: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  iconColor?: string;
  animationType?: 'none' | 'slide' | 'fade';
  inputValue?: string;
  inputPlaceholder?: string;
  onInputChange?: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export type ConfirmDialogOptions = Omit<ConfirmDialogProps, 'visible' | 'loading' | 'onConfirm' | 'onCancel'> & {
  onConfirm: () => void | Promise<void>;
};

export interface ConfirmDialogHandle {
  show: (options: ConfirmDialogOptions) => void;
  confirm: () => Promise<void>;
  cancel: () => void;
}

export default function ConfirmDialog({
  visible,
  loading = false,
  title,
  message,
  confirmText = 'Delete',
  loadingText = 'Deleting...',
  cancelText = 'Cancel',
  hideCancel = false,
  confirmColor = '#DC2626',
  icon = 'delete-outline',
  iconColor = '#DC2626',
  animationType = 'fade',
  inputValue,
  inputPlaceholder,
  onInputChange,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!visible) return null;

  const showCancelButton = !hideCancel && cancelText !== '' && cancelText !== null && cancelText !== undefined;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      onRequestClose={loading ? undefined : onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          {/* Icon */}
          <View style={[styles.iconContainer, { backgroundColor: `${iconColor}10` }]}>
            <MaterialIcons name={icon} size={32} color={iconColor} />
          </View>

          {/* Title */}
          <Text style={styles.title}>{title}</Text>

          {/* Message */}
          <Text style={styles.message}>{message}</Text>

          {inputValue !== undefined ? (
            <TextInput
              value={inputValue}
              placeholder={inputPlaceholder}
              onChangeText={onInputChange}
              autoFocus
              style={styles.input}
              placeholderTextColor="#94a3b8"
            />
          ) : null}

          {/* Buttons */}
          <View style={styles.buttonContainer}>
            {showCancelButton ? (
              <TouchableOpacity
                style={[styles.button, styles.cancelButton, loading && styles.disabledButton]}
                onPress={onCancel}
                activeOpacity={0.7}
                disabled={loading}
              >
                <Text style={styles.cancelButtonText}>{cancelText}</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.button, styles.confirmButton, { backgroundColor: confirmColor }, loading && styles.disabledButton]}
              onPress={onConfirm}
              activeOpacity={0.7}
              disabled={loading}
            >
              {loading ? (
                <View style={styles.loadingContent}>
                  <ActivityIndicator size="small" color="#ffffff" />
                  <Text style={styles.confirmButtonText}>{loadingText}</Text>
                </View>
              ) : (
                <Text style={styles.confirmButtonText}>{confirmText}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Keeps confirmation state outside large screens so showing the dialog does
 * not require rendering the entire screen tree first.
 */
export const ConfirmDialogHost = forwardRef<ConfirmDialogHandle>(function ConfirmDialogHost(_props, ref) {
  const [dialogState, setDialogState] = useState<(
    ConfirmDialogOptions & { visible: boolean; loading: boolean }
  ) | null>(null);
  const dialogIdRef = useRef(0);

  const show = (options: ConfirmDialogOptions) => {
    dialogIdRef.current += 1;
    setDialogState({ ...options, visible: true, loading: false });
  };

  const cancel = () => {
    setDialogState(current => (current?.loading ? current : null));
  };

  const confirm = async () => {
    const current = dialogState;
    if (!current || current.loading) {
      return;
    }

    const dialogId = dialogIdRef.current;
    setDialogState(previous => previous ? { ...previous, loading: true } : previous);

    try {
      await current.onConfirm();
    } finally {
      // An error handler may open a replacement dialog. Do not close that
      // replacement when the original confirmation finishes.
      if (dialogIdRef.current === dialogId) {
        setDialogState(null);
      }
    }
  };

  useImperativeHandle(ref, () => ({ show, confirm, cancel }), [dialogState]);

  if (!dialogState) {
    return null;
  }

  return (
    <ConfirmDialog
      visible={dialogState.visible}
      loading={dialogState.loading}
      title={dialogState.title}
      message={dialogState.message}
      confirmText={dialogState.confirmText}
      loadingText={dialogState.loadingText}
      cancelText={dialogState.cancelText}
      hideCancel={dialogState.hideCancel}
      confirmColor={dialogState.confirmColor}
      icon={dialogState.icon}
      iconColor={dialogState.iconColor}
      animationType={dialogState.animationType ?? 'none'}
      inputValue={dialogState.inputValue}
      inputPlaceholder={dialogState.inputPlaceholder}
      onInputChange={dialogState.onInputChange}
      onConfirm={confirm}
      onCancel={cancel}
    />
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 99999,
  },
  dialog: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    ...Platform.select({
      web: {
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
      },
    }),
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#1e293b',
    marginBottom: 16,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#f1f5f9',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  confirmButton: {
    backgroundColor: '#DC2626',
  },
  disabledButton: {
    opacity: 0.75,
  },
  loadingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
