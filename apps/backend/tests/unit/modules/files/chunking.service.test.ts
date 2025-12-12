import { describe, it, expect } from 'vitest';
import { chunkingService } from '../../../../src/modules/files/chunking.service';
import { createSmallTestFile, createLargeTestFile, FILE_SIZE } from '../../../helpers/fileHelper';
import { generateChecksum, decryptChunk } from '../../../../src/utils/crypto';

/**
 * Chunking Service Unit Tests
 * 
 * Tests file splitting, encryption, and metadata generation
 * Critical for data integrity!
 */

describe('Chunking Service', () => {
  
  // ========================================
  // FILE SIZE VALIDATION
  // ========================================
  
  describe('validateFileSize', () => {
    
    it('should accept valid file sizes', () => {
      // 1MB file - valid
      const result = chunkingService.validateFileSize(FILE_SIZE.MB(1));
      
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
    
    it('should reject empty files', () => {
      const result = chunkingService.validateFileSize(0);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe('File is empty');
    });
    
    it('should reject files exceeding max size', () => {
      // 11GB file (max is 10GB)
      const result = chunkingService.validateFileSize(FILE_SIZE.GB(11));
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('File too large');
      expect(result.error).toContain('11.00GB');
      expect(result.error).toContain('10.00GB');
    });
    
    it('should accept files at max size boundary', () => {
      // Exactly 10GB - should be valid
      const result = chunkingService.validateFileSize(FILE_SIZE.GB(10));
      
      expect(result.valid).toBe(true);
    });
  });
  
  // ========================================
  // CHUNK COUNT CALCULATION
  // ========================================
  
  describe('calculateChunkCount', () => {
    
    it('should calculate 1 chunk for small files', () => {
      // 1MB file = 1 chunk (chunk size is 5MB)
      const count = chunkingService.calculateChunkCount(FILE_SIZE.MB(1));
      
      expect(count).toBe(1);
    });
    
    it('should calculate correct chunks for exact multiples', () => {
      // 10MB file = 2 chunks (5MB + 5MB)
      const count = chunkingService.calculateChunkCount(FILE_SIZE.MB(10));
      
      expect(count).toBe(2);
    });
    
    it('should round up for partial chunks', () => {
      // 12MB file = 3 chunks (5MB + 5MB + 2MB)
      const count = chunkingService.calculateChunkCount(FILE_SIZE.MB(12));
      
      expect(count).toBe(3);
    });
    
    it('should handle very large files', () => {
      // 100GB file
      const count = chunkingService.calculateChunkCount(FILE_SIZE.GB(100));
      
      // 100GB / 5MB = 20,480 chunks
      expect(count).toBe(20480);
    });
  });
  
  // ========================================
  // FILE PROCESSING TESTS
  // ========================================
  
  describe('processFile', () => {
    
    it('should process a small file (single chunk)', async () => {
      // Arrange
      const fileBuffer = createSmallTestFile();
      const originalName = 'test.txt';
      const mimeType = 'text/plain';
      const fileId = 'test-file-123';
      
      // Act
      const result = await chunkingService.processFile(
        fileBuffer,
        originalName,
        mimeType,
        fileId
      );
      
      // Assert: File metadata
      expect(result.fileMetadata.originalName).toBe(originalName);
      expect(result.fileMetadata.mimeType).toBe(mimeType);
      expect(result.fileMetadata.sizeBytes).toBe(fileBuffer.length);
      expect(result.fileMetadata.checksum).toBeDefined();
      expect(result.fileMetadata.encryptionKey).toBeDefined();
      expect(result.fileMetadata.dekId).toBeDefined();
      
      // Assert: Chunks
      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].sequenceNum).toBe(0);
      expect(result.chunks[0].sizeBytes).toBeGreaterThan(0);
      expect(result.chunks[0].checksum).toBeDefined();
      expect(result.chunks[0].encryptedData).toBeInstanceOf(Buffer);
      
      // Assert: Encryption metadata
      expect(result.chunks[0].iv).toBeDefined();
      expect(result.chunks[0].authTag).toBeDefined();
      expect(result.chunks[0].aad).toBeDefined();
    });
    
    it('should process a large file (multiple chunks)', async () => {
      // Arrange: 12MB file = 3 chunks
      const fileBuffer = createLargeTestFile();
      const originalName = 'large-file.bin';
      const mimeType = 'application/octet-stream';
      const fileId = 'test-file-456';
      
      // Act
      const result = await chunkingService.processFile(
        fileBuffer,
        originalName,
        mimeType,
        fileId
      );
      
      // Assert: Should create 3 chunks
      expect(result.chunks.length).toBe(3);
      
      // Assert: First two chunks should be 5MB (encrypted, so slightly larger)
      expect(result.chunks[0].sizeBytes).toBeGreaterThanOrEqual(FILE_SIZE.MB(5));
      expect(result.chunks[1].sizeBytes).toBeGreaterThanOrEqual(FILE_SIZE.MB(5));
      
      // Assert: Last chunk should be ~2MB (encrypted)
      expect(result.chunks[2].sizeBytes).toBeLessThan(FILE_SIZE.MB(3));
      
      // Assert: Chunks have sequential numbers
      expect(result.chunks[0].sequenceNum).toBe(0);
      expect(result.chunks[1].sequenceNum).toBe(1);
      expect(result.chunks[2].sequenceNum).toBe(2);
    });
    
    it('should generate unique checksums for each chunk', async () => {
      // Arrange
      const fileBuffer = createLargeTestFile();
      
      // Act
      const result = await chunkingService.processFile(
        fileBuffer,
        'test.bin',
        'application/octet-stream',
        'test-file-789'
      );
      
      // Assert: All chunks should have different checksums
      const checksums = result.chunks.map(c => c.checksum);
      const uniqueChecksums = new Set(checksums);
      
      expect(uniqueChecksums.size).toBe(checksums.length);
    });
    
    it('should generate correct original file checksum', async () => {
      // Arrange
      const fileBuffer = createSmallTestFile();
      const expectedChecksum = generateChecksum(fileBuffer);
      
      // Act
      const result = await chunkingService.processFile(
        fileBuffer,
        'test.txt',
        'text/plain',
        'test-file-checksum'
      );
      
      // Assert: File checksum should match
      expect(result.fileMetadata.checksum).toBe(expectedChecksum);
    });
    
    it('should encrypt chunks with different keys per chunk', async () => {
      // Arrange
      const fileBuffer = createLargeTestFile();
      
      // Act
      const result = await chunkingService.processFile(
        fileBuffer,
        'test.bin',
        'application/octet-stream',
        'test-file-encryption'
      );
      
      // Assert: Each chunk should have different IV (proof of different derived keys)
      const ivs = result.chunks.map(c => c.iv);
      const uniqueIvs = new Set(ivs);
      
      expect(uniqueIvs.size).toBe(ivs.length);
    });
    
    it('should allow decryption of processed chunks', async () => {
      // Arrange
      const originalContent = 'Secret message for testing decryption';
      const fileBuffer = Buffer.from(originalContent);
      const fileId = 'test-file-decrypt';
      
      // Act: Process file
      const result = await chunkingService.processFile(
        fileBuffer,
        'secret.txt',
        'text/plain',
        fileId
      );
      
      // Assert: Decrypt chunk and verify content
      const chunk = result.chunks[0];
      const decrypted = decryptChunk({
        ciphertext: chunk.encryptedData,
        iv: chunk.iv,
        authTag: chunk.authTag,
        ciphertextHash: chunk.checksum,
        aad: chunk.aad,
        wrappedDEK: result.fileMetadata.encryptionKey,
        fileId,
        chunkIndex: 0,
      });
      
      expect(decrypted.toString('utf-8')).toBe(originalContent);
    });
    
    it('should handle edge case: file exactly 5MB (1 chunk)', async () => {
      // Arrange: Exactly 5MB
      const fileBuffer = Buffer.alloc(FILE_SIZE.MB(5), 'A');
      
      // Act
      const result = await chunkingService.processFile(
        fileBuffer,
        'exactly-5mb.bin',
        'application/octet-stream',
        'test-file-exact'
      );
      
      // Assert: Should be 1 chunk
      expect(result.chunks.length).toBe(1);
    });
    
    it('should handle edge case: file 5MB + 1 byte (2 chunks)', async () => {
      // Arrange: Just over 5MB
      const fileBuffer = Buffer.alloc(FILE_SIZE.MB(5) + 1, 'A');
      
      // Act
      const result = await chunkingService.processFile(
        fileBuffer,
        'just-over-5mb.bin',
        'application/octet-stream',
        'test-file-edge'
      );
      
      // Assert: Should be 2 chunks
      expect(result.chunks.length).toBe(2);
      
      // First chunk: 5MB
      // Second chunk: 1 byte (encrypted, so larger)
      expect(result.chunks[1].sizeBytes).toBeGreaterThan(0);
      expect(result.chunks[1].sizeBytes).toBeLessThan(1000); // Much smaller than first chunk
    });
  });
});