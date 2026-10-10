/**
 * Logging for a stdio server. stdout carries the protocol, so every log line
 * goes to stderr. MCP clients collect a server's stderr in their own log
 * files, which is where you will find these lines.
 */

/** Severity levels. */
export const LOG_LEVEL = { info: 'info', warn: 'warn', error: 'error' } as const;
export type LogLevel = (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL];

/** Typed context on a log line. Never put the API key, tool arguments or API response bodies in it. */
export type LogContext = Readonly<Record<string, string | number | boolean | undefined>>;

/** A structured logger. Each call emits one JSON line. */
export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

/** Receives one finished line of text. */
export type LogWriter = (line: string) => void;

/** Writes a line to stderr. The only place the server writes outside the protocol. */
export const writeToStderr: LogWriter = (line) => {
  process.stderr.write(`${line}\n`);
};

/**
 * Creates a logger that writes one JSON object per line.
 *
 * @param write - Where lines go: `writeToStderr` when running, an array in tests.
 * @returns A structured logger.
 */
export function createLogger(write: LogWriter): Logger {
  const emit = (level: LogLevel, message: string, context: LogContext = {}): void => {
    write(JSON.stringify({ level, message, ...context }));
  };
  return {
    info: (message, context) => emit(LOG_LEVEL.info, message, context),
    warn: (message, context) => emit(LOG_LEVEL.warn, message, context),
    error: (message, context) => emit(LOG_LEVEL.error, message, context),
  };
}
