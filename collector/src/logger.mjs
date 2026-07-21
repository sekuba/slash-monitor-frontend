const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  constructor(level = 'info', output = process.stdout) {
    this.threshold = LEVELS[level];
    this.output = output;
  }

  debug(message, data) {
    this.write('debug', message, data);
  }

  info(message, data) {
    this.write('info', message, data);
  }

  warn(message, data) {
    this.write('warn', message, data);
  }

  error(message, data) {
    this.write('error', message, data);
  }

  write(level, message, data) {
    if (LEVELS[level] < this.threshold) {
      return;
    }

    const record = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(data === undefined ? {} : { data }),
    };
    this.output.write(`${JSON.stringify(record)}\n`);
  }
}

export function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message).slice(0, 1_000);
}

export function redactSensitiveText(value) {
  return String(value)
    // Viem and fetch-family errors can include the full RPC URL. Query strings,
    // userinfo, and even hostnames are commonly credentials in hosted RPCs.
    .replace(/https?:\/\/[^\s"'<>)}\]]+/gi, '[redacted-url]')
    .replace(
      /\b(authorization|x-api-key)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi,
      '$1: [redacted]',
    );
}
