import multer from 'multer';
import { config } from '../../config/env';

/**
 * Multer Upload Middleware
 * 
 * Handles multipart/form-data file uploads
 * Stores files in memory (as Buffer) for processing
 */

/** 
 * We use memory storage
 * But Why?
 * - We need the entire file to chunk it
 * - Temporary storage (we don't keep it after chunking)
 * - Simpler than disk storage for this use case
 */

const storage = multer.memoryStorage();

/**
 * File filter - validate file before accepting
 */
const fileFilter = (
  req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  // For MVP: Accept all files
  // In production: Add whitelist/blacklist of MIME types
  cb(null, true);
};


/**
 * Multer configuration
 */
export const upload = multer({
  storage,
  fileFilter,

  // ensure file size does not exceed maximum
  limits: {
    fileSize: config.fileProcessing.maxFileSizeBytes,
  },
});

/**
 * Single file upload middleware
 * Use in routes: upload.single('file')
 * 
 * Example:
 * router.post('/upload', upload.single('file'), controller.uploadFile);
 */