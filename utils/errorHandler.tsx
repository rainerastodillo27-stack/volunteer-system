import { getRequestErrorMessage, getRequestErrorTitle } from './requestErrors';
import { showSystemAlert } from '../components/SystemAlertModal';

type ShowOptions = {
  fallbackTitle?: string;
  fallbackMessage?: string;
};

export function showError(error: unknown, options: ShowOptions = {}) {
  const title = getRequestErrorTitle(error, options.fallbackTitle || 'Error');
  const message = getRequestErrorMessage(error, options.fallbackMessage || 'An unexpected error occurred.');

  showSystemAlert(title, message);
}

export function showInfo(title: string, message: string) {
  showSystemAlert(title, message);
}

export default { showError, showInfo };
