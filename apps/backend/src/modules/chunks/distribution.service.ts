import { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../../config/database';
import { chunkAssignmentService } from './assignment.service';

/**
 * Chunk Distribution Service
 * 
 * Handles actual transmission of chunks to devices via WebSocket
 * 
 * Think of this as the "delivery dispatcher":
 * - Gets assignment from assignment service
 * - Finds device's WebSocket connection
 * - Sends chunk data
 * - Waits for confirmation
 * - Updates database
 */

class ChunkDistributionService {
  
  // declare our Websocket  
  private io: SocketIOServer | null = null;
  

  /**
   * Initialize with Socket.io server instance
   * Must be called during server startup!
   * It hands a walkie-talkie to all connected devices
   */
  setSocketIO(io: SocketIOServer): void {
    this.io = io;
    console.log('✅ Chunk distribution service initialized');
  }
  
  /**
   * Distribute a chunk to assigned devices
   * 
   * Flow:
   * 1. Get chunk data from database
   * 2. Assign chunk to devices
   * 3. For each device:
   *    - Find their WebSocket connection
   *    - Send chunk via socket
   *    - Wait for confirmation (with timeout)
   * 4. Update chunk status
   * 
   * @param chunkId - The chunk to distribute
   */
  async distributeChunk(chunkId: string): Promise<void> {

    // Make sure everyone has the walkie-talkie as we are ready to Boom
    if (!this.io) {
      throw new Error('Socket.io not initialized! Call setSocketIO() first');
    }
    
    // Let's get this pizza delivered
    console.log(`📤 Distributing chunk ${chunkId}`);
    

    // Step 1: Get chunk data from database
    const chunk = await prisma.chunk.findUnique({
      where: { id: chunkId },
      include: {
        file: true,
      },
    });
    
    if (!chunk) {
      throw new Error(`Chunk ${chunkId} not found`);
    }
    
    // Step 2: Assign chunk to devices ( assignment.service.ts )
    const assignment = await chunkAssignmentService.assignChunk(
      chunkId,
      chunk.sizeBytes
    );
    
    // Pizza is reaching all of you guys
    console.log(`  📍 Assigned to ${assignment.deviceIds.length} devices`);
    

    // Step 3: Send chunk to each device in a loop
    // All is returned as a Promise we get to know which failed or succeeded
    const sendPromises = assignment.deviceIds.map(async (deviceId) => {

      return this.sendChunkToDevice(
        deviceId,
        chunkId,
        {
          fileId: chunk.fileId,
          sequenceNum: chunk.sequenceNum,
          sizeBytes: chunk.sizeBytes,
          checksum: chunk.checksum,
          iv: chunk.iv,
          authTag: chunk.authTag,
          aad: chunk.aad,
        }
      );
    });
    

    // Wait for all sends to complete (or fail)
    // This doesn't let the process crash in itself
    const results = await Promise.allSettled(sendPromises);
    
    // Count successes
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    
    console.log(`  ✅ Successfully sent to ${successCount}/${assignment.deviceIds.length} devices`);
    

    // If we didn't reach target replicas, mark as degraded so then we reassign
    if (successCount < chunk.targetReplicas) {
      await prisma.chunk.update({
        where: { id: chunkId },
        data: { status: 'DEGRADED' },
      });
      
      console.warn(`  ⚠️ Chunk ${chunkId} is degraded (only ${successCount} replicas)`);
    }
  }


  /**
   * Distribute all chunks for a file
   * Called after file upload completes
   * It then starts the upload of individual Chunks
   */
  async distributeFileChunks(fileId: string): Promise<void> {
    console.log(`📦 Distributing chunks for file ${fileId}`);
    
    // Get all chunks for this file
    const chunks = await prisma.chunk.findMany({
      where: { fileId },
      // Get all chunks in sequence
      orderBy: { sequenceNum: 'asc' },
    });
    
    console.log(`  Found ${chunks.length} chunks to distribute`);
    
    // Distribute each chunk in a loop
    for (const chunk of chunks) {
      try {

        // distribute this chunk
        await this.distributeChunk(chunk.id);
      } catch (error) {
        
        console.error(`  ❌ Failed to distribute chunk ${chunk.id}:`, error);
        // Continue with next chunk even if this one fails
      }
    }
    
    console.log(`✅ File distribution complete`);
  }


  /**
   * Send chunk to a specific device
   * he is the actual delivery boy 
   * 
   * 
   * @param deviceId - Database ID of device
   * @param chunkId - Chunk ID
   * @param metadata - Chunk metadata
   * 
   * @returns only success or failure
   */
  private async sendChunkToDevice(
    deviceId: string,
    chunkId: string,
    metadata: {
      fileId: string;
      sequenceNum: number;
      sizeBytes: number;
      checksum: string;
      iv: string;
      authTag: string;
      aad: string;
    }
  ): Promise<void> {
    
    // Get that device 
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
    });
    
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }
    
    // Find device's WebSocket connection through the websocket ID
    const socket = this.findDeviceSocket(device.deviceId);
    
    if (!socket) {
      throw new Error(`Device ${device.deviceId} not connected`);
    }
    
    console.log(`  📡 Sending chunk ${chunkId} to device ${device.deviceId}`);
    

    // Send chunk assignment event
    // Note: For MVP, we're sending metadata only
    // In production, we'll also send the encrypted chunk data
    // We use a Promise even when func is async as we are tracking webSocket events
    return new Promise((resolve, reject) => {
      
      
      // We wait for the device to respond for 30 seconds  
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for chunk confirmation from ${device.deviceId}`));
      }, 30000); // 30 second timeout
      

      // Send chunk to it
      // chunk:assign -> is the event that would be recognized by the client websocket
      // The chunkId and metadata goes via payload
      socket.emit('chunk:assign', {
        chunkId,
        ...metadata,
        // In production, we include: encryptedData (as base64 or binary)
        // Not now as: 
      });

      
      // Wait for confirmation from device
      // We listen for it only once
      // chunk:confirm:${chunkId} -> Is the event which is emitted by device and received by us
      socket.once(`chunk:confirm:${chunkId}`, async (response: { success: boolean }) => {

        // response delivered
        clearTimeout(timeout);
        
        if (response.success) {
          // Update chunk location as confirmed
          await chunkAssignmentService.confirmChunkDelivery(chunkId, deviceId);
          
          // Update device's available storage
          await prisma.device.update({
            where: { id: deviceId },
            data: {

              // Reduce it's available storage   
              availableStorageBytes: device.availableStorageBytes - BigInt(metadata.sizeBytes),
            },
          });
          
          // promise is a successfully resolved
          resolve();
        } else {
          reject(new Error(`Device ${device.deviceId} rejected chunk`));
        }
      });
    });
  }


  // ========================================
  // HELPERS    
  // ========================================
  /**
   * Find a device's WebSocket connection
   * 
   * Uses the socket.data.deviceId we set during registration
   */
  private findDeviceSocket(deviceId: string) {
    if (!this.io) return null;
    
    // Get all connected sockets
    // .values() convert to array so we can find
    // io.sockets -> gather all sockets
    const sockets = Array.from(this.io.sockets.sockets.values());
    
    // Find socket where socket.data.deviceId matches
    return sockets.find(socket => socket.data.deviceId === deviceId);
  }
}

export const chunkDistributionService = new ChunkDistributionService();