type RequestErrorOptions = {
  backendUrl?: string;
};

function isDatabaseUnavailableMessage(message: string): boolean {
  const normalizedMessage = message.toLowerCase();

  return (
    normalizedMessage.includes('backend unavailable') ||
    normalizedMessage.includes('database backend unavailable') ||
    normalizedMessage.includes('unable to reach the backend') ||
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('network request failed') ||
    normalizedMessage.includes('failed to resolve host') ||
    normalizedMessage.includes('getaddrinfo failed') ||
    normalizedMessage.includes('name or service not known') ||
    normalizedMessage.includes('temporary failure in name resolution') ||
    normalizedMessage.includes('connection refused') ||
    normalizedMessage.includes('connection reset') ||
    normalizedMessage.includes('supabase')
  );
}

function getFriendlyDatabaseUnavailableMessage(): string {
  return 'We can’t connect to the database right now. Please check your internet connection and try again in a moment.';
}

export function getRequestErrorMessage(
  error: unknown,
  fallback: string,
  options: RequestErrorOptions = {}
): string {
  const networkMessage = getFriendlyDatabaseUnavailableMessage();

  if (error instanceof Error) {
    const message = error.message.trim();
    const normalizedMessage = message.toLowerCase();

    if (
      error.name === 'AbortError' ||
      normalizedMessage.includes('timed out') ||
      normalizedMessage.includes('timeout') ||
      normalizedMessage.includes('aborted')
    ) {
      return 'The connection is very slow right now. Please wait a moment and try again.';
    }

    if (
      normalizedMessage.includes('failed to fetch') ||
      normalizedMessage.includes('network request failed') ||
      normalizedMessage.includes('networkerror')
    ) {
      return networkMessage;
    }

    if (isDatabaseUnavailableMessage(message)) {
      return networkMessage;
    }

    if (message) {
      return message;
    }
  }

  if (typeof error === 'string' && error.trim()) {
    return isDatabaseUnavailableMessage(error) ? networkMessage : error.trim();
  }

  return fallback;
}

export function getRequestErrorTitle(error: unknown, fallback = 'Error'): string {
  const message = getRequestErrorMessage(error, '');
  return message && isDatabaseUnavailableMessage(message) ? 'Database Unavailable' : fallback;
}
