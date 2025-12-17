import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';

/**
 * Temporary Chunk Storage Service
 * 
 * Manages temporary storage of encrypted chunks before distribution to devices
 * 
 * Think of this as a "staging area" - like a loading dock:
 * - Chunks arrive from chunking service
 * - Stored temporarily here
 * - Sent to devices
 * - Cleaned up after distribution
 * 
 * - NOT a permanent storage
 * - NOT a cloud storage
 * 
 * Why temporary?
 * - Backend doesn't permanently store data
 * - Only holds chunks long enough to distribute
 * - Saves disk space
 * - Aligns with "coordinator" architecture of our project 
 */

class TemporaryStorageService {
  
    // define the path of storage
  private readonly storageRoot: string;
  
  constructor() {
    // Store in project root/storage/temp
    // This path is independent of the OS
    // cwd -> current working directory
    this.storageRoot = path.join(process.cwd(), 'storage', 'temp');

    // mkdir -p: ensure storage repo exists else create one
    this.ensureStorageDirectory();
  }
  
  /**
   * Ensure storage directory exists
   * Creates if missing (like mkdir -p storage/temp
)
   */
  private ensureStorageDirectory(): void {

    // if path doesn't exist 
    if (!existsSync(this.storageRoot)) {

    // create repo
      mkdirSync(this.storageRoot, { recursive: true });
      console.log(`📁 Created temporary storage: ${this.storageRoot}`);
    }
  }
  
  /**
   * Store a chunk temporarily
   * 
   * @param chunkId - Unique chunk identifier
   * @param encryptedData - The encrypted chunk buffer
   * @returns - Path where chunk is stored as a Promise
   */
  async storeChunk(chunkId: string, encryptedData: Buffer): Promise<string> {

    // Where is this chunk stored in our root 
    const chunkPath = this.getChunkPath(chunkId);
    
    try {

     // FS: async file operations 
     // chunkPath has the file location
     // inside that file we store our encrypted Data
      await fs.writeFile(chunkPath, encryptedData);

      // print success
      console.log(`💾 Stored chunk ${chunkId} (${(encryptedData.length / 1024 / 1024).toFixed(2)}MB)`);

      // Where did we save it 
      return chunkPath;

    } catch (error) {
      console.error(`❌ Failed to store chunk ${chunkId}:`, error);
      throw new Error(`Failed to store chunk: ${error}`);
    }
  }
  

  /**
   * Retrieve a chunk from temporary storage
   * 
   * @param chunkId - Chunk to retrieve
   * @returns Encrypted chunk buffer
   */
  async retrieveChunk(chunkId: string): Promise<Buffer> {

    // Get that chunk
    const chunkPath = this.getChunkPath(chunkId);
    
    try {

      // We our encrypted Data back
      const data = await fs.readFile(chunkPath);

      // inform about the success
      console.log(`📤 Retrieved chunk ${chunkId} (${(data.length / 1024 / 1024).toFixed(2)}MB)`);

      // Hand over the data 
      return data;
    } catch (error) {
      console.error(`❌ Failed to retrieve chunk ${chunkId}:`, error);
      throw new Error(`Chunk not found or corrupted: ${chunkId}`);
    }
  }
  

  /**
   * Check if chunk exists in storage
   */
  async chunkExists(chunkId: string): Promise<boolean> {
    const chunkPath = this.getChunkPath(chunkId);
    try {
      // boolean check  
      await fs.access(chunkPath);
      return true;
    } catch {
      return false;
    }
  }
  

  /**
   * Delete a chunk from temporary storage
   * 
   * Called after:
   * - Chunk successfully distributed to all devices
   * - File deleted by company
   * - Cleanup job runs
   */
  async deleteChunk(chunkId: string): Promise<void> {

    // get that chunk
    const chunkPath = this.getChunkPath(chunkId);
    
    try {

      // Delete the file   
      await fs.unlink(chunkPath);

      console.log(`🗑️ Deleted chunk ${chunkId}`);

    } catch (error) {
      // Don't throw - file might already be deleted
      // avoid server crashes
      console.warn(`⚠️ Could not delete chunk ${chunkId}:`, error);
    }
  }
  
  /**
   * Delete all chunks for a file
   * 
   * @param fileId - File whose chunks to delete
   */
  async deleteFileChunks(fileId: string): Promise<void> {
    // In real implementation, would query DB for chunks
    // For now, this is a placeholder
    console.log(`🗑️ Scheduling deletion of chunks for file ${fileId}`);
  }
  

  /**
   * Cleanup old chunks (older than X hours)
   * 
   * Safety mechanism in case distribution fails
   * Called by background job
   */
  async cleanupOldChunks(olderThanHours: number = 24): Promise<number> {

    console.log(`🧹 Cleaning up chunks older than ${olderThanHours} hours...`);
    
    try {

      // search for the old files in the directory  
      const files = await fs.readdir(this.storageRoot);

      // the time after which file is deleted 
      const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
      let deletedCount = 0;
      
      // loop over each chunk
      for (const file of files) {
        // extract it 
        const filePath = path.join(this.storageRoot, file);
        
        // extract time it is alive 
        const stats = await fs.stat(filePath);
        
        if (stats.mtimeMs < cutoffTime) {
          // delete it   
          await fs.unlink(filePath);
          deletedCount++;
        }
      }
      
      console.log(`✅ Cleaned up ${deletedCount} old chunks`);

      // How many did we cleanup
      return deletedCount;
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
      return 0;
    }
  }
  

  // ========================================
  // HELPERS    
  // ========================================
  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    chunkCount: number;
    totalSizeBytes: number;
    totalSizeMB: string;
  }> {
    try {

      // read entire folder  
      const files = await fs.readdir(this.storageRoot);
      let totalSize = 0;
      
      // gather stats of all files 
      for (const file of files) {
        const filePath = path.join(this.storageRoot, file);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
      }
      
      return {

        // return their length
        chunkCount: files.length,
        // their size
        totalSizeBytes: totalSize,
        // size in MB
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      };
    } catch (error) {
      return {
        chunkCount: 0,
        totalSizeBytes: 0,
        totalSizeMB: '0.00',
      };
    }
  }
  

  /**
   * Get path for a specific chunk
   * Format: /storage/temp/{chunkId}.chunk
   */
  private getChunkPath(chunkId: string): string {
    return path.join(this.storageRoot, `${chunkId}.chunk`);
  }
}

export const temporaryStorageService = new TemporaryStorageService();