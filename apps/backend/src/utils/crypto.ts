import crypto from 'crypto';

/**
 * PRODUCTION-GRADE CRYPTOGRAPHY UTILITIES
 * 
 * Security Features:
 * ✅ AES-256-GCM with proper 12-byte IV
 * ✅ Key wrapping with KEK (Key Encryption Key)
 * ✅ Per-chunk key derivation via HKDF
 * ✅ AAD (Associated Authenticated Data) for metadata binding
 * ✅ Deterministic IV derivation (no reuse risk)
 * ✅ Ciphertext checksums (not plaintext!)
 * ✅ Input validation
 * ✅ Buffer zeroing
 * 
 * Threat Model:
 * - Protects against: data tampering, key leakage, IV reuse, chosen-ciphertext attacks
 * - Assumes: KEK is securely stored (env var for MVP, KMS for production)
 */

// ========================================
// CONSTANTS
// ========================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;              // 96-bit IV (standard for AES-GCM)
const AUTH_TAG_LENGTH = 16;        // 128-bit auth tag
const KEY_LENGTH = 32;             // 256-bit key
const HKDF_HASH = 'sha256';


// ========================================
// KEK setup
// ========================================


// initialize master with null
let MASTER_KEK: Buffer | null = null;

/**
 * Generate Master KEK (Key Encryption Key)
 * In production: we load it from KMS (AWS KMS)
 * For MVP: we use env (MUST be 64 hex chars = 32 bytes)
 */
export function initializeCrypto(kekHex: string): void {
  
    // KEK length check
  if (kekHex.length !== 64) {
    throw new Error('KEK must be 64 hex characters (32 bytes)');
  }

  // make buffer (bytes) from our KEK hex code and store it 
  MASTER_KEK = Buffer.from(kekHex, 'hex');
}

// use KEK anywhere
function getMasterKEK(): Buffer {
  if (!MASTER_KEK) {
    throw new Error('Crypto not initialized! Call initializeCrypto() first');
  }
  return MASTER_KEK;
}


// ========================================
// DEK MANAGEMENT
// ========================================

/**
 * Generate a new Data Encryption Key (DEK) for a file
 * Returns wrapped (encrypted) DEK that's safe to store in database
 */
