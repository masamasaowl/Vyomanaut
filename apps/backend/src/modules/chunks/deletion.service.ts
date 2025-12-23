import { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../../config/database';
import { cleanupQueue } from '../../config/queue';
import { temporaryStorageService } from './storage.service';
import { 
  DeleteFileJobData, 
  DeleteExcessReplicasJobData,
  DeleteChunkFromDeviceJobData 
} from '../../types/deletion.types';


/**
 * Chunk Deletion Service
 * 
 * Responsibilities:
 * 1. Delete all chunks when file is deleted
 * 2. Trim excess replicas (keep system lean)
 * 3. Tell devices to delete their local copies
 * 4. Clean up database records
 * 5. Remove from temporary storage
 */
class ChunkDeletionService {
  
  private io: SocketIOServer | null = null;
  
  // Safety margin: How many extra copies to keep beyond target
  // Example: Target = 3 + Safety = 2 → Keep up to 5 copies
  private readonly SAFETY_MARGIN = 2;
  
  /**
   * Initialize with Socket.io for device communication
   * Hand those walkie-talkies it is time for termination
   */
  setSocketIO(io: SocketIOServer): void {
    this.io = io;
    console.log('✅ Chunk deletion service initialized');
  }


  // ================================================
  // TYPE 1: COMPANY DELETES FILE
  // ================================================
  
  /**
   * Queue file deletion job
   * 
   * Called by: file.service.ts when company deletes file
   * 
   * Flow:
   * 1. Mark file as DELETED (immediate)
   * 2. Queue background job (async cleanup)
   * 3. Worker processes job later
   * 4. Chunks deleted one by one
   * 
   * Why async? Because deletion can take time:
   * - We need to contact multiple devices
   * - Some devices might be offline
   * - Don't want to block company's request
   */
  async queueFileDeletion(
    fileId: string,
    companyId: string,
    reason: 'USER_REQUESTED' | 'EXPIRED' | 'POLICY_VIOLATION' = 'USER_REQUESTED'
  ): Promise<void> {
    
    console.log(`📋 Queueing deletion for file ${fileId} (${reason})`);
    
    // The details of the file that needs to be deleted
    const jobData: DeleteFileJobData = {
      fileId,
      companyId,
      reason,
      timestamp: Date.now(),
    };
    
    // Add job to cleanup queue 
    // file.service.ts -> delete this file
    // queueFileDeletion() -> adds as a cleanup job
    // executeFileDeletion() -> the logic worker runs
    await cleanupQueue.add('delete-file', jobData, {

      // User requests are urgent marked as priority 1
      priority: reason === 'USER_REQUESTED' ? 1 : 2,
      // Retry if fails 
      attempts: 5, 
      backoff: {
        type: 'exponential',
        delay: 5000, // Start with 5s goes to 80s
      },
    });
    
    console.log(`  ✅ Deletion job queued for file ${fileId}`);
  }
  

  /**
   * Execute file deletion (called by worker)
   * 
   * This is the actual deletion logic
   * 
   * Flow:
   * 1. Get all chunks for this file
   * 2. For each chunk, get all locations (devices)
   * 3. Tell each device to delete
   * 4. Remove from temporary storage
   * 5. Delete ChunkLocation records
   * 6. Delete Chunk records
   * 7. Finally, delete File record
   */
  async executeFileDeletion(fileId: string): Promise<void> {
    
    console.log(`🗑️ Executing deletion for file ${fileId}`);
    
    // Step 1: Get all chunks with their locations
    const chunks = await prisma.chunk.findMany({
      where: { fileId },
      include: {
        locations: {
          include: {
            device: true,
          },
        },
      },
    });
    
    console.log(`  Found ${chunks.length} chunks to delete`);
    
    // Step 2: Delete each chunk from all devices
    for (const chunk of chunks) {
      await this.deleteChunkFromAllDevices(chunk.id);
    }
    
    // Step 3: Delete File record (cascade will delete chunks)
    await prisma.file.delete({
      where: { id: fileId },
    });
    
    console.log(`✅ File ${fileId} completely deleted`);
  }



  // =================================================
  // TYPE 2: TOO MANY REPLICAS
  // =================================================
  
  /**
   * Check and queue deletion of excess replicas
   * It 
   * 1. Checks if deletion needs to be done
   * 2. If yes -> add to cleanup job
   * 
   * Called by: Health monitoring service during scans
   * 
   * Example:
   * - Target replicas: 3
   * - Safety margin: 2
   * - Max allowed: 5
   * - Current replicas: 8
   * - Action: Delete 3 excess copies
   * 
   * Why? To prevent storage waste and keep system efficient
   */
  async checkAndQueueExcessReplicaDeletion(chunkId: string): Promise<void> {
    
    // Look for that chunk
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
    
    if (!chunk) return;
    
    // Count healthy replicas only
    const healthyLocations = chunk.locations.filter(
      loc => loc.isHealthy && loc.device.status === 'ONLINE'
    );
    
    const currentReplicas = healthyLocations.length;
    const maxAllowed = chunk.targetReplicas + this.SAFETY_MARGIN;
    
    // Do we have too many?
    if (currentReplicas > maxAllowed) {
      
      // We need to remove these many replicas
      const excessCount = currentReplicas - maxAllowed;
      
      console.log(`📋 Chunk ${chunkId} has ${excessCount} excess replicas`);
      console.log(`   Current: ${currentReplicas}, Max allowed: ${maxAllowed}`);
      
      // Provide details for deletion
      const jobData: DeleteExcessReplicasJobData = {
        chunkId,
        currentReplicas,
        targetReplicas: chunk.targetReplicas,
        safetyMargin: this.SAFETY_MARGIN,
        excessCount,
        timestamp: Date.now(),
      };
      
      // Add this as a job to be cleaned up
      // (low priority)
      await cleanupQueue.add('delete-excess-replicas', jobData, {
        priority: 3, // Not urgent
        attempts: 3,
      });
      
      console.log(`  ✅ Queued deletion of ${excessCount} excess replicas`);
    }

    return
  }
  
  /**
   * Execute excess replica deletion (called by worker)
   * 
   * Smart Selection Algorithm:
   * 1. Keep devices with highest reliability scores
   * 2. Keep devices with most available storage
   * 3. Delete from least reliable devices first
   */
  async executeExcessReplicaDeletion(chunkId: string): Promise<void> {
    
    console.log(`🗑️ Trimming excess replicas for chunk ${chunkId}`);
    
    // Get chunk with all locations
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
    
    if (!chunk) return;
    
    // Filter to healthy locations only
    const healthyLocations = chunk.locations.filter(
      loc => loc.isHealthy && loc.device.status === 'ONLINE'
    );
    
    const maxAllowed = chunk.targetReplicas + this.SAFETY_MARGIN;
    const excessCount = healthyLocations.length - maxAllowed;
    
    if (excessCount <= 0) {
      console.log(`  No excess replicas to delete`);
      return;
    }
    
    // Sort by reliability score in ascending order (lowest first = delete these)
    const sortedLocations = [...healthyLocations].sort(
      (a, b) => a.device.reliabilityScore - b.device.reliabilityScore
    );
    
    // Select worst performers for deletion
    // Delete from [0, excessCount]
    const locationsToDelete = sortedLocations.slice(0, excessCount);
    
    console.log(`  Will delete ${locationsToDelete.length} excess replicas`);
    console.log(`  Keeping replicas on devices with scores: ${
      sortedLocations.slice(excessCount).map(l => l.device.reliabilityScore.toFixed(0)).join(', ')
    }`);
    
    // Delete selected replicas
    for (const location of locationsToDelete) {
      await this.deleteChunkFromDevice(
        chunkId,
        location.deviceId,
        'EXCESS_REPLICA'
      );
    }
    
    console.log(`✅ Trimmed ${locationsToDelete.length} excess replicas`);
  }


  // ================================================
  // SHARED DELETION LOGIC
  // ================================================
  
  /**
   * Delete chunk from all devices that have it
   * as company deleted the file, so we store it nowhere now 
   * 
   * Used when entire file is deleted (Type 1)
   */
  private async deleteChunkFromAllDevices(chunkId: string): Promise<void> {
    
    // Find all locations where this chunk exists 
    const locations = await prisma.chunkLocation.findMany({
      where: { chunkId },
      include: {
        device: true,
      },
    });
    
    console.log(`  Deleting chunk ${chunkId} from ${locations.length} devices`);
    
    // Delete from each device
    // Returned as a promise as it is a long procedure
    const deletePromises = locations.map(loc => 
      this.deleteChunkFromDevice(chunkId, loc.deviceId, 'FILE_DELETED')
    );
    
    // Wait for all deletions (some may fail, that's okay)
    // Doesn't let the server crash
    await Promise.allSettled(deletePromises);
    
    // Delete from temporary storage
    // So no copies remain with us locally 
    await temporaryStorageService.deleteChunk(chunkId);
    
    // Delete all location records
    await prisma.chunkLocation.deleteMany({
      where: { chunkId },
    });
  }
  

  /**
   * Delete chunk from a specific device
   * 
   * This is the core deletion function that talks to devices
   * 
   * Flow:
   * 1. Find device's WebSocket connection
   * 2. Send delete command via socket
   * 3. Wait for confirmation (with timeout)
   * 4. Update/delete ChunkLocation record
   */
  private async deleteChunkFromDevice(
    chunkId: string,
    deviceId: string,
    reason: 'FILE_DELETED' | 'EXCESS_REPLICA' | 'UNHEALTHY'
  ): Promise<void> {
    
    // Extract that device which has the chunk
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
    });
    
    if (!device) {
      console.warn(`  Device ${deviceId} not found, skipping`);
      return;
    }
    
    // Find device's WebSocket connection
    const socket = this.findDeviceSocket(device.deviceId);
    

    // Device offline - mark location for deletion later
    if (!socket) {
      console.warn(`  Device ${device.deviceId} offline, marking for cleanup`);
      
      await prisma.chunkLocation.updateMany({
        where: { chunkId, deviceId },
        data: { isHealthy: false },
      });
      
      return;
    }
    
    console.log(`  📡 Requesting deletion from device ${device.deviceId}`);
    

    // Send deletion request to device
    return new Promise((resolve, reject) => {
      
      // Resolve within
      const timeout = setTimeout(() => {
        console.warn(`  ⚠️ Timeout waiting for deletion confirmation from ${device.deviceId}`);
        resolve(); // Don't fail job, just log warning
      }, 60000); // 60 second timeout
      
      // Send delete command
      socket.emit('chunk:delete', {
        chunkId,
        reason,
      });
      
      // Wait for confirmation (only once)
      socket.once(`chunk:deleted:${chunkId}`, async (response: { 
        success: boolean; 
        error?: string;
      }) => {
        
        // no more waiting
        clearTimeout(timeout);
        
        if (response.success) {
          
          // Update device's available storage (freed space!)
          await prisma.device.update({
            where: { id: deviceId },
            data: {
              availableStorageBytes: {
                increment: BigInt(
                  (await prisma.chunk.findUnique({ 
                    where: { id: chunkId },
                    select: { sizeBytes: true }
                  }))?.sizeBytes || 0
                ),
              },
            },
          });
          
          // Delete ChunkLocation record
          await prisma.chunkLocation.deleteMany({
            where: { chunkId, deviceId },
          });
          
          // Update chunk replica count
          await prisma.chunk.update({
            where: { id: chunkId },
            data: {
              currentReplicas: {
                decrement: 1,
              },
            },
          });
          
          console.log(`  ✅ Chunk deleted from device ${device.deviceId}`);
          resolve();
          
        } else {
          console.error(`  ❌ Device ${device.deviceId} failed to delete: ${response.error}`);
          // Don't fail job
          resolve(); 
        }
      });
    });
  }
  
  

  // ===============================================
  // UTILITIES
  // ===============================================
  
  /**
   * Find device's WebSocket connection
   */
  private findDeviceSocket(deviceId: string) {
    if (!this.io) return null;
    
    const sockets = Array.from(this.io.sockets.sockets.values());
    return sockets.find(socket => socket.data.deviceId === deviceId);
  }


  /**
   * Scan all chunks and queue deletion of excess replicas
   * 
   * Note: This is the scanner health scheduler runs
   *       and checkAndQueueExcessReplicaDeletion()
   *       Does the task of assigning adding it as
   *       job
   * 
   * Called periodically by health scheduler
   */
  async scanAndCleanupExcessReplicas(): Promise<{
    chunksScanned: number;
    excessFound: number;
    deletionsQueued: number;
  }> {
    
    console.log('🔍 Scanning for excess replicas...');
    
    // Fetch all chunks stored on a device
    const chunks = await prisma.chunk.findMany({
      include: {
        locations: {
          include: {
            device: true,
          },
        },
      },
    });
    
    let excessFound = 0;
    let deletionsQueued = 0;
    
    // Check if our buds are Online
    for (const chunk of chunks) {
      const healthyLocations = chunk.locations.filter(
        loc => loc.isHealthy && loc.device.status === 'ONLINE'
      );
      
      const maxAllowed = chunk.targetReplicas + this.SAFETY_MARGIN;
      
      // Add it as a job in the cleanup queue
      if (healthyLocations.length > maxAllowed) {
        excessFound++;
        await this.checkAndQueueExcessReplicaDeletion(chunk.id);
        deletionsQueued++;
      }
    }
    
    console.log(`✅ Scan complete: ${excessFound} chunks with excess replicas`);
    
    // Returned to health scheduler 
    return {
      chunksScanned: chunks.length,
      excessFound,
      deletionsQueued,
    };
  }
}

// He's ready to rock it all out 
export const chunkDeletionService = new ChunkDeletionService();

