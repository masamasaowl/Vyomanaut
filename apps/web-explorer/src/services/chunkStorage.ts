import { PrismaClient } from '@prisma/client';
import { StoredChunk } from '@/types';


// We Initialize our Prisma Client
const prisma = new PrismaClient();


/**
 * Chunk Storage Service
 * 
 * Manages chunk storage in PostgreSQL (simulates device a disk storage)
 * 
 * We use Postgres to maintain a regularity with our backend and it is also a quick and easy to query DB
 * We simply apply CRUD operations on the receives chunk
 */
class ChunkStorageService {
  
  /**
   * Store a chunk in PostgreSQL
   * 
   * Called when backend sends chunk:assign event
   * 
   * @param chunk - Encrypted Chunk with metadata received through the socket
   * @returns Stored chunk record
   */
  async storeChunk(chunk: {
    chunkId: string;
    deviceId: string;
    encryptedData: string;
    fileId: string;
    sequenceNum: number;
    sizeBytes: number;
    checksum: string;
  }): Promise<StoredChunk> {
    
    // Let's store it safely
    console.log(`💾 Storing chunk ${chunk.chunkId} in PostgreSQL...`);
    
    try {
      // Generate local path (simulates /storage/chunks/xxx.enc on Android)
      // These steps would later aid us integrate our app seamlessly with our device
      const localPath = `/chunks/${chunk.chunkId}.enc`;
      
      // Store in database
      const stored = await prisma.storedChunk.create({
        data: {
          chunkId: chunk.chunkId,
          deviceId: chunk.deviceId,
          encryptedData: chunk.encryptedData,
          localPath,
          fileId: chunk.fileId,
          sequenceNum: chunk.sequenceNum,
          sizeBytes: chunk.sizeBytes,
          checksum: chunk.checksum,
          isHealthy: true,
          lastVerified: new Date(),
        },
      });
      
      console.log(`✅ Chunk ${chunk.chunkId} stored successfully`);
      
      // We return the record 
      return stored;
      
    } catch (error) {
      console.error(`❌ Failed to store chunk ${chunk.chunkId}:`, error);
      throw error;
    }
  }
  
  
  /**
   * Retrieve a chunk from PostgreSQL
   * 
   * Called when backend sends chunk:request event
   * 
   * @param chunkId - ID of chunk to retrieve
   * @param deviceId - Device that should have the chunk
   * @returns The stored Encrypted chunk data 
   */
  async retrieveChunk(chunkId: string, deviceId: string): Promise<string> {
    
    console.log(`📤 Retrieving chunk ${chunkId} from PostgreSQL...`);
    
    try {
      // Find chunk in database through chunkId
      const chunk = await prisma.storedChunk.findFirst({
        where: {
          chunkId,
          deviceId,
          isHealthy: true,
        },
      });
      

      // Error if not found
      if (!chunk) {
        throw new Error(`Chunk ${chunkId} not found on device ${deviceId}`);
      }
      
      // Update last verified timestamp
      await prisma.storedChunk.update({
        where: { id: chunk.id },
        data: { lastVerified: new Date() },
      });
      
      console.log(`✅ Chunk ${chunkId} retrieved successfully`);
      
      return chunk.encryptedData;
      
    } catch (error) {
      console.error(`❌ Failed to retrieve chunk ${chunkId}:`, error);
      throw error;
    }
  }
  
  
  /**
   * Delete a chunk from PostgreSQL
   * 
   * Called when backend sends chunk:delete event
   * This happens if the company wishes to terminate the files wherever they are
   * 
   * @param chunkId - ID of chunk to delete
   * @param deviceId - Device that has the chunk
   */
  async deleteChunk(chunkId: string, deviceId: string): Promise<void> {
    
    console.log(`🗑️ Deleting chunk ${chunkId} from PostgreSQL...`);
    
    try {
      // Delete the chunk from storage 
      await prisma.storedChunk.deleteMany({
        where: {
          chunkId,
          deviceId,
        },
      });
      
      console.log(`✅ Chunk ${chunkId} deleted successfully`);
      
    } catch (error) {
      console.error(`❌ Failed to delete chunk ${chunkId}:`, error);
      throw error;
    }
  }
  
  
  /**
   * Get all chunks for a device
   * 
   * Used to populate dashboard chunk list
   * 
   * @param deviceId - Device to get chunks for
   * @returns Array of stored chunks
   */
  async getDeviceChunks(deviceId: string): Promise<StoredChunk[]> {
    
    try {
      
      const chunks = await prisma.storedChunk.findMany({
        where: { deviceId },
        orderBy: { createdAt: 'desc' },
      });
      
      return chunks;
      
    } catch (error) {
      console.error(`❌ Failed to get chunks for device ${deviceId}:`, error);
      return [];
    }
  }
  
  
  /**
   * Get chunk statistics for a device
   * 
   * @param deviceId - Device to get stats for
   * @returns Storage statistics
   */
  async getStorageStats(deviceId: string): Promise<{
    totalChunks: number;
    totalSizeBytes: number;
    healthyChunks: number;
  }> {
    
    try {
      const chunks = await prisma.storedChunk.findMany({
        where: { deviceId },
        select: {
          sizeBytes: true,
          isHealthy: true,
        },
      });
      
      return {
        totalChunks: chunks.length,
        totalSizeBytes: chunks.reduce((sum: number, c: any) => sum + c.sizeBytes, 0),
        healthyChunks: chunks.filter(c => c.isHealthy).length,
      };
      
    } catch (error) {
      console.error(`❌ Failed to get storage stats:`, error);
      return {
        totalChunks: 0,
        totalSizeBytes: 0,
        healthyChunks: 0,
      };
    }
  }
  
  
  /**
   * Mark a chunk as unhealthy
   * 
   * Called if chunk verification fails
   * 
   * @param chunkId - Chunk to mark unhealthy
   * @param deviceId - Device that has the chunk
   */
  async markChunkUnhealthy(chunkId: string, deviceId: string): Promise<void> {
    
    try {
      await prisma.storedChunk.updateMany({
        where: { chunkId, deviceId },
        data: { isHealthy: false },
      });
      
      console.log(`⚠️ Chunk ${chunkId} marked as unhealthy`);
      
    } catch (error) {
      console.error(`❌ Failed to mark chunk unhealthy:`, error);
    }
  }
  
  
  /**
   * Clear all chunks for a device
   * 
   * Called when device deregisters or user logs out
   * 
   * @param deviceId - Device to clear chunks for
   */
  async clearDeviceChunks(deviceId: string): Promise<number> {
    
    try {
      const result = await prisma.storedChunk.deleteMany({
        where: { deviceId },
      });
      
      console.log(`🗑️ Cleared ${result.count} chunks from device ${deviceId}`);
      
      return result.count;
      
    } catch (error) {
      console.error(`❌ Failed to clear chunks:`, error);
      return 0;
    }
  }
}

// Export singleton instance
export const chunkStorageService = new ChunkStorageService();


