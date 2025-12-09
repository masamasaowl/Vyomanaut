import { PrismaClient } from '@prisma/client';
import { config } from './env';

// Prisma Client Singleton

// Store the Prisma instance globally
declare global {
  var __prisma: PrismaClient | undefined;
}

// Here we create our client 
const createPrismaClient = () => {
  const client = new PrismaClient({

    // We log warnings 
    log: config.isDevelopment
      ? ['query', 'error', 'warn'] // Verbose in dev
      : ['error'], // Only errors in production
    errorFormat: config.isDevelopment ? 'pretty' : 'minimal',
  });

  return client;
};


// ============== Core Logic ===============

// Either import global instance or generate new
export const prisma = global.__prisma || createPrismaClient();

//  In development, reuse global instance to survive hot reloads
if (config.isDevelopment) {
  global.__prisma = prisma;
}


//   Graceful shutdown handler
//  Ensures connections are closed properly
export const disconnectDatabase = async () => {
  await prisma.$disconnect();
  console.log('📦 Database disconnected');
};


  // Database health check
  // Used in health endpoint for monitoring
export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error('❌ Database health check failed:', error);
    return false;
  }
};