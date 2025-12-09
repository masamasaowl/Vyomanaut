import { Request, Response } from 'express';
import { deviceService } from './device.service';
import { DeviceQueryFilters } from '../../types/device.types';
import { DeviceStatus } from '@prisma/client';

/**
 * Device Controller
 * 
 * Handles REST API requests for devices
 * Think of this as the "waiter" - takes requests, asks the chef (service), brings back response
 * 
 * These endpoints are mainly to:
 * 1. List all devices 
 * 2. Get a particular device
 * 3. Get the health of a particular device
 * 4. Get all healthy ready to take chunks devices
 * 5. Suspend a device permanently
 * 6. Show stats of combined strength of devices on platform
 */

class DeviceController {
  
  /**
   * @desc    List all devices based on filters
   * @route   GET /api/v1/devices
   * 
   * Query params:
   * - status: ONLINE | OFFLINE | SUSPENDED
   * - minReliability: number (0-100)
   * - minStorage: number (bytes)
   * 
   * Example: GET /api/v1/devices?status=ONLINE&minReliability=80
   */
  async listDevices(req: Request, res: Response): Promise<void> {
    try {

      // Define the filters a little parsing is needed
      const filters: DeviceQueryFilters = {
        status: req.query.status as DeviceStatus | undefined,

        // Parse as string (max storage)
        minReliabilityScore: req.query.minReliability 
          ? parseFloat(req.query.minReliability as string) 
          : undefined,
        minAvailableStorage: req.query.minStorage 
          ? parseInt(req.query.minStorage as string) 
          : undefined,
      };

      // Here are your devices sir, depending on your chosen filters
      const devices = await deviceService.listDevices(filters);

      // Send response
      res.json({
        success: true,
        count: devices.length,
        devices: devices.map(d => ({
          ...d,
          availableStorageGB: (d.availableStorageBytes / 1024 / 1024 / 1024).toFixed(2),
        })),
      });
      
    } catch (error) {
      console.error('❌ Error listing devices:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list devices',
      });
    }
  }

  /**
   * @desc    Get a particular device
   * @route   GET /api/v1/devices/:deviceId
   * 
   * Example: GET /api/v1/devices/abc123
   */
  async getDevice(req: Request, res: Response): Promise<void> {
    try {
      // get the id
      const { deviceId } = req.params;

      // call the chef
      const device = await deviceService.getDevice(deviceId);

      if (!device) {
        res.status(404).json({
          success: false,
          error: 'Device not found',
        });
        return;
      }

      res.json({
        success: true,
        device: {
          ...device,
          totalStorageBytes: Number(device.totalStorageBytes),
          availableStorageBytes: Number(device.availableStorageBytes),
          totalStorageGB: (Number(device.totalStorageBytes) / 1024 / 1024 / 1024).toFixed(2),
          availableStorageGB: (Number(device.availableStorageBytes) / 1024 / 1024 / 1024).toFixed(2),
        },
      });
      
    } catch (error) {
      console.error('❌ Error getting device:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get device',
      });
    }
  }

  /**
   * @desc    Get the health of a particular device
   * @route   GET /api/v1/devices/:deviceId/health
   * 
   * Returns:
   * - Is device online?
   * - Reliability score
   * - Uptime percentage
   * - Last seen time
   */
  async getDeviceHealth(req: Request, res: Response): Promise<void> {
    try {
      const { deviceId } = req.params;

      // Call the chef, it's that simple
      const health = await deviceService.getDeviceHealth(deviceId);

      res.json({
        success: true,
        health: {
          ...health,
          consecutiveDowntimeHours: (health.consecutiveDowntimeMs / 1000 / 60 / 60).toFixed(2),
        },
      });
      
    } catch (error) {
      console.error('❌ Error getting device health:', error);
      
      if ((error as Error).message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: 'Device not found',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to get device health',
        });
      }
    }
  }

  /**
   * @desc    Get all healthy ready to take chunks devices
   * @route   GET /api/v1/devices/healthy
   *
   * Query params:
   * - minStorage: Minimum available storage (bytes)
   * - minReliability: Minimum reliability score (default: 70)
   * - limit: Max number of devices to return (default: 10)
   * 
   * This is used internally when assigning chunks!
   */
  async getHealthyDevices(req: Request, res: Response): Promise<void> {

    try {

      // Tell me
      // What do you consider as Healthy?
      const minStorage = parseInt(req.query.minStorage as string) || 5 * 1024 * 1024; // Default 5MB
      const minReliability = parseFloat(req.query.minReliability as string) || 70;
      const limit = parseInt(req.query.limit as string) || 10;

      // The chef knows this 
      const devices = await deviceService.findHealthyDevices(
        minStorage,
        minReliability,
        limit
      );

      res.json({
        success: true,
        count: devices.length,
        devices: devices.map(d => ({
          ...d,
          availableStorageGB: (d.availableStorageBytes / 1024 / 1024 / 1024).toFixed(2),
        })),
      });
      
    } catch (error) {
      console.error('❌ Error getting healthy devices:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get healthy devices',
      });
    }
  }

  /**
   * @desc    Show stats of combined strength of devices on platform
   * @route   GET /api/v1/devices/stats
   * 
   * Returns:
   * - Total devices
   * - Online devices
   * - Offline devices
   * - Total storage available
   * - Average reliability score
   */
  async getDeviceStats(req: Request, res: Response): Promise<void> {
    try {

      // Get all devices
      const allDevices = await deviceService.listDevices();

      // Who are up and down
      const onlineDevices = allDevices.filter(d => d.status === DeviceStatus.ONLINE);
      const offlineDevices = allDevices.filter(d => d.status === DeviceStatus.OFFLINE);

      // Calculate total available storage
      const totalStorage = allDevices.reduce(
        (sum, d) => sum + d.availableStorageBytes, 
        0
      );

      // Calculate average reliability
      const avgReliability = allDevices.length > 0
        ? allDevices.reduce((sum, d) => sum + d.reliabilityScore, 0) / allDevices.length
        : 0;

      res.json({
        success: true,
        stats: {
          totalDevices: allDevices.length,
          onlineDevices: onlineDevices.length,
          offlineDevices: offlineDevices.length,
          totalStorageGB: (totalStorage / 1024 / 1024 / 1024).toFixed(2),
          averageReliability: avgReliability.toFixed(2),
        },
      });
      
    } catch (error) {
      console.error('❌ Error getting device stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get device stats',
      });
    }
  }

  
  /**
   * @desc    Suspend a device permanently
   * @route   POST /api/v1/devices/:deviceId/suspend
   * 
   * We pass
   * Body: { reason?: string }
   */
  async suspendDevice(req: Request, res: Response): Promise<void> {
    try {

      // extract id and reason
      const { deviceId } = req.params;
      const { reason } = req.body;

      await deviceService.suspendDevice(deviceId, reason);

      res.json({
        success: true,
        message: 'Device suspended successfully',
      });
      
    } catch (error) {
      console.error('❌ Error suspending device:', error);
      
      if ((error as Error).message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: 'Device not found',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to suspend device',
        });
      }
    }
  }
}

export const deviceController = new DeviceController();