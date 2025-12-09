import { FileStatus } from '@prisma/client';

/**
 * File & Chunk Types
 * 
 * These define how we track uploaded files and their chunks
 */

// ========================================
// INCOMING DATA (from company)
// ========================================

/**
 * When a company uploads a file
 * This comes from the multipart/form-data request
 */
export interface FileUploadPayload {
  companyId: string;          // Who's uploading
  file: Express.Multer.File;  // The actual file (handled by Multer)
}

// ========================================
// OUTGOING DATA (to company)
// ========================================

/**
 * Response after successful upload
 * Company gets this to track their file
 */
export interface FileUploadResponse {
  success: boolean;

  // These fields are given by Multer
  file: {
    id: string;              // Our internal file ID
    originalName: string;
    sizeBytes: number;
    mimeType: string;
    chunkCount: number;
    status: FileStatus;
    uploadedAt: Date;
  };
  message: string;
}

/**
 * Response when downloading a file
 * Company uses this to retrieve their file
 */
export interface FileDownloadResponse {
  success: boolean;

  // Binary data, might be useful
  fileBuffer?: Buffer;     
  fileName?: string;
  mimeType?: string;
  error?: string;
}

// ========================================
// INTERNAL DATA
// ========================================

/**
 * File metadata stored in database
 * matches the File model of prisma
 */
export interface FileData {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  companyId: string;
  
  // Encryption
  encryptionKey: string;    // AES key 
  checksum: string;         // SHA-256 of original file

  // Status tracking
  status: FileStatus;
  chunkCount: number;
  
  createdAt: Date;
  updatedAt: Date;
}


/**
 * Individual chunk metadata
 * Matches the Chunk model in prisma 
 */
export interface ChunkData {
  id: string;
  fileId: string;
  sequenceNum: number;      // Order: 0, 1, 2, 3...
  sizeBytes: number;
  // SHA-256 of encrypted chunk
  checksum: string;         
  
  status: string;

  // How many devices have this chunk
  currentReplicas: number;  
  targetReplicas: number;   // Should be 3
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * When a chunk is ready to be distributed to devices or ready to be decrypted, we use this 
 * This includes the actual encrypted data
 */
export interface ChunkWithData {
  id: string;
  sequenceNum: number;
  sizeBytes: number;
  checksum: string;
  encryptedData: Buffer;    // The actual encrypted chunk bytes
}


/**
 * Now when we run our encryption and file separation logic then a result is returned 
 * 
 * It contain the information of the raw input file and of all the encrypted chunks formed out of it in the form of an Array
 */
export interface FileProcessingResult {
  fileMetadata: {
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
    encryptionKey: string;
    dekId:string;

  };
  chunks: Array<{
    sequenceNum: number;
    sizeBytes: number;
    checksum: string;
    encryptedData: Buffer;
    
    // Encryption metadata (needed for decryption)
    iv: string;
    authTag: string;
    aad: string;
  }>;
}


// ========================================
// QUERY FILTERS
// ========================================

/**
 * To find a particular file 
 */
export interface FileQueryFilters {
  companyId?: string;
  status?: FileStatus;
  minSize?: number;
  maxSize?: number;
}

// ========================================
// CONSTANTS
// ========================================

/**
 * File processing configuration
 * These are already defined inside our env vars but we define them here for type safety
 */
export interface FileProcessingConfig {
  chunkSizeBytes: number;      // 5MB = 5 * 1024 * 1024
  maxFileSizeBytes: number;    // 10GB max
  redundancyFactor: number;    // 3 copies per chunk
  tempStoragePath: string;     // Where to store chunks temporarily
}