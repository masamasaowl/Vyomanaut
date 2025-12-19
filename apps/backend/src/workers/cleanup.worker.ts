import { cleanupQueue } from "../config/queue";
import { temporaryStorageService } from "../modules/chunks/storage.service";
import { healthScheduler } from "./healthScheduler";


/**
 * Cleanup Worker
 * 
 * What it does:
 * - Fetches how old a job is 
 * - Send it to cleanUpOldChunks() function defined in temporary storage service
 * 
 * He tells how to perform 1 task in the cleanup queue
 */

cleanupQueue.process('cleanup-temp-storage', async (job) => {

  // Extract it's age
  const { olderThanHours } = job.data;
  
  console.log(`🧹 Cleaning up temp storage (older than ${olderThanHours}h)...`);
  
  // Perform the actual cleaning
  const deletedCount = await temporaryStorageService.cleanupOldChunks(olderThanHours);
  
  console.log(`✅ Cleanup complete: ${deletedCount} chunks deleted`);
  
  // How much did we clean
  return { deletedCount };
});


// If running this file directly from server.ts (not imported)
if (require.main === module) {
  healthScheduler.start();
  
  // Handle shutdown
  process.on('SIGTERM', () => {
    healthScheduler.stop();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    healthScheduler.stop();
    process.exit(0);
  });
}