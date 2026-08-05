type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const currentLevel: LogLevel = (process.env.AGENT_LOG_LEVEL as LogLevel) ?? 'info';

const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function log(level: LogLevel, msg: string, meta?: unknown) {
  if (order[level] < order[currentLevel]) return;
  const ts = new Date().toISOString();
  const line = meta ? `${ts} [${level}] ${msg} ${JSON.stringify(meta)}` : `${ts} [${level}] ${msg}`;
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](line);
}

export const logger = {
  debug: (m: string, meta?: unknown) => log('debug', m, meta),
  info: (m: string, meta?: unknown) => log('info', m, meta),
  warn: (m: string, meta?: unknown) => log('warn', m, meta),
  error: (m: string, meta?: unknown) => log('error', m, meta),
};
