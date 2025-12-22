import { config } from '../../config/env';
import { 
  generateWrappedDEK, 
  encryptChunk, 
  generateChecksum 
} from '../../utils/crypto';
import { FileProcessingResult } from '../../types/file.types';

/**
 * IMPROVED Chunking Service with Adaptive Chunk Sizing
 * 
 * New Strategy:
 * - Files ≤ 1GB: No chunking (treat as single chunk)
 * - 1GB < Files ≤ 5GB: 500MB chunks
 * - Files > 5GB: 1GB chunks
 * 
 * 
 * Responsible for:
 * 1. Splitting files into fixed-size chunks
 * 2. Encrypting each chunk
 * 3. Generating checksums
 * 4. Preparing chunks for distribution
 * 
 * Think of it like a pizza slicer + packaging machine!
 */

class ChunkingService {
  
  // Size thresholds (in bytes)
  // These are limits after which chunk size changes
  private readonly NO_CHUNK_THRESHOLD = 1024 * 1024 * 1024; // 1GB
  private readonly MEDIUM_FILE_THRESHOLD = 5 * 1024 * 1024 * 1024; // 5GB
  
  // Chunk sizes for different file sizes
  // If 1GB < Files ≤ 5GB
  private readonly MEDIUM_CHUNK_SIZE = 500 * 1024 * 1024; // 500MB
  // Files > 5GB
  private readonly LARGE_CHUNK_SIZE = 1024 * 1024 * 1024; // 1GB
  

  // do this only once
  constructor() {

    console.log(`🍕 Adaptive Chunking Service initialized:
      ≤1GB files: No chunking
      1-5GB files: 500MB chunks
      >5GB files: 1GB chunks
    `);
  }


  /**
   * Determine the optimal chunk size for a given file
   * 
   * This is our "Pizza slice size decider"
   * All fetch him when they get a pizza
   * We write a reasoning for future reference
   */
  private determineChunkSize(fileSizeBytes: number): {
    chunkSize: number;
    shouldChunk: boolean;
    reasoning: string;
  } {
    
    // Entire file is the "chunk"
    if (fileSizeBytes <= this.NO_CHUNK_THRESHOLD) {
      return {
        // Chunk = File
        chunkSize: fileSizeBytes, 

        // Don't chunk
        shouldChunk: false,
        reasoning: `File is ${(fileSizeBytes / 1024 / 1024).toFixed(0)}MB, treating as single unit`
      };
    }
    
    // Less than 5GB
    if (fileSizeBytes <= this.MEDIUM_FILE_THRESHOLD) {
      return {
        // 1 chunk = 500MB
        chunkSize: this.MEDIUM_CHUNK_SIZE,
        shouldChunk: true,
        reasoning: `Medium file (${(fileSizeBytes / 1024 / 1024 / 1024).toFixed(2)}GB), using 500MB chunks`
      };
    }
    
    // File > 5GB
    return {
      // 1 chunk = 1GB
      chunkSize: this.LARGE_CHUNK_SIZE,
      shouldChunk: true,
      reasoning: `Large file (${(fileSizeBytes / 1024 / 1024 / 1024).toFixed(2)}GB), using 1GB chunks`
    };
  }


