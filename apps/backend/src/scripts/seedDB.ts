import { prisma } from '../config/database';

async function seed() {
  // Create test user
  const user = await prisma.user.create({
    data: {
      email: 'test@vyomanaut.com',
      password: 'hashed...',
      name: 'Test User'
    }
  });
  
  // Create test devices
  for (let i = 1; i <= 5; i++) {
    await prisma.device.create({
      data: {
        deviceId: `test-device-00${i}`,
        userId: user.id,
        deviceType: 'ANDROID',
        totalStorageBytes: BigInt(10 * 1024 * 1024 * 1024),
        availableStorageBytes: BigInt(8 * 1024 * 1024 * 1024),
        status: 'ONLINE'
      }
    });
  }
}

seed();