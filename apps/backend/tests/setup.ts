import { beforeAll, afterAll, afterEach } from 'vitest';
import { prisma } from '../src/config/database';
import { redisManager } from '../src/config/redis';
import { initializeCrypto } from '../src/utils/crypto';

/**
 * Test Setup
 * 
 * Runs before/after all tests to setup and teardown test environment
 * 
 * Key responsibilities:
 * - Initialize crypto (KEK)
 * - Connect to database
 * - Connect to Redis
 * - Clean up between tests
 * - Disconnect after all tests
 */

// Do this once before all tests start
beforeAll(async () => {

  // a fake test key we’ll use during tests.
  const testKEK = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  initializeCrypto(testKEK);
  
  // Ensure database is connected
  await prisma.$connect();
  
  // Ensure Redis is connected
  await redisManager.getClient();
  
  console.log('✅ Test environment initialized');
});


// Clean the room after every test
afterEach(async () => {
  // Clean up database between tests so we always start with new entries
  // Delete in correct order to respect foreign key constraints
  await prisma.chunkLocation.deleteMany();
  await prisma.chunk.deleteMany();
  await prisma.file.deleteMany();
  await prisma.deviceMetric.deleteMany();
  await prisma.systemMetric.deleteMany();
  await prisma.device.deleteMany();
  
  // Clear Redis cache
  const redis = await redisManager.getClient();
  await redis.flushDb();
});


// Turn off lights and lock the lab at the end
afterAll(async () => {
  // Disconnect from database
  await prisma.$disconnect();
  
  // Disconnect from Redis
  await redisManager.disconnect();
  
  console.log('✅ Test environment cleaned up');
});