export function generateWrappedDEK(): {
  wrappedDEK: string;  // Hex-encoded encrypted DEK
  dekId: string;       // Unique identifier
} {
  // Generate a random DEK
  const dek = crypto.randomBytes(KEY_LENGTH);
  
  // Generate unique ID to identify this DEK, store as hex
  const dekId = crypto.randomBytes(16).toString('hex');
  
  // get the Master key 
  const kek = getMasterKEK();

  // generate random nonce/IV
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // To encrypt the DEK create a cipher, using KEK & IV
  const cipher = crypto.createCipheriv(ALGORITHM, kek, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  
  // encrypt the DEK with the cipher consuming raw bytes 
  const encryptedDEK = Buffer.concat([
    cipher.update(dek),
    cipher.final(),
  ]);
  
  // tamper-proof detection for our DEK
  const authTag = cipher.getAuthTag();
  
  // Delete DEK bytes present in the RAM
  zeroBuffer(dek);
  
  // 1. pack all in one binary code 
  // 2. convert it to hex to store in DB
  // Format: iv + authTag + encryptedDEK (all hex)
  const wrappedDEK = Buffer.concat([iv, authTag, encryptedDEK]).toString('hex');
  
  // wrappedDEK -> store it 
  // dekId -> track the DEK
  return { wrappedDEK, dekId };
}


/**
 * Now if someone wishes to use the DEK for decrypting the file he calls this 
 */
export function unwrapDEK(wrappedDEK: string): Buffer {

  // convert into hex
  const wrapped = Buffer.from(wrappedDEK, 'hex');
  
  // Parse: iv (12) + authTag (16) + encryptedDEK (32)
  if (wrapped.length !== IV_LENGTH + AUTH_TAG_LENGTH + KEY_LENGTH) {
    throw new Error('Invalid wrapped DEK format');
  }
  
  // Split the hex code into -> IV + authTag + encryptedDEK
  const iv = wrapped.subarray(0, IV_LENGTH);
  const authTag = wrapped.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encryptedDEK = wrapped.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  
  // get masterKey
  const kek = getMasterKEK();
  
  // try decrypting in same order 
  const decipher = crypto.createDecipheriv(ALGORITHM, kek, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  // check if GCM tag is not tampered 
  decipher.setAuthTag(authTag);
  

  try {
    // decrypt the DEK
    const dek = Buffer.concat([
      decipher.update(encryptedDEK),
      decipher.final(),
    ]);

    // please zero this DEK (remove from RAM) using zeroBuffer(dek) after decrypting file
    return dek;

  } catch (error) {
    throw new Error('Failed to unwrap DEK: Invalid KEK or corrupted data');
  }
}
// export interface ChunkKey{
//     HKDF_HASH?:Buffer;
//     dek?:Buffer;
//     salt?: Buffer;
//     info?: Buffer;
// }

// ========================================
// PER-CHUNK KEY DERIVATION
// ========================================

/**
 * Derive a unique key for a specific chunk using HKDF
 * 
 * Why? If we used the same DEK for all chunks, IV reuse becomes risky.
 * By deriving per-chunk keys, each chunk has its own key space!
 * 
 * Formula: chunkKey = HKDF(dek, salt=fileId, info=chunkIndex)
 */
export function deriveChunkKey(
  dek: Buffer,
  fileId: string,
  chunkIndex: number
): Buffer {

    // length check
  if (dek.length !== KEY_LENGTH) {
    throw new Error('DEK must be 32 bytes');
  }
  

  // salt our key using fileID bits
  const salt = Buffer.from(fileId, 'utf-8');
  // these are bytes describing the chunk
  const info = Buffer.from(`chunk-${chunkIndex}`, 'utf-8');
  
  // HKDF is a safe way to derive many independent keys out of same DEK
  const chunkKey = Buffer.from(crypto.hkdfSync(
    HKDF_HASH,
    dek,
    salt,
    info,
    KEY_LENGTH
  ));
  
  return chunkKey;
}

// ========================================
// DETERMINISTIC IV GENERATION
// ========================================

/**
 * Why deterministic?
 * - Prevents accidental IV reuse (same inputs = same IV)
 * Formula: IV = HMAC(chunkKey, fileId || chunkIndex)[0:12]
 */
export function deriveChunkIV(
  chunkKey: Buffer,
  fileId: string,
  chunkIndex: number
): Buffer {

  // previously we used a random IV
  // this time we create a HMAC out of our fileID using chunkKey as secret 
  // so no possibility of repetition  
  const hmac = crypto.createHmac('sha256', chunkKey);
  hmac.update(fileId);
  hmac.update(Buffer.from([chunkIndex]));
  
  const hash = hmac.digest();
  return hash.subarray(0, IV_LENGTH);
}

// ========================================
// ENCRYPTION
// ========================================

/**
 * Result of chunk encryption
 * Note: No raw keys returned! Only references and ciphertext metadata
 */
export interface ChunkEncryptionResult {
  ciphertext: Buffer;
  iv: string;              // Hex-encoded
  authTag: string;         // Hex-encoded
  ciphertextHash: string;  // SHA-256 of ciphertext (for integrity)
  aad: string;             // Hex-encoded AAD
  sizeBytes: number;
}

/**
 * Associated Authenticated Data (AAD)
 */
export interface ChunkAAD {
  fileId: string;
  chunkIndex: number;
  version: number;  // For future upgrades
}

/**
 * Encrypt a chunk with proper key derivation and AAD
 * 
 * Process:
 * 1. Derive chunk-specific key from file DEK
 * 2. Generate deterministic IV
 * 3. Build AAD (metadata binding)
 * 4. Encrypt with AES-256-GCM
 * 5. Generate ciphertext hash
 * 6. Zero sensitive buffers
 */
export function encryptChunk(
  plaintext: Buffer,
  wrappedDEK: string,
  fileId: string,
  chunkIndex: number
): ChunkEncryptionResult {

  // Unwrap DEK
  const dek = unwrapDEK(wrappedDEK);
  
  try {
    // Derive chunk key
    const chunkKey = deriveChunkKey(dek, fileId, chunkIndex);
    
    // Generate deterministic IV
    const iv = deriveChunkIV(chunkKey, fileId, chunkIndex);
    
    // Build AAD 
    // While decrypting we authenticate this data to make sure everything is tamper proof
    const aad: ChunkAAD = {
      fileId,
      chunkIndex,
      version: 1,
    };
    // make it binary
    const aadBuffer = Buffer.from(JSON.stringify(aad), 'utf-8');
    
    // Prepare AES GCM chunk using chunkKey and IV to create cipher (the secret locker) 
    const cipher = crypto.createCipheriv(ALGORITHM, chunkKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    
    // Set AAD (authenticated but not encrypted)
    cipher.setAAD(aadBuffer);
    
    // Encrypt it
    const ciphertext = Buffer.concat([

      // convert plaintext chunk -> cipher Chun#$%&*
      cipher.update(plaintext),
      cipher.final(),
    ]);
    
    const authTag = cipher.getAuthTag();
    
    // Generate ciphertext hash 
    // This uses SHA-256
    // When the chunk comes back to us we ensure early on that it is just the way we sent it 
    const ciphertextHash = crypto
      .createHash('sha256')
      .update(ciphertext)
      .digest('hex');
    
    // remove chunkKey from RAM 
    zeroBuffer(chunkKey);
    
    return {
      ciphertext,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      ciphertextHash,
      aad: aadBuffer.toString('hex'),
      sizeBytes: ciphertext.length,
    };
  } finally {
    // Must do: remove DEK from memory 
    zeroBuffer(dek);
  }
}



// ========================================
// DECRYPTION
// ========================================

/**
 * Describe what all the chunk would come having
 */
export interface ChunkDecryptionInput {
  ciphertext: Buffer;
  iv: string;              // Hex
  authTag: string;         // Hex
  ciphertextHash: string;  // For verification
  aad: string;             // Hex
  wrappedDEK: string;
  fileId: string;
  chunkIndex: number;
}

/**
 * Decrypt a chunk with full validation
 * 
 * Process:
 * 1. Validate input lengths
 * 2. Verify ciphertext hash (detect corruption early)
 * 3. Unwrap DEK
 * 4. Derive chunk key
 * 5. Decrypt with AAD verification
 * 6. Zero sensitive buffers
 */
export function decryptChunk(input: ChunkDecryptionInput): Buffer {

  // Validate inputs (tamper - proofing)
  // 1. by IV
  const ivBuf = Buffer.from(input.iv, 'hex');
  // 2. by GCM
  const authTagBuf = Buffer.from(input.authTag, 'hex');
  // 3. by AAD
  const aadBuf = Buffer.from(input.aad, 'hex');
  
  if (ivBuf.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${ivBuf.length}`);
  }
  if (authTagBuf.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTagBuf.length}`);
  }
  
  // Verify and network transfer corruption using ciphertext Hash we just created
  const actualHash = crypto
    .createHash('sha256')
    .update(input.ciphertext)
    .digest('hex');
  
  if (actualHash !== input.ciphertextHash) {
    throw new Error('Ciphertext hash mismatch: Data corrupted');
  }

  // let's start decrypting
  // Unwrap DEK
  const dek = unwrapDEK(input.wrappedDEK);
  
  try {
    // Derive chunk key
    const chunkKey = deriveChunkKey(dek, input.fileId, input.chunkIndex);
    
    // Let's put all the spice and make a decipher!!
    const decipher = crypto.createDecipheriv(ALGORITHM, chunkKey, ivBuf, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    
    // Set AAD (must match encryption)
    decipher.setAAD(aadBuf);
    
    // Set auth tag
    decipher.setAuthTag(authTagBuf);
    
    // Decrypt
    try {

      // Our lovely chunk is back!!
      const plaintext = Buffer.concat([
        decipher.update(input.ciphertext),
        decipher.final(),
      ]);
      
      // remember: No keys in my RAM
      zeroBuffer(chunkKey);
      
      // return the chunk!!
      return plaintext;
      
    } catch (error) {
      throw new Error('Decryption failed: Invalid key, AAD, or tampered data');
    }
  } finally {
    // last swish
    zeroBuffer(dek);
  }
}

// ========================================
// ZERO BUFFER
// ========================================

/** 
 * We use it to scooby-doo all the Keys
 */
function zeroBuffer(buffer: Buffer): void {
  if (buffer && buffer.length > 0) {
    buffer.fill(0);
  }
}


// ========================================
// CHECKSUM
// ========================================

/**
 * This is used to ensure that the File is just in the order we sent it 
 * Generate checksum of data (basically of the file)
 */
export function generateChecksum(data: Buffer): string {
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex');
}

/**
 * Verify checksum
 * Verify if the File is upright
 */
export function verifyChecksum(data: Buffer, expectedChecksum: string): boolean {
  const actualChecksum = generateChecksum(data);
  return crypto.timingSafeEqual(
    Buffer.from(actualChecksum, 'hex'),
    Buffer.from(expectedChecksum, 'hex')
  );
}