import { Job } from 'bull';
import { cleanupQueue } from '../config/queue';
import { chunkDeletionService } from '../modules/chunks/deletion.service';
import { temporaryStorageService } from '../modules/chunks/storage.service';
import { DeleteFileJobData, DeleteExcessReplicasJobData } from '../types/deletion.types';

/**
 * CLEANUP WORKER - * Major change *
 * 
 * Now handles 3 job types:
 * 1. cleanup-temp-storage (this was existing)
 * 2. delete-file 
 * 3. delete-excess-replicas 
 */

// JOB 1: Cleanup temporary storage
cleanupQueue.process('cleanup-temp-storage', async (job) => {

  // Extract it's age
  const { olderThanHours } = job.data;
  
  console.log(`🧹 Cleaning up temp storage (older than ${olderThanHours}h)...`);
  
  // Send it to cleanUpOldChunks() function defined in temporary storage service
  const deletedCount = await temporaryStorageService.cleanupOldChunks(olderThanHours);
  
  console.log(`✅ Cleanup complete: ${deletedCount} chunks deleted`);
  
  return { deletedCount };
});


// JOB 2: Delete entire file 
cleanupQueue.process('delete-file', async (job: Job<DeleteFileJobData>) => {

  // Extract them 
  const { fileId, companyId, reason } = job.data;
  
  console.log(`🗑️ Processing file deletion: ${fileId} (${reason})`);
  
  // Delete entire file as defined in deletion.service.ts
  try {
    await chunkDeletionService.executeFileDeletion(fileId);
    
    console.log(`✅ File ${fileId} deleted successfully`);
    
    return { 
      success: true, 
      fileId, 
      deletedAt: Date.now() 
    };
    
  } catch (error) {
    console.error(`❌ Failed to delete file ${fileId}:`, error);
    throw error; // Retry
  }
});

// JOB 3: Delete excess replicas 
cleanupQueue.process('delete-excess-replicas', async (job: Job<DeleteExcessReplicasJobData>) => {

  // Extract from job details
  const { chunkId, excessCount } = job.data;
  
  console.log(`✂️ Trimming ${excessCount} excess replicas for chunk ${chunkId}`);
  

  // Delete one excess chunk as defined in deletion.service.ts
  try {
    await chunkDeletionService.executeExcessReplicaDeletion(chunkId);
    
    console.log(`✅ Excess replicas trimmed for chunk ${chunkId}`);
    
    return { 
      success: true, 
      chunkId, 
      deletedCount: excessCount 
    };
    
  } catch (error) {
    console.error(`❌ Failed to trim replicas for chunk ${chunkId}:`, error);
    throw error; // Retry
  }
});

