import { prisma } from '../../config/database';
import { FileStatus, ChunkStatus } from '@prisma/client';
import { chunkingService } from './chunking.service';
import { FileData, ChunkData, FileQueryFilters } from '../../types/file.types';
import { chunkDistributionService } from '../chunks/distribution.service';

/**
 * File Service
 * 
 * Orchestrates the file upload/download process
 * Think of it as the "project manager" that coordinates:
 * - Chunking service (splits files)
 * - Database (stores metadata)
 * - Chunk assignment service (distributes to devices)
 */

class FileService {
  
  /**
   * When company uploads a file 
   * 
   * Flow:
   * 1. Validate file size
   * 2. Create File record in DB (status: UPLOADING)
   * 3. Process file (chunk + encrypt)
   * 4. Create Chunk records in DB
   * 5. Update File status to ACTIVE
   * 6. Trigger chunk distribution to devices
   * 
   * @returns File metadata with chunk count
   */
  async uploadFile(
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string,
    companyId: string
  ): Promise<FileData> {
    
    // Step 1: Validate file size
    // Shouldn't exceed max length
    const validation = chunkingService.validateFileSize(fileBuffer.length);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    
    // What are we uploading
    console.log(`📤 Starting upload: ${originalName} (${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
    
    // Step 2: Create File record (status: UPLOADING)
    // So if it fails later we would know where it failed
    const file = await prisma.file.create({
      data: {
        originalName,
        mimeType,
        sizeBytes: BigInt(fileBuffer.length),
        companyId,
        status: FileStatus.UPLOADING,
        chunkCount: chunkingService.calculateChunkCount(fileBuffer.length),

        // Temporary values (will be updated after processing)
        encryptionKey: 'processing',
        dekId: 'processing',
        checksum: 'processing',
      },
    });
    
    try {
      // Step 3: Process file (chunk + encrypt)
      const result = await chunkingService.processFile(
        fileBuffer,
        originalName,
        mimeType,
        file.id
      );
      
      // Step 4: Update File with encryption metadata
      await prisma.file.update({
        where: { id: file.id },
        data: {
          encryptionKey: result.fileMetadata.encryptionKey,
          dekId: result.fileMetadata.dekId,
          checksum: result.fileMetadata.checksum,
        },
      });
      
      // Step 5: Create Chunk records
      // Store metadata of each chunk one by one
      // This gets stored in the DB of files also
      for (const chunk of result.chunks) {
        await prisma.chunk.create({
          data: {
            fileId: file.id,
            sequenceNum: chunk.sequenceNum,
            sizeBytes: chunk.sizeBytes,
            checksum: chunk.checksum,
            iv: chunk.iv,
            authTag: chunk.authTag,
            aad: chunk.aad,
            status: ChunkStatus.PENDING,
            currentReplicas: 0,
            targetReplicas: 3,
          },
        });
      }
      
      // Step 6: Update File status to ACTIVE
      // meaning Fully replicated and available
      await prisma.file.update({
        where: { id: file.id },
        data: { status: FileStatus.ACTIVE },
      });
      
      console.log(`✅ Upload complete: ${file.id} (${result.chunks.length} chunks)`);
      

      // Step 7: Trigger chunk distribution to devices 
      // This must not hinder the accepting the file,chunking it, saving chunks to DB
      // After they happen we send response -> upload complete 
      // Then we start with distribution
      // setImmediate() -> Do it right after this
      // if we used just await then the uploadFile API would become slow
      setImmediate(async () => {
        try {
          await chunkDistributionService.distributeFileChunks(file.id);
        } catch (error) {
          console.error(`❌ Failed to distribute chunks for file ${file.id}:`, error);
        }
      });
      

      return this.convertToFileData(
        await prisma.file.findUnique({ where: { id: file.id } })
      );
      
    } catch (error) {
      // If processing fails, mark file as failed
      await prisma.file.update({
        where: { id: file.id },
        data: { status: FileStatus.DELETED },
      });
      
      console.error(`❌ Upload failed: ${file.id}`, error);
      throw error;
    }
  }



  // ========================================
  // UTILITIES AFTER UPLOAD
  // ========================================

  // These are mainly used to serve the client via file.controller.ts
  
  /**
   * Get file by ID
   */
  async getFile(fileId: string): Promise<FileData | null> {
    const file = await prisma.file.findUnique({
      where: { id: fileId },
    });
    
    return file ? this.convertToFileData(file) : null;
  }

  /**
   * List all files available with filters
   */
  async listFiles(filters: FileQueryFilters = {}): Promise<FileData[]> {
    const files = await prisma.file.findMany({
      where: {
        companyId: filters.companyId,
        status: filters.status,
        sizeBytes: {
          gte: filters.minSize ? BigInt(filters.minSize) : undefined,
          lte: filters.maxSize ? BigInt(filters.maxSize) : undefined,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    
    return files.map(f => this.convertToFileData(f));
  }


  /**
   * Get the chunk data for a specific file
   */
  async getFileChunks(fileId: string): Promise<ChunkData[]> {
    const chunks = await prisma.chunk.findMany({
      where: { fileId },
      orderBy: { sequenceNum: 'asc' },
    });
    
    return chunks.map(c => this.convertToChunkData(c));
  }

  /**
   * Get a chunk by it's ID
   */
  async getChunk(chunkId: string): Promise<ChunkData | null> {
    const chunk = await prisma.chunk.findUnique({
      where: { id: chunkId },
    });
    
    return chunk ? this.convertToChunkData(chunk) : null;
  }

  /**
   * Delete a file (marks as DELETED, cleanup happens in background)
   */
  async deleteFile(fileId: string): Promise<void> {
    await prisma.file.update({
      where: { id: fileId },
      data: { status: FileStatus.DELETED },
    });
    
    console.log(`🗑️ File marked for deletion: ${fileId}`);
    
    // TODO: Trigger background job to:
    // 1. Tell devices to delete chunks
    // 2. Remove chunk records from DB
    // 3. Remove file record from DB
  }

  /**
   * Get file statistics
   */
  async getFileStats(companyId?: string): Promise<{
    totalFiles: number;
    totalSizeBytes: number;
    activeFiles: number;
    totalChunks: number;
  }> {
    const where = companyId ? { companyId } : {};
    
    const files = await prisma.file.findMany({
      where,
      select: {
        sizeBytes: true,
        status: true,
        chunkCount: true,
      },
    });
    
    const totalFiles = files.length;
    const totalSizeBytes = files.reduce((sum, f) => sum + Number(f.sizeBytes), 0);
    const activeFiles = files.filter(f => f.status === FileStatus.ACTIVE).length;
    const totalChunks = files.reduce((sum, f) => sum + f.chunkCount, 0);
    
    return {
      totalFiles,
      totalSizeBytes,
      activeFiles,
      totalChunks,
    };
  }



  // ========================================
  // HELPERS FOR PRISMA CONVERSIONS   
  // ========================================

  // These are needed to alter or add on to the crude incoming Prisma DB data

  /**
   * Helper: Convert Prisma File to FileData
   * This specifically ensures size is in numbers and not BigInt
   */
  private convertToFileData(file: any): FileData {
    return {
      ...file,
      sizeBytes: Number(file.sizeBytes),
    };
  }

  /**
   * Helper: Convert Prisma Chunk to ChunkData
   * We'll add on to it later
   */
  private convertToChunkData(chunk: any): ChunkData {
    return {
      ...chunk,
    };
  }
}

export const fileService = new FileService();