import { config } from '../../config/env';
import { prisma } from '../../config/database';
import { deviceService } from '../devices/device.service';
import { ChunkStatus } from '@prisma/client';

/**
 * Chunk Assignment Service
 * 
 * This is the "matchmaker" - decides which devices store which chunks!
 * Decided based on
 * 1. Reliability score
 * 2. Available storage
 *
 * Key decisions:
 * - How many devices per chunk? 
 * - Which devices to pick? (reliability score, available space)
 * - What if assignment fails? (retry mechanism)
 */


// Define types
interface ChunkAssignment {
  chunkId: string;
  deviceIds: string[];
  chunkData: Buffer;
  chunkMetadata: {
    fileId: string;
    sequenceNum: number;
    sizeBytes: number;
    checksum: string;
    iv: string;
    authTag: string;
    aad: string;
  };
}

class ChunkAssignmentService {
  
  // How many devices store the same chunk  
  private readonly redundancyFactor = config.fileProcessing.redundancyFactor; 
  
  /**
   * Assign a chunk to devices
   * 
   * Flow:
   * 1. Find healthy devices (online, good reliability, enough space)
   * 2. Select top N devices (N = redundancyFactor)
   * 3. Create ChunkLocation records (tracks which device has which chunk)
   * 4. Return assignment info (for distribution service to send)
   * 
   * @param chunkId - The chunk to assign
   * @param chunkSizeBytes - Size of the chunk (for storage check)
   * @returns ID of the devices which store the chunk
   */
  async assignChunk(
    chunkId: string,
    chunkSizeBytes: number
  ): Promise<{ deviceIds: string[] }> {
    
    console.log(`Assigning chunk ${chunkId} (${(chunkSizeBytes / 1024).toFixed(2)}KB)`);
    
    // Step 1: Find healthy devices
    const candidates = await deviceService.findHealthyDevices(
      chunkSizeBytes,        // Min storage device must have
      70,                    // Min reliability score
      this.redundancyFactor * 3  // Get extra candidates (in case some fail)
    );
    

    // If not as many candidates
    if (candidates.length < this.redundancyFactor) {
      throw new Error(
        `Not enough healthy devices available. ` +
        `Need ${this.redundancyFactor}, found ${candidates.length}`
      );
    }
    

    // Step 2: Select top N devices
    // Only the redundancy limit number of devices are chosen
    const selectedDevices = candidates.slice(0, this.redundancyFactor);
    // store their Ids
    const deviceIds = selectedDevices.map(d => d.id);
    

    // These are the filtered healthy devices 
    console.log(` ✅ Selected ${deviceIds.length} devices:`, 
      selectedDevices.map(d => `${d.deviceId} (${d.reliabilityScore.toFixed(0)}%)`).join(', ')
    );

    
    // Step 3: Create ChunkLocation records
    // This tracks: "Chunk X is assigned to Device Y" and stores it in ChunkLocation Model in DB
    // Keep saving devices in a loop
    for (const device of selectedDevices) {
      await prisma.chunkLocation.create({
        data: {
          chunkId,
          deviceId: device.id,
          localPath: `/storage/chunks/${chunkId}`, // Path on device's local storage
          isHealthy: true,
        },
      });
    }
    
    // Step 4: Update chunk status as it gets stored
    await prisma.chunk.update({
      where: { id: chunkId },
      data: {
        status: ChunkStatus.REPLICATING,
        currentReplicas: 0, // Will increment as devices confirm receipt
      },
    });
    
    // all devices which stored the chunks ( for distribution service )
    return { deviceIds };
  }


  /**
   * Confirm chunk delivery to a device
   * 
   * Called when device successfully stores the chunk
   * Updates
   * 1. replication count and 
   * 2. chunk status
   * 
   * @param chunkId - The chunk to assign
   * @param deviceId - The device which stores the chunk
   */

  async confirmChunkDelivery(chunkId: string, deviceId: string): Promise<void> {
    
    // Verify ChunkLocation exists in DB
    const location = await prisma.chunkLocation.findFirst({
      where: { chunkId, deviceId },
    });
    
    // Is the chunk not there yet
    if (!location) {
      throw new Error(`ChunkLocation not found for chunk ${chunkId} on device ${deviceId}`);
    }
    
    // Mark location as verified and update date
    await prisma.chunkLocation.update({
      where: { id: location.id },
      data: {
        lastVerified: new Date(),
        isHealthy: true,
      },
    });
    

    // 1. Increment chunk replica count
    const chunk = await prisma.chunk.findUnique({
      where: { id: chunkId },
    });
    
    if (!chunk) {
      throw new Error(`Chunk ${chunkId} not found`);
    }
    
    const newReplicaCount = chunk.currentReplicas + 1;
    

    // 2. Update chunk status
    await prisma.chunk.update({
      where: { id: chunkId },
      data: {
        currentReplicas: newReplicaCount,
        // If we reached target replicas, mark as HEALTHY
        status: newReplicaCount >= chunk.targetReplicas 
          ? ChunkStatus.HEALTHY 
          : ChunkStatus.REPLICATING,
      },
    });
    
    // Log the success message
    console.log(`✅ Chunk ${chunkId} confirmed on device ${deviceId} (${newReplicaCount}/${chunk.targetReplicas} replicas)`);
  }


