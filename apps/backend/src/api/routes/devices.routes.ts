import { Router} from 'express';
import { deviceController } from '../../modules/devices/device.controller';

/**
 * Device Routes
 * 
 * Maps URLs to controller methods
 * Think of this as a "directory" or "map" of available endpoints
 */

const router: Router  = Router();

/**
 * GET /api/v1/devices
 * List all devices with optional filters
 */
router.get('/', (req, res) => deviceController.listDevices(req, res));

/**
 * GET /api/v1/devices/stats
 * Get overall device statistics
 * 
 * NOTE: This comes before /:deviceId route
 * Otherwise Express thinks "stats" is a deviceId
 */
router.get('/stats', (req, res) => deviceController.getDeviceStats(req, res));

/**
 * GET /api/v1/devices/healthy
 * Get list of healthy devices for chunk assignment
 */
router.get('/healthy', (req, res) => deviceController.getHealthyDevices(req, res));

/**
 * GET /api/v1/devices/:deviceId
 * Get specific device details
 */
router.get('/:deviceId', (req, res) => deviceController.getDevice(req, res));

/**
 * GET /api/v1/devices/:deviceId/health
 * Get device health metrics
 */
router.get('/:deviceId/health', (req, res) => deviceController.getDeviceHealth(req, res));

/**
 * POST /api/v1/devices/:deviceId/suspend
 * Suspend a device permanently
 */
router.post('/:deviceId/suspend', (req, res) => deviceController.suspendDevice(req, res));


export default router;