  /**
   * This is a method to 
   * Process a file: chunk it and encrypt each chunk
   * 
   * 
   * NEW BEHAVIOR:
   * - Small files (≤1GB): Encrypt whole file, send to 3 devices
   * - Medium files (1-5GB): Split into 500MB chunks
   * - Large files (>5GB): Split into 1GB chunks
   * 
   * 
   * Flow:
   * 1. Generate file checksum (original file integrity)
   * 2. Generate wrapped DEK for this file
   * 3. Split file into chunks
   * 4. Encrypt each chunk with derived key
   * 5. Generate checksum for each encrypted chunk
   * 6. Return metadata + encrypted chunks
   * 
   * 
   * What inputs are we looking for 
   * @param fileBuffer - The entire file in memory
   * @param originalName - Original filename
   * @param mimeType - File MIME type
   * @param fileId - Unique file ID (for key derivation)
   */
  async processFile(
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string,
    fileId: string
  ): Promise<FileProcessingResult> {
    
    // How should we chunk the file
    const fileSizeBytes = fileBuffer.length;
    const strategy = this.determineChunkSize(fileSizeBytes);
    
    // Which file are we working on
    console.log(`Processing file: ${originalName} (${(fileSizeBytes / 1024 / 1024).toFixed(2)}MB)`);
    console.log(`  Strategy: ${strategy.reasoning}`);
    

    // Step 1: Calculate checksum of ORIGINAL file (before encrypting it)
    // This would help us reassemble it correctly later
    // utils/crypto.ts
    const originalChecksum = generateChecksum(fileBuffer);
    // print first few logs
    console.log(`Original file checksum: ${originalChecksum.substring(0, 16)}...`);
    

    // Step 2: Generate wrapped DEK for this file
    const { wrappedDEK, dekId } = generateWrappedDEK();
    // log the id
    console.log(`Generated DEK ID: ${dekId}`);
    
  
    // Step 3: Split into chunks (or treat as single chunk)
    const chunks = strategy.shouldChunk 
      ? this.splitIntoChunks(fileBuffer, strategy.chunkSize)
      : [fileBuffer]; // Entire file is one "chunk"
    
    console.log(`  Split into ${chunks.length} chunk(s)`);
    

    // Step 4: Encrypt each chunk
    // store as an array
    const encryptedChunks = [];
    
    // loop encrypting each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunkBuffer = chunks[i];
      
      // Encrypt this chunk
      const encrypted = encryptChunk(
        chunkBuffer,
        wrappedDEK,
        fileId,
        i  // chunk index
      );
      
      // store in array
      encryptedChunks.push({
        sequenceNum: i,
        sizeBytes: encrypted.sizeBytes,
        checksum: encrypted.ciphertextHash,  // Checksum of ENCRYPTED chunk
        encryptedData: encrypted.ciphertext,
        // Store encryption metadata (we'll need these to decrypt!)
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        aad: encrypted.aad,
      });
      
      console.log(` Encrypted chunk ${i} (${(encrypted.sizeBytes / 1024).toFixed(2)}KB)`);
    }
    
    console.log(`🎉 File processing complete!`);
    
    return {
      fileMetadata: {
        originalName,
        mimeType,
        sizeBytes: fileBuffer.length,
        checksum: originalChecksum,
        encryptionKey: wrappedDEK,  // Wrapped DEK (safe to store!)
        dekId,
      },
      chunks: encryptedChunks,
    };
  }


  // ========================================
  // Splitting logic
  // ========================================
  /**
   * Split file buffer into fixed-size chunks
   * pizza cutting logic
   * 
   * Like cutting a 12-inch pizza into 5-inch slices
   */
  private splitIntoChunks(fileBuffer: Buffer, chunkSize: number): Buffer[] {

    // create arrays which store Buffers (the chunks in binary)
    const chunks: Buffer[] = [];

    // Track how many bytes have we cut till now 
    let offset = 0;
    

    // A pizza cutting loop
    while (offset < fileBuffer.length) {

      // How much pizza is left to cut
      // (last chunk might be smaller)
      const remainingBytes = fileBuffer.length - offset;
      // depend on smaller value
      const currentChunkSize = Math.min(chunkSize, remainingBytes);
      
      // Cut the slice 
      // make a subarray() instead of slice() as it saves space by referencing the same buffer
      const chunk = fileBuffer.subarray(offset, offset + currentChunkSize);
      chunks.push(chunk);
      
      // So how much did we cut 
      offset += currentChunkSize;
    }
    
    return chunks;
  }


  // ========================================
  // UTILITIES
  // ========================================

  /**
   * Calculate how many chunks a file will produce
   * Useful for validation before processing
   */
  calculateChunkCount(fileSizeBytes: number): number {
    const strategy = this.determineChunkSize(fileSizeBytes);
    
    if (!strategy.shouldChunk) {
      return 1; // No chunking = 1 chunk
    }
    
    return Math.ceil(fileSizeBytes / strategy.chunkSize);
  }


  /**
   * Validate file size
   * Ensures file isn't too large for our system
   * 
   * NEW: Recommend minimum 1GB device storage
   */
  validateFileSize(fileSizeBytes: number): { valid: boolean; error?: string } {

    // Don't exceed
    const maxSize = config.fileProcessing.maxFileSizeBytes;
    
    if (fileSizeBytes === 0) {
      return { valid: false, error: 'File is empty' };
    }
    
    if (fileSizeBytes > maxSize) {
      const maxGB = (maxSize / 1024 / 1024 / 1024).toFixed(2);
      const fileGB = (fileSizeBytes / 1024 / 1024 / 1024).toFixed(2);
      return { 
        valid: false, 
        error: `File too large (${fileGB}GB). Maximum: ${maxGB}GB` 
      };
    }
    
    return { valid: true };
  }

  
  /**
   * NEW: Get recommended minimum device storage
   * 
   * Since we no longer chunk small files, devices need at least 1GB
   */
  getMinimumDeviceStorage(): number {
    return this.NO_CHUNK_THRESHOLD; // 1GB
  }
}

export const chunkingService = new ChunkingService();