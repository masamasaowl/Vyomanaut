/**
 * Deletion job types for the cleanup queue
 */

// For company deletions
export interface DeleteFileJobData {
  fileId: string;
  companyId: string;
  reason: 'USER_REQUESTED' | 'EXPIRED' | 'POLICY_VIOLATION';
  timestamp: number;
}

// For excess replica background deletion
export interface DeleteExcessReplicasJobData {
  chunkId: string;
  currentReplicas: number;
  targetReplicas: number;
  safetyMargin: number;
  excessCount: number;
  timestamp: number;
}

// Deletion from DB
export interface DeleteChunkFromDeviceJobData {
  chunkId: string;
  deviceId: string;
  localPath: string;
  reason: 'FILE_DELETED' | 'EXCESS_REPLICA' | 'UNHEALTHY';
}
