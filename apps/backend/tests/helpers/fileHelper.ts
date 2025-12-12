/**
 * File Processing Test Helpers
 * 
 * Utilities for creating test files and mock data
 */

/**
 * Generate a unique company ID for testing
 */
export function generateCompanyId(): string {
  return `test-company-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Create a test file buffer with specific content
 */
export function createTestFile(
  sizeKB: number,
  content?: string
): Buffer {
  if (content) {
    return Buffer.from(content);
  }
  
  // Generate random data of specified size
  const sizeBytes = sizeKB * 1024;
  return Buffer.alloc(sizeBytes, 'A'); // Fill with 'A' for deterministic testing
}

/**
 * Create a small test file (< 5MB, single chunk)
 */
export function createSmallTestFile(): Buffer {
  return createTestFile(100, 'This is a small test file for Vyomanaut!');
}

/**
 * Create a large test file (> 5MB, multiple chunks)
 */
export function createLargeTestFile(): Buffer {
  return createTestFile(12 * 1024); // 12MB = 3 chunks (5MB + 5MB + 2MB)
}

/**
 * File size helpers
 */
export const FILE_SIZE = {
  KB: (n: number) => n * 1024,
  MB: (n: number) => n * 1024 * 1024,
  GB: (n: number) => n * 1024 * 1024 * 1024,
};