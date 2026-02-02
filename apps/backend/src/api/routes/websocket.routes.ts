import { Router } from 'express';
import { websocketController } from '../controllers/websocket.controller';

/**
 * WebSocket Status Routes
 * Count: 2
 * 
 * These endpoints help monitor WebSocket connections
 */

const router: Router = Router();

/**
 * GET /api/v1/websocket/connections
 * Get all active WebSocket connections
 */
router.get('/connections', (req, res) => 
  websocketController.getConnections(req, res)
);

/**
 * GET /api/v1/websocket/device/:deviceId/status
 * Check if specific device is connected
 */
router.get('/device/:deviceId/status', (req, res) => 
  websocketController.getDeviceConnectionStatus(req, res)
);

export default router;