import React, { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

type SystemAlertButton = {
  text: string;
  style?: string;
  onPress?: (...args: any[]) => void | Promise<void>;
};

type SystemAlertConfig = {
  title: string;
  message: string;
  buttons: SystemAlertButton[];
  prompt?: boolean;
  defaultValue?: string;
};

type SystemAlertPresenter = (config: SystemAlertConfig) => void;

let presenter: SystemAlertPresenter | null = null;
let pendingAlerts: SystemAlertConfig[] = [];

/**
 * App-owned replacement for React Native's Alert.alert.
 *
 * React Native Web delegates Alert.alert to window.alert, which blocks the
 * browser thread and produces the unwanted "localhost says" dialog. Keeping
 * this API compatible lets existing screens use the same flow while always
 * rendering the fast in-app modal below.
 */
export function showSystemAlert(
  title: string,
  message?: string,
  buttons?: SystemAlertButton[],
  _options?: unknown,
) {
  const config: SystemAlertConfig = {
    title: title || 'Notice',
    message: message || '',
    buttons: buttons?.length ? buttons : [{ text: 'OK' }],
  };

  if (presenter) {
    presenter(config);
  } else {
    pendingAlerts.push(config);
  }
}

/** App-owned replacement for Alert.prompt (used by the custom-skill form). */
export function showSystemPrompt(
  title: string,
  message?: string,
  buttons?: SystemAlertButton[],
  _type?: unknown,
  defaultValue?: string,
) {
  const config: SystemAlertConfig = {
    title: title || 'Input required',
    message: message || '',
    buttons: buttons?.length ? buttons : [{ text: 'OK' }],
    prompt: true,
    defaultValue: defaultValue || '',
  };

  if (presenter) {
    presenter(config);
  } else {
    pendingAlerts.push(config);
  }
}

function registerPresenter(nextPresenter: SystemAlertPresenter) {
  presenter = nextPresenter;
  const queued = pendingAlerts;
  pendingAlerts = [];
  queued.forEach(nextPresenter);
}

function unregisterPresenter(nextPresenter: SystemAlertPresenter) {
  if (presenter === nextPresenter) {
    presenter = null;
  }
}

function getVisuals(title: string, button?: SystemAlertButton) {
  const normalized = title.toLowerCase();
  if (button?.style === 'destructive' || /delete|remove|failed|error|blocked|restricted|unavailable|invalid|expired|required/.test(normalized)) {
    return { icon: 'error-outline' as const, iconColor: '#DC2626', confirmColor: '#DC2626' };
  }
  if (/success|approved|complete|completed|saved|submitted|uploaded|sent|verified|ready/.test(normalized)) {
    return { icon: 'check-circle' as const, iconColor: '#15803D', confirmColor: '#15803D' };
  }
  return { icon: 'info-outline' as const, iconColor: '#2563EB', confirmColor: '#2563EB' };
}

export function SystemAlertHost() {
  const [queue, setQueue] = useState<SystemAlertConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const enqueue = useCallback((config: SystemAlertConfig) => {
    setQueue(current => [...current, config]);
  }, []);

  useEffect(() => {
    registerPresenter(enqueue);
    return () => unregisterPresenter(enqueue);
  }, [enqueue]);

  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    setInputValue(current.defaultValue || '');
    setLoading(false);
  }, [current]);

  if (!current) {
    return null;
  }

  const cancelButton = current.buttons.find(button => button.style === 'cancel');
  const confirmButton = current.buttons.find(button => button !== cancelButton) || current.buttons[0];
  const visuals = getVisuals(current.title, confirmButton);

  const finish = async (button?: SystemAlertButton) => {
    if (loading) return;
    setLoading(true);
    try {
      if (current.prompt && button === confirmButton) {
        await button?.onPress?.(inputValue);
      } else {
        await button?.onPress?.();
      }
    } catch (error) {
      console.error('System modal action failed:', error);
    } finally {
      setQueue(items => items.slice(1));
      setLoading(false);
    }
  };

  return (
    <ConfirmDialog
      visible
      loading={loading}
      title={current.title}
      message={current.message}
      confirmText={confirmButton?.text || 'OK'}
      loadingText="Please wait..."
      cancelText={cancelButton?.text || 'Cancel'}
      hideCancel={!cancelButton}
      confirmColor={visuals.confirmColor}
      icon={visuals.icon}
      iconColor={visuals.iconColor}
      animationType="none"
      inputValue={current.prompt ? inputValue : undefined}
      inputPlaceholder={current.prompt ? 'Enter a value' : undefined}
      onInputChange={current.prompt ? setInputValue : undefined}
      onConfirm={() => finish(confirmButton)}
      onCancel={() => finish(cancelButton)}
    />
  );
}

export default SystemAlertHost;
