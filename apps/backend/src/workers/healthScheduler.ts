import { cleanupQueue } from '../config/queue';
import { chunkDeletionService } from '../modules/chunks/deletion.service';
import { healthMonitoringService } from '../modules/replication/health.service';


/**
 * Health Scheduler
 * 
 * Schedules periodic health checks and maintenance jobs
 * 
 * Think of this as the "scheduling system" - like a hospital's
 * appointment scheduler, but for system health checks!
 * 
 * Jobs scheduled:
 * - Every 1 hour: Full system health scan ( provide extra chunks )
 * - Every 1 hour: Cleanup temporary storage
 * - Every 24 hours: Deep health check + metrics
 * - Every 12 hours: Delete excess chunks
 */

class HealthScheduler {
  
  private intervals: NodeJS.Timeout[] = [];
  
  /**
   * Start all scheduled jobs
   * or three independent loops
   */
  start(): void {

    console.log('📅 Starting Health Scheduler...');
    
    // =============================================
    // Schedule 1: Full system scan every  1 hour
    // =============================================

    // setInterval( {scanChunks}, run again in 1 hour)
    const scanInterval = setInterval(async () => {
      try {

        console.log('🏥 Running scheduled health scan...');
        await healthMonitoringService.scanAllChunks();

      } catch (error) {
        console.error(' Scheduled scan failed:', error);
      }
    }, 60 * 60 * 1000); //  1 hour
    
    // Add this in the intervals array
    this.intervals.push(scanInterval);
    

    // =============================================
    // Schedule 2: Cleanup temporary storage every 1 hour
    // =============================================

    // Condition: This runs every hour 
    //            but cleans only 24 hour old storages
    // Note: The cleanup worker is yet to be added
    const cleanupInterval = setInterval(async () => {
      try {

        console.log('🧹 Running scheduled cleanup...');

        // Add task to the queue
        await cleanupQueue.add('cleanup-temp-storage',
          
          // Only clean if 24 hours old
          {
            olderThanHours: 24,
          });
      } catch (error) {
        console.error('❌ Scheduled cleanup failed:', error);
      }
    }, 60 * 60 * 1000); // 1 hour
    
    this.intervals.push(cleanupInterval);
    

    // =============================================
    // // Schedule 3: Log Health summary every 24 hours
    // =============================================

    const summaryInterval = setInterval(async () => {
      try {

        // Get the summary 
        const summary = await healthMonitoringService.getSystemHealthSummary();

        // Log the summary
        console.log(`📊 System Health: ${summary.healthPercentage}% (${summary.healthyChunks}/${summary.totalChunks} chunks healthy)`);
        
        // We log warnings if degraded unhealed chunks are discovered
        if (summary.degradedChunks > 0) {
          console.warn(`⚠️ ${summary.degradedChunks} chunks degraded`);
        }
        
        // Chunk getting lost is a serious error 
        if (summary.lostChunks > 0) {
          console.error(`🚨 ${summary.lostChunks} chunks LOST`);
        }

      } catch (error) {
        console.error('❌ Health summary failed:', error);
      }
    }, 24 * 60 * 60 * 1000); // 1 day
    
    this.intervals.push(summaryInterval);



    // =============================================
    // Schedule 4: Cleanup excess replicas every 6 hours
    // =============================================
    
    const excessReplicaInterval = setInterval(async () => {
      try {
        console.log('✂️ Running excess replica cleanup...');
        
        // The scan lives in deletion.service.ts
        const results = await chunkDeletionService.scanAndCleanupExcessReplicas();
        
        console.log(`✅ Excess replica scan: ${results.excessFound} found, ${results.deletionsQueued} queued`);
        
      } catch (error) {
        console.error('❌ Excess replica cleanup failed:', error);
      }
    }, 12 * 60 * 60 * 1000); // 12 hours

    this.intervals.push(excessReplicaInterval);
        

    // Run initial scan immediately as server starts
    setTimeout(async () => {
      try {
        await healthMonitoringService.scanAllChunks();
      } catch (error) {
        console.error('❌ Initial scan failed:', error);
      }
    }, 5000); // 5 seconds after startup
    
    console.log('✅ Health Scheduler started');
  }
  


  /**
   * Stop all scheduled jobs
   */
  stop(): void {
    console.log('🛑 Stopping Health Scheduler...');
    
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    
    console.log('✅ Health Scheduler stopped');
  }
}

export const healthScheduler = new HealthScheduler();