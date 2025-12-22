import { FileStatus } from "@prisma/client";
import { prisma } from "../config/database";
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


// Clean the temporary storage of the deleted files
cleanupQueue.process('cleanup-deleted-files', async (job) => {

  // Extract the fileID from the deleteFile() function in file.service.ts
  const { fileId } = job.data;
  
  // Extract the file
  const file = await prisma.file.findUnique({
     where: { id: fileId }
  });

  // 2 Important checks to ensure file is not yet deleted
  if (!file) {
    console.log(`⚠️ File ${fileId} already removed, skipping`);
    return;
  }

  // We mark as deleted first so this needs to be done, before we begin the actual cleanup
  if (file.status !== FileStatus.DELETED) {
    console.log(`ℹ️ File ${fileId} is not marked DELETED, skipping`);
    return;
  }

  // These are the chunks that need to be deleted
  const chunks = await prisma.chunk.findMany({
    where: { fileId },
    include: {
      locations: {
        include: {
          device: true,
        },
      },
    },
  });


  
})



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