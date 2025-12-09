// validate all env variables using Zod 

import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  //make sure always a number
  PORT: z.string().transform(Number).pipe(z.number().min(1).max(65535)),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string(),

  // Redis
  REDIS_HOST: z.string(),
  REDIS_PORT: z.string().transform(Number).pipe(z.number()),
  REDIS_PASSWORD: z.string().optional().default(''),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Encryption
  MASTER_KEK: z.string().length(64, 'Master KEK must be exactly 64 hex characters (32 bytes)'),

  // File Processing
  CHUNK_SIZE_MB: z.string().transform(Number).pipe(z.number().positive()),
  REDUNDANCY_FACTOR: z.string().transform(Number).pipe(z.number().min(2).max(5)),
  MAX_FILE_SIZE_GB: z.string().transform(Number).pipe(z.number().positive()),

  // WebSocket
  WS_PING_INTERVAL: z.string().transform(Number).pipe(z.number().positive()),
  WS_PING_TIMEOUT: z.string().transform(Number).pipe(z.number().positive()),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).pipe(z.number().positive()),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).pipe(z.number().positive()),

  // Pricing
  STORAGE_RATE_PER_GB_HOUR: z.string().transform(Number).pipe(z.number().positive()),
});



// show error if env var is not parsed
const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }

  return result.data;
};

export const env = parseEnv();



// This helps other files import these env vars efficiently
export const config = {
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  
  server: {
    port: env.PORT,
    host: env.HOST,
  },

  database: {
    url: env.DATABASE_URL,
  },

  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },

  encryption: {
    masterKEK: env.MASTER_KEK,
  },

  fileProcessing: {
    chunkSizeBytes: env.CHUNK_SIZE_MB * 1024 * 1024, // Convert to bytes
    // The number of copies that need to be distributed
    redundancyFactor: env.REDUNDANCY_FACTOR,
    maxFileSizeBytes: env.MAX_FILE_SIZE_GB * 1024 * 1024 * 1024,
  },

  websocket: {
    pingInterval: env.WS_PING_INTERVAL,
    pingTimeout: env.WS_PING_TIMEOUT,
  },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
  },

  pricing: {
    storageRatePerGBHour: env.STORAGE_RATE_PER_GB_HOUR,
  },
} as const;

// Export type for use in other files
export type Config = typeof config;