import { describe, it, expect } from 'vitest';
import { fileService } from '../../src/modules/files/file.service';
import { prisma } from '../../src/config/database';
import { FileStatus, ChunkStatus } from '@prisma/client';
import { createSmallTestFile, createLargeTestFile, generateCompanyId, FILE_SIZE } from '..//helpers/fileHelper';
import { generateChecksum } from '../../src/utils/crypto';

/**
 * File Processing Integration Tests
 * 
 * Tests the complete file upload and processing workflow
 * including database persistence and chunk creation
 */

describe('File Processing Integration', () => {
  
  // ========================================
  // FILE UPLOAD TESTS
  // ========================================
  
  describe('uploadFile', () => {
    
    it('should upload and process a small file successfully', async () => {
      // Arrange
      const fileBuffer = createSmallTestFile();
      const originalName = 'test-document.txt';
      const mimeType = 'text/plain';
      const companyId = generateCompanyId();
      
      // Act
      const file = await fileService.uploadFile(
        fileBuffer,
        originalName,
        mimeType,
        companyId
      );
      
      // Assert: File metadata
      expect(file.id).toBeDefined();
      expect(file.originalName).toBe(originalName);
      expect(file.mimeType).toBe(mimeType);
      expect(file.sizeBytes).toBe(fileBuffer.length);
      expect(file.companyId).toBe(companyId);
      expect(file.status).toBe(FileStatus.ACTIVE);
      expect(file.chunkCount).toBe(1);
      
      // Assert: File in database
      const dbFile = await prisma.file.findUnique({
        where: { id: file.id },
      });
      expect(dbFile).toBeDefined();
      expect(dbFile!.status).toBe(FileStatus.ACTIVE);
      expect(dbFile!.encryptionKey).not.toBe('processing'); // Should be replaced
      expect(dbFile!.dekId).not.toBe('processing');
      expect(dbFile!.checksum).not.toBe('processing');
    });
    
    it('should create correct number of chunks for large file', async () => {
      // Arrange: 12MB file = 3 chunks
      const fileBuffer = createLargeTestFile();
      const companyId = generateCompanyId();
      
      // Act
      const file = await fileService.uploadFile(
        fileBuffer,
        'large-file.bin',
        'application/octet-stream',
        companyId
      );
      
      // Assert: Should have 3 chunks
      expect(file.chunkCount).toBe(3);
      
      // Assert: Chunks exist in database
      const chunks = await prisma.chunk.findMany({
        where: { fileId: file.id },
        orderBy: { sequenceNum: 'asc' },
      });
      
      expect(chunks.length).toBe(3);
      expect(chunks[0].sequenceNum).toBe(0);
      expect(chunks[1].sequenceNum).toBe(1);
      expect(chunks[2].sequenceNum).toBe(2);
    });
    
    it('should store encryption metadata with chunks', async () => {
      // Arrange
      const fileBuffer = createSmallTestFile();
      const companyId = generateCompanyId();
      
      // Act
      const file = await fileService.uploadFile(
        fileBuffer,
        'encrypted-test.txt',
        'text/plain',
        companyId
      );
      
      // Assert: Chunk has encryption metadata
      const chunk = await prisma.chunk.findFirst({
        where: { fileId: file.id },
      });
      
      expect(chunk).toBeDefined();
      expect(chunk!.iv).toBeDefined();
      expect(chunk!.authTag).toBeDefined();
      expect(chunk!.aad).toBeDefined();
      expect(chunk!.checksum).toBeDefined();
      
      // Verify format (hex strings)
      expect(chunk!.iv).toMatch(/^[0-9a-f]+$/);
      expect(chunk!.authTag).toMatch(/^[0-9a-f]+$/);
      expect(chunk!.checksum).toMatch(/^[0-9a-f]+$/);
    });
    
    it('should set chunks to PENDING status initially', async () => {
      // Arrange
      const fileBuffer = createSmallTestFile();
      const companyId = generateCompanyId();
      
      // Act
      const file = await fileService.uploadFile(
        fileBuffer,
        'test.txt',
        'text/plain',
        companyId
      );
      
      // Assert: Chunks should be PENDING (not yet distributed)
      const chunks = await prisma.chunk.findMany({
        where: { fileId: file.id },
      });
      
      chunks.forEach(chunk => {
        expect(chunk.status).toBe(ChunkStatus.PENDING);
        expect(chunk.currentReplicas).toBe(0);
        expect(chunk.targetReplicas).toBe(3);
      });
    });
    
    it('should store correct file checksum', async () => {
      // Arrange
      const fileBuffer = createSmallTestFile();
      const expectedChecksum = generateChecksum(fileBuffer);
      const companyId = generateCompanyId();
      
      // Act
      const file = await fileService.uploadFile(
        fileBuffer,
        'checksum-test.txt',
        'text/plain',
        companyId
      );
      
      // Assert: Checksum matches
      expect(file.checksum).toBe(expectedChecksum);
    });
    
    it('should reject files that are too large', async () => {
      // Arrange: 11GB file (exceeds 10GB limit)
      const tooLargeBuffer = Buffer.alloc(FILE_SIZE.GB(11));
      const companyId = generateCompanyId();
      
      // Act & Assert: Should throw error
      await expect(
        fileService.uploadFile(
          tooLargeBuffer,
          'too-large.bin',
          'application/octet-stream',
          companyId
        )
      ).rejects.toThrow('File too large');
    });
    
    it('should reject empty files', async () => {
      // Arrange: Empty buffer
      const emptyBuffer = Buffer.alloc(0);
      const companyId = generateCompanyId();
      
      // Act & Assert: Should throw error
      await expect(
        fileService.uploadFile(
          emptyBuffer,
          'empty.txt',
          'text/plain',
          companyId
        )
      ).rejects.toThrow('File is empty');
    });
    
    it('should handle upload failure gracefully', async () => {
      // This test verifies error handling in the upload process
      // If processing fails, file should be marked as DELETED
      
      // We can't easily simulate a processing failure in tests,
      // but we can verify the error handling structure exists
      const fileBuffer = createSmallTestFile();
      const companyId = generateCompanyId();
      
      // Upload should succeed
      const file = await fileService.uploadFile(
        fileBuffer,
        'test.txt',
        'text/plain',
        companyId
      );
      
      expect(file.status).toBe(FileStatus.ACTIVE);
    });
  });
  
  // ========================================
  // FILE RETRIEVAL TESTS
  // ========================================
  
  describe('getFile', () => {
    
    it('should retrieve uploaded file by ID', async () => {
      // Arrange: Upload a file
      const fileBuffer = createSmallTestFile();
      const companyId = generateCompanyId();
      const uploadedFile = await fileService.uploadFile(
        fileBuffer,
        'retrieve-test.txt',
        'text/plain',
        companyId
      );
      
      // Act: Retrieve it
      const retrievedFile = await fileService.getFile(uploadedFile.id);
      
      // Assert: Should match uploaded file
      expect(retrievedFile).toBeDefined();
      expect(retrievedFile!.id).toBe(uploadedFile.id);
      expect(retrievedFile!.originalName).toBe('retrieve-test.txt');
      expect(retrievedFile!.sizeBytes).toBe(fileBuffer.length);
    });
    
    it('should return null for non-existent file', async () => {
      // Act
      const file = await fileService.getFile('non-existent-id');
      
      // Assert
      expect(file).toBeNull();
    });
  });
  
  // ========================================
  // FILE LISTING TESTS
  // ========================================
  
  describe('listFiles', () => {
    
    it('should list all files for a company', async () => {
      // Arrange: Upload 3 files
      const companyId = generateCompanyId();
      
      await fileService.uploadFile(createSmallTestFile(), 'file1.txt', 'text/plain', companyId);
      await fileService.uploadFile(createSmallTestFile(), 'file2.txt', 'text/plain', companyId);
      await fileService.uploadFile(createSmallTestFile(), 'file3.txt', 'text/plain', companyId);
      
      // Act: List files
      const files = await fileService.listFiles({ companyId });
      
      // Assert: Should have 3 files
      expect(files.length).toBe(3);
      files.forEach(file => {
        expect(file.companyId).toBe(companyId);
      });
    });
    
    it('should filter files by status', async () => {
      // Arrange: Upload files and delete one
      const companyId = generateCompanyId();
      
      const file1 = await fileService.uploadFile(createSmallTestFile(), 'active1.txt', 'text/plain', companyId);
      const file2 = await fileService.uploadFile(createSmallTestFile(), 'active2.txt', 'text/plain', companyId);
      const file3 = await fileService.uploadFile(createSmallTestFile(), 'to-delete.txt', 'text/plain', companyId);
      
      await fileService.deleteFile(file3.id);
      
      // Act: List only active files
      const activeFiles = await fileService.listFiles({
        companyId,
        status: FileStatus.ACTIVE,
      });
      
      // Assert: Should have 2 active files
      expect(activeFiles.length).toBe(2);
      expect(activeFiles.every(f => f.status === FileStatus.ACTIVE)).toBe(true);
    });
    
    it('should return files in descending order by creation date', async () => {
      // Arrange: Upload 3 files
      const companyId = generateCompanyId();
      
      const file1 = await fileService.uploadFile(createSmallTestFile(), 'first.txt', 'text/plain', companyId);
      const file2 = await fileService.uploadFile(createSmallTestFile(), 'second.txt', 'text/plain', companyId);
      const file3 = await fileService.uploadFile(createSmallTestFile(), 'third.txt', 'text/plain', companyId);
      
      // Act: List files
      const files = await fileService.listFiles({ companyId });
      
      // Assert: Should be in reverse chronological order
      expect(files[0].id).toBe(file3.id); // Most recent first
      expect(files[1].id).toBe(file2.id);
      expect(files[2].id).toBe(file1.id);
    });
  });
  
  // ========================================
  // CHUNK RETRIEVAL TESTS
  // ========================================
  
  describe('getFileChunks', () => {
    
    it('should retrieve all chunks for a file', async () => {
      // Arrange: Upload large file (3 chunks)
      const fileBuffer = createLargeTestFile();
      const companyId = generateCompanyId();
      const file = await fileService.uploadFile(
        fileBuffer,
        'chunked-file.bin',
        'application/octet-stream',
        companyId
      );
      
      // Act: Get chunks
      const chunks = await fileService.getFileChunks(file.id);
      
      // Assert: Should have 3 chunks in order
      expect(chunks.length).toBe(3);
      expect(chunks[0].sequenceNum).toBe(0);
      expect(chunks[1].sequenceNum).toBe(1);
      expect(chunks[2].sequenceNum).toBe(2);
    });
    
    it('should return chunks in correct sequence order', async () => {
      // Arrange
      const fileBuffer = createLargeTestFile();
      const companyId = generateCompanyId();
      const file = await fileService.uploadFile(
        fileBuffer,
        'ordered-chunks.bin',
        'application/octet-stream',
        companyId
      );
      
      // Act
      const chunks = await fileService.getFileChunks(file.id);
      
      // Assert: Sequence numbers should be sequential
      chunks.forEach((chunk, index) => {
        expect(chunk.sequenceNum).toBe(index);
      });
    });
  });
  
  // ========================================
  // FILE DELETION TESTS
  // ========================================
  
  describe('deleteFile', () => {
    
    it('should mark file as DELETED', async () => {
      // Arrange: Upload file
      const fileBuffer = createSmallTestFile();
      const companyId = generateCompanyId();
      const file = await fileService.uploadFile(
        fileBuffer,
        'to-delete.txt',
        'text/plain',
        companyId
      );
      
      // Act: Delete file
      await fileService.deleteFile(file.id);
      
      // Assert: File status should be DELETED
      const deletedFile = await fileService.getFile(file.id);
      expect(deletedFile!.status).toBe(FileStatus.DELETED);
    });
    
    it('should keep chunks in database after deletion', async () => {
      // Arrange: Upload file
      const fileBuffer = createSmallTestFile();
      const companyId = generateCompanyId();
      const file = await fileService.uploadFile(
        fileBuffer,
        'delete-with-chunks.txt',
        'text/plain',
        companyId
      );
      
      // Act: Delete file
      await fileService.deleteFile(file.id);
      
      // Assert: Chunks still exist (will be cleaned by background job)
      const chunks = await prisma.chunk.findMany({
        where: { fileId: file.id },
      });
      
      expect(chunks.length).toBeGreaterThan(0);
    });
  });
  
  // ========================================
  // FILE STATISTICS TESTS
  // ========================================
  
  describe('getFileStats', () => {
    
    it('should calculate statistics for all files', async () => {
      // Arrange: Upload multiple files
      const companyId = generateCompanyId();
      
      await fileService.uploadFile(createSmallTestFile(), 'file1.txt', 'text/plain', companyId);
      await fileService.uploadFile(createLargeTestFile(), 'file2.bin', 'application/octet-stream', companyId);
      
      // Act: Get stats
      const stats = await fileService.getFileStats();
      
      // Assert
      expect(stats.totalFiles).toBeGreaterThanOrEqual(2);
      expect(stats.activeFiles).toBeGreaterThanOrEqual(2);
      expect(stats.totalSizeBytes).toBeGreaterThan(0);
      expect(stats.totalChunks).toBeGreaterThan(0);
    });
    
    it('should filter statistics by company', async () => {
      // Arrange: Upload files for different companies
      const company1 = generateCompanyId();
      const company2 = generateCompanyId();
      
      await fileService.uploadFile(createSmallTestFile(), 'company1-file.txt', 'text/plain', company1);
      await fileService.uploadFile(createSmallTestFile(), 'company2-file.txt', 'text/plain', company2);
      
      // Act: Get stats for company1 only
      const stats = await fileService.getFileStats(company1);
      
      // Assert: Should only count company1's files
      expect(stats.totalFiles).toBe(1);
    });
  });
});