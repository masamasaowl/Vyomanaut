import { Request, Response } from 'express';
import { websocketDeviceManager } from '../../websocket/device.manager';

/**
 * WebSocket Status Controller
 * 
 * Provides REST endpoints to inspect WebSocket connections
 * Useful for debugging and monitoring the server
 * 
 * Total routes = 2
 */

class WebSocketController {
  
  /**
   * @desc    Get all connected devices
   * @route   GET /api/v1/websocket/connections
   * 
   * Returns list of all active WebSocket connections
   */
  async getConnections(req: Request, res: Response): Promise<void> {
    try {
      const stats = websocketDeviceManager.getConnectionStats();
      
      res.json({
        success: true,
        stats: {
          totalConnections: stats.totalConnections,
          uniqueDevices: stats.uniqueDevices,
        },
        connections: stats.devices.map(d => ({
          socketId: d.socketId,
          deviceId: d.deviceId,
          userId: d.userId,
          connectedAt: d.connectedAt,
          lastSeenAt: d.lastSeenAt,
          connectionDuration: Date.now() - d.connectedAt.getTime(),
        }))
      });
      
    } catch (error) {
      console.error('❌ Error getting connections:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get connections'
      });
    }
  }
  
  /**
   * @desc    Check if specific device is connected
   * @route   GET /api/v1/websocket/device/:deviceId/status
   * 
   * Returns connection status for a specific device
   */
  async getDeviceConnectionStatus(req: Request, res: Response): Promise<void> {
    try {
      const { deviceId } = req.params;
      
      const isConnected = websocketDeviceManager.isDeviceConnected(deviceId);
      const socketId = websocketDeviceManager.getSocketFromDeviceId(deviceId);
      
      res.json({
        success: true,
        deviceId,
        isConnected,
        socketId: socketId || null,
      });
      
    } catch (error) {
      console.error('❌ Error checking device status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check device status'
      });
    }
  }
}

export const websocketController = new WebSocketController();