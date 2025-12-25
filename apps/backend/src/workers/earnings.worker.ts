import { metricsQueue } from '../config/queue';
import { earningsService } from '../modules/payments/earnings.service';

/**
 * Earnings Worker
 * 
 * Background job that updates earnings periodically
 * 
 * Runs: Every hour (or daily, depending on load)
 */

metricsQueue.process('update-earnings', async (job) => {
  console.log('💰 Starting earnings update job...');
  
  // Call earnings.service.ts for 
  // updateAllDeviceEarnings()
  try {
    const results = await earningsService.updateAllDeviceEarnings();
    
    console.log(`✅ Earnings updated: ${results.devicesUpdated} devices, $${results.totalEarningsDistributed.toFixed(2)} distributed`);
    
    return results;
    
  } catch (error) {
    console.error('❌ Earnings update failed:', error);
    throw error; // Retry
  }
});

console.log('💰 Earnings worker ready - updating every hour');
