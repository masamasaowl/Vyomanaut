import { createClient, RedisClientType } from 'redis';
import { config } from './env';

/**
 * Redis Client for Caching & Pub/Sub
 * 
 * Use cases in Vyomanaut:
 * 1. Cache device status (ONLINE/OFFLINE) - check without DB query
 * 2. Cache chunk locations for fast file retrieval
 * 3. Pub/Sub for real-time device events across server instances
 * 4. Rate limiting (track API request counts)
 */


// ================= Singleton pattern ==============
class RedisManager {
  private client: RedisClientType | null = null;
  private isConnecting = false;

  /**
   * The options to get Redis running
   */
  async getClient(): Promise<RedisClientType> {

    // 1. If client already exists for us then simply return it 
    if (this.client?.isOpen) {
      return this.client;
    }


    // 2. If another connection request is running then wait for 100ms
    if (this.isConnecting) {
      // Wait for existing connection attempt
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.getClient();
    }

    // 3. We are confirmed it is not yet created
    this.isConnecting = true;

    try {
      // 4. So Create Redis client
      this.client = createClient({
        socket: {

          // pass config options
          host: config.redis.host,
          port: config.redis.port,

          // We try reconnecting
          // retry 1 → wait 50ms
          // retry 2 → wait 100ms
          // retry 3 → wait 150ms
          // retry 10 → wait 500ms
          // retry 60 → wait 3000ms cap
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error('❌ Redis: Max reconnection attempts reached');
              return new Error('Max reconnection attempts reached');
            }
            // Exponential backoff
            return Math.min(retries * 50, 3000);
          },
        },
        password: config.redis.password,
      });

      // Event Handlers
      // 1. Error
      this.client.on('error', (err) => {
        console.error('❌ Redis Client Error:', err);
      });

      // 2. connecting
      this.client.on('connect', () => {
        console.log('🔌 Redis: Connecting...');
      });

      // 3. connected
      this.client.on('ready', () => {
        console.log('✅ Redis: Connected and ready');
      });

      // 4. reconnecting
      this.client.on('reconnecting', () => {
        console.log('🔄 Redis: Reconnecting...');
      });

      // Try connecting
      await this.client.connect();

      // till now we are definitely connected 
      this.isConnecting = false;
      
      return this.client;
    } catch (error) {
      this.isConnecting = false;
      console.error('❌ Redis connection failed:', error);
      throw error;
    }
  }

  /**
   * A Graceful shutdown
   */
  async disconnect(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit();
      console.log('📦 Redis disconnected');
    }
  }

  /**
   * A Health check for /health endpoint
   */
  async checkHealth(): Promise<boolean> {
    try {
      const client = await this.getClient();
      const pong = await client.ping();
      return pong === 'PONG';
    } catch (error) {
      console.error('❌ Redis health check failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const redisManager = new RedisManager();





// ================ Helper Functions ================



// ================== Cache Status ==================
/**
 * Cache device status
 */
export const cacheDeviceStatus = async (
  deviceId: string,
  status: 'ONLINE' | 'OFFLINE' | 'SUSPENDED'
): Promise<void> => {

  // call client
  const client = await redisManager.getClient();

  // instantly know if a device is online
 // store it's ID and status
  await client.setEx(`device:${deviceId}:status`, 90, status);
};


/**
 * Get cached device status
 */
export const getCachedDeviceStatus = async (
  deviceId: string
): Promise<'ONLINE' | 'OFFLINE' | null> => {


  // call client
  const client = await redisManager.getClient();
  // get device ID
  const status = await client.get(`device:${deviceId}:status`);
  // Check if its online!!!
  return status as 'ONLINE' | 'OFFLINE' | null;
};



// ================== Cache Locations ===============
/**
 * Cache chunk locations for fast retrieval
 * TTL: 5 minutes (locations don't change often)
 */
export const cacheChunkLocations = async (
  chunkId: string,
  deviceIds: string[]
): Promise<void> => {

  const client = await redisManager.getClient();
  // store it's location
  await client.setEx(
    `chunk:${chunkId}:locations`,
    300,
    JSON.stringify(deviceIds)
  );
};

/**
 * Get cached chunk locations
 */
export const getCachedChunkLocations = async (
  chunkId: string
): Promise<string[] | null> => {
  const client = await redisManager.getClient();
  const data = await client.get(`chunk:${chunkId}:locations`);
  return data ? JSON.parse(data) : null;
};

/**
 * Invalidate cache when chunk locations change
 */
export const invalidateChunkCache = async (chunkId: string): Promise<void> => {
  const client = await redisManager.getClient();

  // delete from memory 
  await client.del(`chunk:${chunkId}:locations`);
};



// =============== Track online devices =============
/**
 * Track online devices in a sorted set (by last seen timestamp)
 * Useful for: "Show me all devices online in last 2 minutes"
 */
export const updateDeviceLastSeen = async (deviceId: string): Promise<void> => {
  const client = await redisManager.getClient();
  const timestamp = Date.now();

  // zAdd is used for constant tracking
  await client.zAdd('devices:online', {
    score: timestamp,
    value: deviceId,
  });
};

/**
 * Get online devices (seen in last N seconds)
 */
export const getOnlineDevices = async (
  withinSeconds: number = 120
): Promise<string[]> => {

  const client = await redisManager.getClient();

  // n = 120
  const minTimestamp = Date.now() - withinSeconds * 1000;
  
  // get tracked status
  return await client.zRangeByScore('devices:online', minTimestamp, '+inf');
};