/**
 * Type definitions matching backend API responses
 * These would help us maintain consistency in the types between the two
 */

export interface User {
  id: string;
  email: string;
  role: 'USER' | 'COMPANY' | 'ADMIN';
  name?: string;
}

export interface AuthResponse {
  success: boolean;
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface FileMetadata {
  id: string;
  originalName: string;
  sizeBytes: number;
  sizeMB: string;
  mimeType: string;
  chunkCount: number;
  status: 'UPLOADING' | 'ACTIVE' | 'DEGRADED' | 'DELETED';
  uploadedAt: string;
}

export interface FileUploadResponse {
  success: boolean;
  file: FileMetadata;
  message: string;
}

export interface FileListResponse {
  success: boolean;
  count: number;
  files: FileMetadata[];
}

export interface FileStats {
  totalFiles: number;
  totalSizeBytes: number;
  totalSizeGB: string;
  activeFiles: number;
  totalChunks: number;
}

export interface ApiError {
  success: false;
  error: string;
}