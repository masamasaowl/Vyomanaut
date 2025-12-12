import { describe, it, expect } from 'vitest';
import {
  generateWrappedDEK,
  unwrapDEK,
  encryptChunk,
  decryptChunk,
  generateChecksum,
  verifyChecksum,
} from '../../../src/utils/crypto';

/**
 * Crypto Utils Unit Tests
 * Total: 15 test cases
 * 
 * Tests the cryptographic operations that power our distributed storage
 * These are critical - any bugs here compromise security!
 */

describe('Crypto Utils', () => {
  
  // ========================================
  // KEY MANAGEMENT TESTS
  // ========================================
  
  describe('DEK Generation & Wrapping', () => {
    
    it('should generate a wrapped DEK with unique ID', () => {
      // Generate two DEKs
      const dek1 = generateWrappedDEK();
      const dek2 = generateWrappedDEK();
      
      // Each should have a unique ID
      expect(dek1.dekId).toBeDefined();
      expect(dek2.dekId).toBeDefined();
      expect(dek1.dekId).not.toBe(dek2.dekId);
      
      // Wrapped DEK should be hex string
      expect(dek1.wrappedDEK).toMatch(/^[0-9a-f]+$/);
      expect(dek2.wrappedDEK).toMatch(/^[0-9a-f]+$/);
      
      // Wrapped DEKs should be different (due to random IV)
      expect(dek1.wrappedDEK).not.toBe(dek2.wrappedDEK);
    });
    
    it('should wrap and unwrap DEK correctly', () => {
      // Generate a wrapped DEK
      const { wrappedDEK } = generateWrappedDEK();
      
      // Unwrap it
      const unwrappedDEK = unwrapDEK(wrappedDEK);
      
      // Should be a 32-byte buffer (256-bit key)
      expect(unwrappedDEK).toBeInstanceOf(Buffer);
      expect(unwrappedDEK.length).toBe(32);
      
      // Unwrapping twice should give same result
      const unwrappedDEK2 = unwrapDEK(wrappedDEK);
      expect(unwrappedDEK.equals(unwrappedDEK2)).toBe(true);
    });
    
    it('should throw error on invalid wrapped DEK', () => {
      // Invalid hex string
      expect(() => unwrapDEK('invalid-hex')).toThrow();
      
      // Wrong length
      expect(() => unwrapDEK('0123456789abcdef')).toThrow();
      
      // Valid format but wrong data (will fail auth tag verification)
      const invalidWrappedDEK = '0'.repeat(120); // 60 bytes in hex
      expect(() => unwrapDEK(invalidWrappedDEK)).toThrow('Failed to unwrap DEK');
    });
  });
  
  // ========================================
  // ENCRYPTION/DECRYPTION TESTS
  // ========================================
  
  describe('Chunk Encryption & Decryption', () => {
    
    it('should encrypt and decrypt chunk correctly', () => {
      // Test data
      const plaintext = Buffer.from('Hello, Vyomanaut! This is a secret message.');
      const { wrappedDEK } = generateWrappedDEK();
      const fileId = 'test-file-123';
      const chunkIndex = 0;
      
      // Encrypt
      const encrypted = encryptChunk(plaintext, wrappedDEK, fileId, chunkIndex);
      
      // Verify encryption result structure
      expect(encrypted.ciphertext).toBeInstanceOf(Buffer);
      expect(encrypted.iv).toMatch(/^[0-9a-f]+$/);
      expect(encrypted.authTag).toMatch(/^[0-9a-f]+$/);
      expect(encrypted.ciphertextHash).toMatch(/^[0-9a-f]+$/);
      expect(encrypted.aad).toMatch(/^[0-9a-f]+$/);
      expect(encrypted.sizeBytes).toBeGreaterThan(0);
      
      // Ciphertext should be different from plaintext
      expect(encrypted.ciphertext.equals(plaintext)).toBe(false);
      
      // Decrypt
      const decrypted = decryptChunk({
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        ciphertextHash: encrypted.ciphertextHash,
        aad: encrypted.aad,
        wrappedDEK,
        fileId,
        chunkIndex,
      });
      
      // Should match original plaintext
      expect(decrypted.equals(plaintext)).toBe(true);
    });
    
    it('should produce different ciphertexts for same plaintext (different chunks)', () => {
      const plaintext = Buffer.from('Same content');
      const { wrappedDEK } = generateWrappedDEK();
      const fileId = 'test-file-123';
      
      // Encrypt same content as chunk 0 and chunk 1
      const encrypted0 = encryptChunk(plaintext, wrappedDEK, fileId, 0);
      const encrypted1 = encryptChunk(plaintext, wrappedDEK, fileId, 1);
      
      // Ciphertexts should be different (different derived keys and IVs)
      expect(encrypted0.ciphertext.equals(encrypted1.ciphertext)).toBe(false);
      expect(encrypted0.iv).not.toBe(encrypted1.iv);
      
      // But both should decrypt to same plaintext
      const decrypted0 = decryptChunk({
        ciphertext: encrypted0.ciphertext,
        iv: encrypted0.iv,
        authTag: encrypted0.authTag,
        ciphertextHash: encrypted0.ciphertextHash,
        aad: encrypted0.aad,
        wrappedDEK,
        fileId,
        chunkIndex: 0,
      });
      
      const decrypted1 = decryptChunk({
        ciphertext: encrypted1.ciphertext,
        iv: encrypted1.iv,
        authTag: encrypted1.authTag,
        ciphertextHash: encrypted1.ciphertextHash,
        aad: encrypted1.aad,
        wrappedDEK,
        fileId,
        chunkIndex: 1,
      });
      
      expect(decrypted0.equals(plaintext)).toBe(true);
      expect(decrypted1.equals(plaintext)).toBe(true);
    });
    
    it('should detect tampering of ciphertext', () => {
      const plaintext = Buffer.from('Secret data');
      const { wrappedDEK } = generateWrappedDEK();
      const fileId = 'test-file-123';
      const chunkIndex = 0;
      
      const encrypted = encryptChunk(plaintext, wrappedDEK, fileId, chunkIndex);
      
      // Tamper with ciphertext (flip one bit)
      const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
      tamperedCiphertext[0] ^= 1;
      
      // Decryption should fail
      expect(() => {
        decryptChunk({
          ciphertext: tamperedCiphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          ciphertextHash: encrypted.ciphertextHash,
          aad: encrypted.aad,
          wrappedDEK,
          fileId,
          chunkIndex,
        });
      }).toThrow('Ciphertext hash mismatch');
    });
    
    it('should detect tampering of AAD (metadata binding)', () => {
      const plaintext = Buffer.from('Secret data');
      const { wrappedDEK } = generateWrappedDEK();
      const fileId = 'test-file-123';
      const chunkIndex = 0;
      
      const encrypted = encryptChunk(plaintext, wrappedDEK, fileId, chunkIndex);
      
      // Try to decrypt with wrong chunk index (AAD mismatch)
      expect(() => {
        decryptChunk({
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          ciphertextHash: encrypted.ciphertextHash,
          aad: encrypted.aad,
          wrappedDEK,
          fileId,
          chunkIndex: 999, // Wrong index!
        });
      }).toThrow();
    });
    
    it('should validate input lengths', () => {
      const { wrappedDEK } = generateWrappedDEK();
      const ciphertext = Buffer.from('test');
      
      // Invalid IV length (should be 24 hex chars = 12 bytes)
      expect(() => {
        decryptChunk({
          ciphertext,
          iv: 'short',
          authTag: '0'.repeat(32),
          ciphertextHash: '0'.repeat(64),
          aad: '0'.repeat(20),
          wrappedDEK,
          fileId: 'test',
          chunkIndex: 0,
        });
      }).toThrow('Invalid IV length');
      
      // Invalid auth tag length (should be 32 hex chars = 16 bytes)
      expect(() => {
        decryptChunk({
          ciphertext,
          iv: '0'.repeat(24),
          authTag: 'short',
          ciphertextHash: '0'.repeat(64),
          aad: '0'.repeat(20),
          wrappedDEK,
          fileId: 'test',
          chunkIndex: 0,
        });
      }).toThrow('Invalid auth tag length');
    });
  });
  
  // ========================================
  // CHECKSUM TESTS
  // ========================================
  
  describe('Checksum Generation & Verification', () => {
    
    it('should generate consistent checksums', () => {
      const data = Buffer.from('Test data for checksum');
      
      const checksum1 = generateChecksum(data);
      const checksum2 = generateChecksum(data);
      
      // Same data should produce same checksum
      expect(checksum1).toBe(checksum2);
      
      // Should be 64 hex characters (SHA-256)
      expect(checksum1).toMatch(/^[0-9a-f]{64}$/);
    });
    
    it('should produce different checksums for different data', () => {
      const data1 = Buffer.from('Data 1');
      const data2 = Buffer.from('Data 2');
      
      const checksum1 = generateChecksum(data1);
      const checksum2 = generateChecksum(data2);
      
      expect(checksum1).not.toBe(checksum2);
    });
    
    it('should detect even single byte changes', () => {
      const data1 = Buffer.from('Test data');
      const data2 = Buffer.from('Test datb'); // Changed last char
      
      const checksum1 = generateChecksum(data1);
      const checksum2 = generateChecksum(data2);
      
      expect(checksum1).not.toBe(checksum2);
    });
    
    it('should verify checksums correctly', () => {
      const data = Buffer.from('Test data');
      const checksum = generateChecksum(data);
      
      // Correct checksum should verify
      expect(verifyChecksum(data, checksum)).toBe(true);
      
      // Wrong checksum should fail
      const wrongChecksum = '0'.repeat(64);
      expect(verifyChecksum(data, wrongChecksum)).toBe(false);
      
      // Modified data should fail
      const modifiedData = Buffer.from('Test datb');
      expect(verifyChecksum(modifiedData, checksum)).toBe(false);
    });
  });
});