import { Router } from 'express';
import { paymentController } from '../../modules/payments/payment.controller';

const router: Router = Router();
/**
 * Payment Routes
 * Count : 3 (1 not functional)
 */


/**
 * GET /api/v1/payments/device/:deviceId
 * Get earnings for specific device
 */
router.get('/device/:deviceId', (req, res) => 
  paymentController.getDeviceEarnings(req, res)
);


// Active when prices get confirmed
/**
 * GET /api/v1/payments/calculate
 * Calculate potential earnings
 */
// router.get('/calculate', (req, res) => 
//   paymentController.calculatePotentialEarnings(req, res)
// );


/**
 * GET /api/v1/payments/stats
 * Get system-wide payment statistics
 */
router.get('/stats', (req, res) => 
  paymentController.getSystemStats(req, res)
);

export default router;
