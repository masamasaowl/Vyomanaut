import { Request, Response } from 'express';
import { earningsService } from './earnings.service';

/**
 * Payment Controller
 * 
 * REST API endpoints for earnings
 */
class PaymentController {
  
  /**
   * @desc    Get earnings for a device
   * @route   GET /api/v1/payments/device/:deviceId
   */
  async getDeviceEarnings(req: Request, res: Response): Promise<void> {
    try {
      const { deviceId } = req.params;
      
      const earnings = await earningsService.calculateDeviceEarnings(deviceId);
      
      res.json({
        success: true,
        earnings,
      });
      
    } catch (error) {
      console.error('❌ Error getting device earnings:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get device earnings',
      });
    }
  }
  

  // We run this later when prices get confirmed
  /**
   * @desc    Get potential earnings calculator
   * @route   GET /api/v1/payments/calculate?storageGB=10&days=30
   */
  // async calculatePotentialEarnings(req: Request, res: Response): Promise<void> {
  //   try {
  //     const storageGB = parseFloat(req.query.storageGB as string) || 10;
  //     const days = parseInt(req.query.days as string) || 30;
      
  //     const potential = earningsService.calculatePotentialEarnings(storageGB, days);
  //     const comparison = earningsService.compareWithAWS(storageGB, days);
      
  //     res.json({
  //       success: true,
  //       potential,
  //       comparison,
  //     });
      
  //   } catch (error) {
  //     console.error('❌ Error calculating potential earnings:', error);
  //     res.status(500).json({
  //       success: false,
  //       error: 'Failed to calculate earnings',
  //     });
  //   }
  // }
  
  /**
   * @desc    Get system-wide payment statistics
   * @route   GET /api/v1/payments/stats
   */
  async getSystemStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await earningsService.getSystemPaymentStats();
      
      res.json({
        success: true,
        stats,
      });
      
    } catch (error) {
      console.error('❌ Error getting payment stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get payment stats',
      });
    }
  }
}

export const paymentController = new PaymentController();
