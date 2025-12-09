import { config } from '../../config/env';
import { 
  generateWrappedDEK, 
  encryptChunk, 
  generateChecksum 
} from '../../utils/crypto';
import { FileProcessingResult } from '../../types/file.types';

/**
 * Chunking Service
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
  
    // define chunk size (cannot be changed)
  private readonly chunkSize: number;
  
  // set chunksize from the env 
  // do this only once
  constructor() {
    // pull from env
    this.chunkSize = config.fileProcessing.chunkSizeBytes;

    // what size is it 
    console.log(`🍕 Chunking service initialized (chunk size: ${(this.chunkSize / 1024 / 1024).toFixed(2)}MB)`);
  }


  /**
   * This is a method to 
   * Process a file: chunk it and encrypt each chunk
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
    
    // show which file we are processing with the size 
    console.log(`Processing file: ${originalName} (${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
    
    
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
    
  
    // Step 3: Split file into chunks
    const chunks = this.splitIntoChunks(fileBuffer);
    console.log(`Split into ${chunks.length} chunks`);
    

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
   * Example:
   * File: 12MB
   * Chunk size: 5MB
   * Result: [5MB, 5MB, 2MB]
   * 
   * Like cutting a 12-inch pizza into 5-inch slices!
   */
  private splitIntoChunks(fileBuffer: Buffer): Buffer[] {

    // create arrays which store Buffers (the chunks)
    const chunks: Buffer[] = [];

    // Track how many bytes have we cut till now 
    let offset = 0;
    

    // A pizza cutting loop
    while (offset < fileBuffer.length) {

      // How much pizza is left to cut
      // (last chunk might be smaller)
      const remainingBytes = fileBuffer.length - offset;
      // depend on smaller value
      const currentChunkSize = Math.min(this.chunkSize, remainingBytes);
      
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
    return Math.ceil(fileSizeBytes / this.chunkSize);
  }

  /**
   * Validate file size
   * Ensures file isn't too large for our system
   */
  validateFileSize(fileSizeBytes: number): { valid: boolean; error?: string } {
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
}

export const chunkingService = new ChunkingService();