import { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../../config/database';
import { getCachedChunkLocations, cacheChunkLocations } from '../../config/redis';
import { decryptChunk } from '../../utils/crypto';



// Define types used in retrieval
interface ChunkRetrievalResult {
  chunkId: string;
  sequenceNum: number;
  encryptedData: Buffer;
  metadata: {
    iv: string;
    authTag: string;
    aad: string;
    checksum: string;
  };
}

/**
 * Chunk Retrieval Service
 * 
 * Handles fetching chunks from devices and reassembling files
 * 
 * Think of it like a "pickup coordinator":
 * - Knows where each chunk is stored
 * - Calls devices to retrieve chunks
 * - Handles failures (device offline? try another!)
 * - Reassembles chunks in correct order
 */

class ChunkRetrievalService {
  
  private io: SocketIOServer | null = null;
  
  /**
   * Initialize with Socket.io server instance
   * Okay, so let's hand the walkie-talkies again this time we are looking for something we sent earlier
   */
  setSocketIO(io: SocketIOServer): void {
    this.io = io;
    console.log('✅ Chunk retrieval service initialized');
  }

  /**
   * Retrieve all chunks for a file and reassemble
   * 
   * Flow:
   * 1. Get all chunks for file (from database)
   * 2. Retrieve each chunk from devices (parallel!)
   * 3. Sort chunks by sequenceNum
   * 4. Decrypt each chunk
   * 5. Concatenate into original file
   * 6. Verify original checksum
   * 
   * @param fileId - The file to retrieve given by company
   * @returns Complete file buffer
   */
  async retrieveFile(fileId: string): Promise<Buffer> {

    // We are connected to everyone right?
    if (!this.io) {
      throw new Error('Socket.io not initialized!');
    }
    
    console.log(`📥 Retrieving file ${fileId}`);
    
    // Step 1: Get file metadata 
    // search for those little chunks in sequence 
    const file = await prisma.file.findUnique({
      where: { id: fileId },
      include: {
        chunks: {
          orderBy: { sequenceNum: 'asc' },
        },
      },
    });
    
    if (!file) {
      throw new Error(`File ${fileId} not found`);
    }
    
    // Let's begin
    console.log(`  Found ${file.chunks.length} chunks to retrieve`);
    

    // Step 2: Retrieve all chunks (in parallel for speed!)
    const chunkPromises = file.chunks.map(chunk =>
        
      // he knows the right device and the right chunk
      this.retrieveChunk(chunk.id)
    );
    
    // He does the parallel retrieval
    // The pieces come together from everywhere everything all at once
    const retrievedChunks = await Promise.all(chunkPromises);
    
    // Step 3: Sort by sequence number (just to be safe!)
    retrievedChunks.sort((a, b) => a.sequenceNum - b.sequenceNum);
    
    console.log(`  ✅ Retrieved all ${retrievedChunks.length} chunks`);

    
    // Step 4: Decrypt each chunk
    const decryptedChunks: Buffer[] = [];
    
    // Go one-by-one
    for (const chunk of retrievedChunks) {

        // Our decrypt hero from crypto.ts comes to the rescue
      const decrypted = decryptChunk({
        ciphertext: chunk.encryptedData,
        iv: chunk.metadata.iv,
        authTag: chunk.metadata.authTag,
        ciphertextHash: chunk.metadata.checksum,
        aad: chunk.metadata.aad,
        wrappedDEK: file.encryptionKey,
        fileId: file.id,
        chunkIndex: chunk.sequenceNum,
      });
      
      // push into array
      decryptedChunks.push(decrypted);
      console.log(`  🔓 Decrypted chunk ${chunk.sequenceNum}`);
    }
    
    // Step 5: Concatenate chunks into original file
    // Avengers... Assemble!
    const reassembledFile = Buffer.concat(decryptedChunks);
    
    // It's actually been done 
    console.log(`  🔗 Reassembled file (${(reassembledFile.length / 1024 / 1024).toFixed(2)}MB)`);
    
    // Step 6: Verify original checksum
    // There was no changing that took place in that file right
    const { generateChecksum } = require('../../utils/crypto');
    const actualChecksum = generateChecksum(reassembledFile);
    
    if (actualChecksum !== file.checksum) {
      throw new Error(
        'File checksum mismatch! File may be corrupted. ' +
        `Expected: ${file.checksum}, Got: ${actualChecksum}`
      );
    }
    
    console.log(`  ✅ Checksum verified - file integrity intact!`);
    
    // Here's your file buddy quick and safe
    return reassembledFile;
  }


  /**
   * Retrieve a single chunk from devices
   * 
   * Flow:
   * 1. Look up chunk locations (which devices have it)
   * 2. Try each device until success
   * 3. Return encrypted chunk data + metadata
   * 
   * @param chunkId - The chunk to retrieve
   */
  private async retrieveChunk(chunkId: string): Promise<ChunkRetrievalResult> {
    
    // Get chunk metadata from DB
    const chunk = await prisma.chunk.findUnique({
      where: { id: chunkId },
    });
    
    if (!chunk) {
      throw new Error(`Chunk ${chunkId} not found`);
    }
    
    // Get chunk locations (try cache first!)
    // Redis we need help!
    let locations = await getCachedChunkLocations(chunkId);
    
    // If flash (redis) doesn't have it then superman (postgres) does
    if (!locations) {
      const dbLocations = await prisma.chunkLocation.findMany({
        where: { 
          chunkId,
          isHealthy: true,
        },
        include: {
          device: {
            select: {
              id: true,
              deviceId: true,
              status: true,
            },
          },
        },
      });
      
      // make sure he is online
      locations = dbLocations
        .filter(loc => loc.device.status === 'ONLINE')
        .map(loc => loc.device.id);
      
      // next time we'll use flash
      if (locations.length > 0) {
        await cacheChunkLocations(chunkId, locations);
      }
    }
    
    if (locations.length === 0) {
      throw new Error(`No online devices have chunk ${chunkId}`);
    }
    
    // We've got him
    console.log(`  📍 Found chunk ${chunkId} on ${locations.length} devices`);
    

    // Try asking each eligible device until success
    for (const deviceId of locations) {
      try {
        // He knows how to do it 
        const encryptedData = await this.retrieveChunkFromDevice(
          deviceId,
          chunkId
        );
        
        // If found!
        // Give it back for the grand assemble
        return {
          chunkId,
          sequenceNum: chunk.sequenceNum,
          encryptedData,
          metadata: {
            iv: chunk.iv,
            authTag: chunk.authTag,
            aad: chunk.aad,
            checksum: chunk.checksum,
          },
        };
        
        // If the perfect match is not found
      } catch (error) {
        console.warn(`  ⚠️ Failed to retrieve from device ${deviceId}:`, error);

        // We keep trying like there is no tomorrow
        continue;
      }
    }
    
    // a stormy turn of events did it
    throw new Error(`Failed to retrieve chunk ${chunkId} from all devices`);
  }


  /**
   * Retrieve chunk from a specific device
   * Update: actual encrypted chunk is now retrieved
   * 
   * @param deviceId - Database ID of device
   * @param chunkId - Chunk to retrieve
   */
  private async retrieveChunkFromDevice(
    deviceId: string,
    chunkId: string
  ): Promise<Buffer> {
    
    // Get device info
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
    });
    
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }
    
    // Find device's WebSocket connection
    // What is your phone number again?
    const socket = this.findDeviceSocket(device.deviceId);
    
    if (!socket) {
      throw new Error(`Device ${device.deviceId} not connected`);
    }
    
    console.log(`  📡 Requesting chunk ${chunkId} from device ${device.deviceId}`);
    
    // Request chunk from device
    return new Promise((resolve, reject) => {
      
        // We are less on time, Sorry, only 60 seconds allowed!
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for chunk from ${device.deviceId}`));
      }, 60000); // 60 second timeout
      
      // Request for chunk
      socket.emit('chunk:request', { chunkId });
      
      // Wait for chunk data ( The decisive message )
      socket.once(`chunk:data:${chunkId}`, (response: { 
        success: boolean; 
        data?: string;  // Base64 encoded chunk data
        error?: string;
      }) => {

        // The wait is over
        clearTimeout(timeout);
        
        // Is he between us now, Yes!!!
        if (response.success && response.data) {
          // Decode him, base64 to buffer
          const chunkBuffer = Buffer.from(response.data, 'base64');

          console.log(`  ✅ Received chunk ${chunkId} from device ${device.deviceId} (${(chunkBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
          
          resolve(chunkBuffer);

        // Oops!
        } else {
          reject(new Error(response.error || 'Failed to retrieve chunk'));
        }
      });
    });
  }


  // ========================================
  // UTILITIES 
  // ========================================
  
  /**
   * Find a device's WebSocket connection
   */
  private findDeviceSocket(deviceId: string) {
    if (!this.io) return null;
    
    // Store the ids from in an array
    const sockets = Array.from(this.io.sockets.sockets.values());
    // Did we get him
    return sockets.find(socket => socket.data.deviceId === deviceId);
  }


  /**
   * Check if all chunks for a file are available or not at a given moment
   * (at least one online device has each chunk)
   * used by file.service.ts
   */
  async checkFileAvailability(fileId: string): Promise<{
    available: boolean;
    missingChunks: number[];
    totalChunks: number;
  }> {
    
    // From file to bits we store everything
    const file = await prisma.file.findUnique({
      where: { id: fileId },
      include: {
        chunks: {
          include: {
            locations: {
              include: {
                device: true,
              },
            },
          },
        },
      },
    });
    
    if (!file) {
      throw new Error(`File ${fileId} not found`);
    }
    
    // They were not reported 
    const missingChunks: number[] = [];
    
    for (const chunk of file.chunks) {
      // Check if at least one online device has this chunk
      const hasOnlineDevice = chunk.locations.some(
        loc => loc.device.status === 'ONLINE' && loc.isHealthy
      );
      
      if (!hasOnlineDevice) {
        missingChunks.push(chunk.sequenceNum);
      }
    }
    
    // Our response
    return {
      available: missingChunks.length === 0,
      missingChunks,
      totalChunks: file.chunks.length,
    };
  }
}

export const chunkRetrievalService = new ChunkRetrievalService();