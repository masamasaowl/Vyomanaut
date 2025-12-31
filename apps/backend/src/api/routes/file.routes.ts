import { Router } from 'express';
import { fileController } from '../../modules/files/file.controller';
import { upload } from '../middleware/upload';
import { authenticate, authorize } from '../middleware/authenticate';
import { UserRole } from '@prisma/client';

/**
 * File Routes
 * Count : 6
 */

const router: Router = Router();

/**
 * POST /api/v1/files/upload
 * Upload a file
 * 
 * Form data:
 * - file: The file to upload
 * - companyId: (optional) Company identifier
 */
router.post(
  '/upload',

  // Verify JWT
   authenticate,
  // Only companies are allowed to upload files
   authorize(UserRole.COMPANY),
  // Multer handles file upload
  upload.single('file'), 
  (req, res) => fileController.uploadFile(req, res)
);

/**
 * GET /api/v1/files/:fileId/download
 * Download a file (returns binary data)
 */
router.get(
  '/:fileId/download',

   authenticate,
   // Only companies can download file back
   authorize(UserRole.COMPANY),
   (req, res) => fileController.downloadFile(req, res));

/**
 * GET /api/v1/files/stats
 * Get file statistics
 */
router.get('/stats', (req, res) => fileController.getStats(req, res));

/**
 * GET /api/v1/files
 * List all files
 */
router.get('/', (req, res) => fileController.listFiles(req, res));

/**
 * GET /api/v1/files/:fileId
 * Get specific file details
 */
router.get('/:fileId', (req, res) => fileController.getFile(req, res));

/**
 * GET /api/v1/files/:fileId/chunks
 * Get chunks for a file
 */
router.get('/:fileId/chunks', (req, res) => fileController.getFileChunks(req, res));

/**
 * DELETE /api/v1/files/:fileId
 * Delete a file
 */
router.delete('/:fileId', (req, res) => fileController.deleteFile(req, res));

export default router;