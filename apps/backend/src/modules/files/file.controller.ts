import { Request, Response } from 'express';
import { fileService } from './file.service';
import { FileQueryFilters } from '../../types/file.types';
import { FileStatus } from '@prisma/client';

/**
 * File Controller served by file.service.ts
 * 
 * Handles HTTP requests for file operations
 */

class FileController {
  
  /**
   * @desc    Upload a file
   * @route   POST /api/v1/files/upload
   * 
   * 
   * Body: multipart/form-data with 'file' field
   * 
   * Note: File is uploaded via Multer middleware
   */
  async uploadFile(req: Request, res: Response): Promise<void> {

    try {
      // File comes from Multer middleware
      const file = req.file;
      
      if (!file) {
        res.status(400).json({
          success: false,
          error: 'No file uploaded',
        });
        return;
      }
      
      // Get companyId from request (later: from JWT token)
      const companyId = req.body.companyId || 'demo-company';
      
      console.log(`📥 Received upload request: ${file.originalname}`);
      
      // Process the file in our File Service
      const fileData = await fileService.uploadFile(
        file.buffer,
        file.originalname,
        file.mimetype,
        companyId
      );
      

      // respond to client with the data
      res.json({
        success: true,
        file: {
          id: fileData.id,
          originalName: fileData.originalName,
          sizeBytes: fileData.sizeBytes,
          sizeMB: (fileData.sizeBytes / 1024 / 1024).toFixed(2),
          mimeType: fileData.mimeType,
          chunkCount: fileData.chunkCount,
          status: fileData.status,
          uploadedAt: fileData.createdAt,
        },
        message: 'File uploaded and processed successfully!',
      });
      
    } catch (error) {
      console.error('❌ Error uploading file:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload file',
      });
    }
  }

  /**
   * @desc    Download a file
   * @route   GET /api/v1/files/:fileId/download
   * 
   * Returns the actual file as binary data
   */
  async downloadFile(req: Request, res: Response): Promise<void> {
    try {
      // Extract the file ID
      const { fileId } = req.params;
      
      console.log(`⬇️ Download request for file ${fileId}`);
      // Fetch the file
      const result = await fileService.downloadFile(fileId);
      

      // We must tell the browser or Axios receiving our response about what it is looking at 
      // It is not normal JSON
      // So our response header looks like this

      // 1. We define the MIME type 
      res.setHeader('Content-Type', result.mimeType);
      // 2. We tell it about the name of the file
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
      // 3. We inform the size of the file so the download progress bar can be formed
      res.setHeader('Content-Length', result.fileBuffer.length);
      

      // We send the file
      res.send(result.fileBuffer);
      
      console.log(`✅ Download sent: ${result.fileName}`);
      
    } catch (error) {
      console.error('❌ Error downloading file:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to download file',
      });
    }
  }


  /**
   * @desc    List all files with filters
   * @route   GET /api/v1/files
   */
  async listFiles(req: Request, res: Response): Promise<void> {
    try {
      const filters: FileQueryFilters = {
        companyId: req.query.companyId as string,
        status: req.query.status as FileStatus,
        minSize: req.query.minSize ? parseInt(req.query.minSize as string) : undefined,
        maxSize: req.query.maxSize ? parseInt(req.query.maxSize as string) : undefined,
      };
      
      const files = await fileService.listFiles(filters);
      
      res.json({
        success: true,
        count: files.length,
        files: files.map(f => ({
          ...f,
          sizeMB: (f.sizeBytes / 1024 / 1024).toFixed(2),
        })),
      });
      
    } catch (error) {
      console.error('❌ Error listing files:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list files',
      });
    }
  }


  /**
   * @desc    Get file details via ID
   * @route   GET /api/v1/files/:fileId
   */
  async getFile(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params;
      
      const file = await fileService.getFile(fileId);
      
      if (!file) {
        res.status(404).json({
          success: false,
          error: 'File not found',
        });
        return;
      }
      
      res.json({
        success: true,
        file: {
          ...file,
          sizeMB: (file.sizeBytes / 1024 / 1024).toFixed(2),
        },
      });
      
    } catch (error) {
      console.error('❌ Error getting file:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get file',
      });
    }
  }


  /**
   * @desc    Get chunks for a file by ID
   * @route   GET /api/v1/files/:fileId/chunks
   */
  async getFileChunks(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params;
      
      const chunks = await fileService.getFileChunks(fileId);
      
      res.json({
        success: true,
        count: chunks.length,
        chunks: chunks.map(c => ({
          id: c.id,
          sequenceNum: c.sequenceNum,
          sizeBytes: c.sizeBytes,
          sizeKB: (c.sizeBytes / 1024).toFixed(2),
          status: c.status,
          currentReplicas: c.currentReplicas,
          targetReplicas: c.targetReplicas,
        })),
      });
      
    } catch (error) {
      console.error('❌ Error getting chunks:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get chunks',
      });
    }
  }


  /**
   * @desc    Delete a file
   * @route   DELETE /api/v1/files/:fileId
   */
  async deleteFile(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params;
      
      await fileService.deleteFile(fileId);
      
      res.json({
        success: true,
        message: 'File marked for deletion',
      });
      
    } catch (error) {
      console.error('❌ Error deleting file:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete file',
      });
    }
  }

  
  /**
   * @desc    Get file statistics
   * @route   GET /api/v1/files/stats
   */
  async getStats(req: Request, res: Response): Promise<void> {
    try {
      const companyId = req.query.companyId as string | undefined;
      
      const stats = await fileService.getFileStats(companyId);
      
      res.json({
        success: true,
        stats: {
          ...stats,
          totalSizeGB: (stats.totalSizeBytes / 1024 / 1024 / 1024).toFixed(2),
        },
      });
      
    } catch (error) {
      console.error('❌ Error getting stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get stats',
      });
    }
  }
}

export const fileController = new FileController();