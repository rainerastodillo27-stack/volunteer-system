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
    normalizedMessage.includes('supabase') ||
    normalizedMessage.includes('can’t connect to the database') ||
    normalizedMessage.includes("can't connect to the database")
  );
}

function getFriendlyDatabaseUnavailableMessage(): string {
  return 'We can’t connect to the database right now. Start the backend and Expo using npm run all:bg or npm run all, then try again.';
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
      return 'The backend is taking longer than usual. Please wait a moment and try again.';
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
  const rawMessage =
    typeof error === 'string'
      ? error
      : error instanceof Error
      ? error.message
      : '';

  if (rawMessage) {
    const normalizedMessage = rawMessage.toLowerCase();
    if (
      normalizedMessage.includes('timed out') ||
      normalizedMessage.includes('timeout') ||
      normalizedMessage.includes('aborted') ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      return 'Request Timed Out';
    }
  }

  if (rawMessage && isDatabaseUnavailableMessage(rawMessage)) {
    return 'Database Unavailable';
  }

  const message = getRequestErrorMessage(error, '');
  return message && isDatabaseUnavailableMessage(message) ? 'Database Unavailable' : fallback;
}