  /**
   * Get chunk locations (which devices have this chunk)
   * @param chunkId - The chunk to assign
   * @returns an array with the information of the devices 
   */
  async getChunkLocations(chunkId: string): Promise<Array<{
    deviceId: string;
    localPath: string;
    isHealthy: boolean;
    lastVerified: Date | null;
  }>> {

    // Fetch the stored locations from the DB
    const locations = await prisma.chunkLocation.findMany({
      where: { chunkId },
      include: {
        device: {
          select: {
            deviceId: true,
            status: true,
          },
        },
      },
    });
    
    // Return the info
    return locations.map(loc => ({
      deviceId: loc.device.deviceId,
      localPath: loc.localPath,
      isHealthy: loc.isHealthy,
      lastVerified: loc.lastVerified,
    }));
  }


  /**
   * Re-assign chunk to new device
   * An important feature which acts as a game changer
   * 
   * Used when:
   * - Device goes offline permanently
   * - Chunk falls below redundancy target
   * - Chunk healing process
   */
  async reassignChunk(chunkId: string): Promise<void> {

    // Search for the chunks while fetching the Device info where it is stored
    const chunk = await prisma.chunk.findUnique({
      where: { id: chunkId },
      include: {
        locations: {
          include: {
            device: true,
          },
        },
      },
    });
    
    if (!chunk) {
      throw new Error(`Chunk ${chunkId} not found`);
    }
    

    // Count healthy locations
    const healthyLocations = chunk.locations.filter(
      loc => loc.isHealthy && loc.device.status === 'ONLINE'
    );
    
    // Do we need to assign more
    const missingReplicas = chunk.targetReplicas - healthyLocations.length;
    
    // if they are enough then let's go
    if (missingReplicas <= 0) {
      console.log(`Chunk ${chunkId} has enough replicas, skipping reassignment`);
      return;
    }
    
    console.log(`🔄 Reassigning chunk ${chunkId} (missing ${missingReplicas} replicas)`);
    
    // Get devices that DON'T already have this chunk
    const existingDeviceIds = chunk.locations.map(loc => loc.deviceId);
    
    // Let's find fresh new devices for the chunk
    const candidates = await deviceService.findHealthyDevices(
      chunk.sizeBytes,
      70,
      missingReplicas * 2
    );
    
    // Filter out devices that already have this chunk
    const availableDevices = candidates.filter(
      d => !existingDeviceIds.includes(d.id)
    );
    
    // maybe less users are available right now
    if (availableDevices.length === 0) {
      console.warn(`⚠️ No available devices for chunk reassignment`);
      return;
    }
    
    // Assign to new devices
    const devicesToAssign = availableDevices.slice(0, missingReplicas);
    
    // loop storing devices in the chunk location
    for (const device of devicesToAssign) {
      await prisma.chunkLocation.create({
        data: {
          chunkId,
          deviceId: device.id,
          localPath: `/storage/chunks/${chunkId}`,
          isHealthy: false, // Will be set to true when confirmed
        },
      });
      
      console.log(`  ✅ Assigned chunk ${chunkId} to new device ${device.deviceId}`);
    }
    
    // Update chunk status
    await prisma.chunk.update({
      where: { id: chunkId },
      data: {
        status: ChunkStatus.REPLICATING,
      },
    });
  }


  /**
   * Get all chunks that need reassignment
   * (chunks with fewer than target replicas)
   */
  async getChunksNeedingReassignment(): Promise<string[]> {

    // Get chunks below redundancy factor (degraded) or still replicating
    const chunks = await prisma.chunk.findMany({
      where: {
        OR: [
          { status: ChunkStatus.DEGRADED },
          {
            status: ChunkStatus.REPLICATING,
            currentReplicas: { lt: prisma.chunk.fields.targetReplicas },
          },
        ],
      },
      select: { id: true },
    });
    
    // hand them to our distributor 
    return chunks.map(c => c.id);
  }
}

export const chunkAssignmentService = new ChunkAssignmentService();