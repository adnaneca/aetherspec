import dotenv from 'dotenv';

dotenv.config();

function required(key: string, fallback = ''): string {
  const val = process.env[key] ?? fallback;
  if (!val && !fallback) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
}

export const config = {
  agent: {
    port: parseInt(required('AGENT_PORT', '50051'), 10),
    env: required('AGENT_ENV', 'development'),
    logLevel: required('AGENT_LOG_LEVEL', 'info'),
  },
  ollama: {
    baseURL: required('OLLAMA_BASE_URL', 'https://ollama.com'),
    apiKey: required('OLLAMA_API_KEY', ''),
    model: required('OLLAMA_MODEL', 'glm-5.2'),
  },
  postgres: {
    host: required('POSTGRES_HOST', 'localhost'),
    port: parseInt(required('POSTGRES_PORT', '5432'), 10),
    db: required('POSTGRES_DB', 'aetherspec'),
    user: required('POSTGRES_USER', 'aetherspec'),
    password: required('POSTGRES_PASSWORD', ''),
    sslmode: required('POSTGRES_SSLMODE', 'disable'),
  },
  minio: {
    endpoint: required('MINIO_ENDPOINT', 'localhost:9000'),
    accessKey: required('MINIO_ACCESS_KEY', ''),
    secretKey: required('MINIO_SECRET_KEY', ''),
    useSSL: required('MINIO_USE_SSL', 'false') === 'true',
    bucket: required('MINIO_BUCKET', 'aetherspec-artifacts'),
  },
  langfuse: {
    host: required('LANGFUSE_HOST', 'http://localhost:3000'),
    publicKey: required('LANGFUSE_PUBLIC_KEY', ''),
    secretKey: required('LANGFUSE_SECRET_KEY', ''),
  },
} as const;

export type Config = typeof config;
