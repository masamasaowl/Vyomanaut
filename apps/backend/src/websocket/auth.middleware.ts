import { Server as SocketIOServer, Socket } from 'socket.io';
import { authService } from '../modules/auth/auth.service';


/**
 * WebSocket Authentication Middleware
 * 
 * Extract token before the connection of device and server
 * 
 * FLOW:
 * 1. Extract the JWT from
 *    socket.handshake.auth.token
 * 2. Verifies it via authService.verifyToken()
 * 3. Attaches the decoded token to socket.data
 * 4. On failure → calls next(Error)
 * 
 * This runs once per connection attempt
 * before any event handlers.
 *
 * If the token is missing or invalid the socket is
 * disconnected
 * 
 * @param io  The Socket.IO server instance (from server.ts)
 */

export function setupSocketAuth(io: SocketIOServer): void {
  io.use(async (socket: Socket, next) => {
    try {
      // 1. Extract token from handshake
      // Client sends ->
      // io(url, { auth: { token: '_JWT_' } })
      // We receive it here in socket.handshake.auth
      const token = socket.handshake?.auth?.token as string | undefined;
      
      if (!token) {
        console.warn(`🚫 Socket ${socket.id} — no auth token in handshake`);
        return next(new Error('Authentication token required'));
      }
      
      // 2. Verify JWT
      const decoded = await authService.verifyToken(token);
      
      // 3. Attach user info to socket.data
      // This makes user info available in ALL event handlers
      socket.data.userId = decoded.id;
      socket.data.email = decoded.email;
      socket.data.role = decoded.role;
      
      console.log(`✅ Socket ${socket.id} authenticated — user ${decoded.email} (${decoded.role})`);
      
      // 4. Allow connection to proceed
      next();
      
    } catch (error) {
      console.warn(`🚫 Socket auth failed:`, error);
      
      // Reject connection with clear error message
      if (error instanceof Error) {
        if (error.message.includes('expired')) {
          return next(new Error('Token expired'));
        } else if (error.message.includes('invalid')) {
          return next(new Error('Invalid token'));
        }
      }
      
      return next(new Error('Authentication failed'));
    }
  });
  
  console.log('✅ WebSocket authentication middleware enabled');
}

/**
 * Verify user ownership in event handlers
 * 
 * Usage in device.events.ts:
 * 
 * socket.on('device:connect', async (payload) => {
 *   // Verify this user owns this device
 *   if (!verifyDeviceOwnership(socket, deviceId)) {
 *     socket.emit('error', { message: 'Not your device' });
 */
export function verifyDeviceOwnership(
  socket: Socket,
  deviceId: string,
  ownerId: string
): boolean {
  const userId = socket.data.userId;
  
  if (!userId) {
    console.error(`❌ No userId in socket.data for ${socket.id}`);
    return false;
  }
  
  if (userId !== ownerId) {
    console.warn(`🚫 User ${userId} tried to access device ${deviceId} owned by ${ownerId}`);
    return false;
  }
  
  return true;
}

/**
 * Get authenticated user from socket
 */
export function getAuthenticatedUser(socket: Socket): {
  userId: string;
  email: string;
  role: string;
} | null {
  if (!socket.data.userId) {
    console.error(`❌ Socket ${socket.id} is not authenticated`);
    return null;
  }
  
  return {
    userId: socket.data.userId,
    email: socket.data.email,
    role: socket.data.role
  };
}

/**
 * Connection Metrics
 * Track authentication performance
 */
class ConnectionMetrics {
  private metrics = {
    totalConnections: 0,
    successfulAuths: 0,
    failedAuths: 0,
    avgAuthTime: 0,
    authTimes: [] as number[]
  };
  
  recordAuth(success: boolean, timeMs: number) {
    this.metrics.totalConnections++;
    
    if (success) {
      this.metrics.successfulAuths++;
      this.metrics.authTimes.push(timeMs);
      
      // Keep last 100 samples
      if (this.metrics.authTimes.length > 100) {
        this.metrics.authTimes.shift();
      }
      
      // Calculate average
      this.metrics.avgAuthTime = 
        this.metrics.authTimes.reduce((a, b) => a + b, 0) / 
        this.metrics.authTimes.length;
    } else {
      this.metrics.failedAuths++;
    }
  }
  
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalConnections > 0
        ? ((this.metrics.successfulAuths / this.metrics.totalConnections) * 100).toFixed(2) + '%'
        : '0%'
    };
  }
  
  reset() {
    this.metrics = {
      totalConnections: 0,
      successfulAuths: 0,
      failedAuths: 0,
      avgAuthTime: 0,
      authTimes: []
    };
  }
}

export const connectionMetrics = new ConnectionMetrics();

/**
 * Option 2 for websocket authentication
 * Enhanced setup with metrics
 */
export function setupWebSocketAuthWithMetrics(io: SocketIOServer): void {
  io.use(async (socket: Socket, next) => {
    const startTime = Date.now();
    
    try {
      const token = socket.handshake?.auth?.token as string | undefined;
      
      if (!token) {
        connectionMetrics.recordAuth(false, Date.now() - startTime);
        return next(new Error('Authentication token required'));
      }
      
      const decoded = await authService.verifyToken(token);
      
      socket.data.userId = decoded.id;
      socket.data.email = decoded.email;
      socket.data.role = decoded.role;
      
      const authTime = Date.now() - startTime;
      connectionMetrics.recordAuth(true, authTime);
      
      console.log(`✅ Socket ${socket.id} auth in ${authTime}ms — ${decoded.email}`);
      
      next();
      
    } catch (error) {
      connectionMetrics.recordAuth(false, Date.now() - startTime);
      
      console.warn(`🚫 Socket auth failed:`, error);
      
      if (error instanceof Error) {
        if (error.message.includes('expired')) {
          return next(new Error('Token expired'));
        } else if (error.message.includes('invalid')) {
          return next(new Error('Invalid token'));
        }
      }
      
      return next(new Error('Authentication failed'));
    }
  });
  
  // Log metrics every 5 minutes
  setInterval(() => {
    const metrics = connectionMetrics.getMetrics();
    console.log('📊 WebSocket Auth Metrics:', {
      total: metrics.totalConnections,
      success: metrics.successfulAuths,
      failed: metrics.failedAuths,
      successRate: metrics.successRate,
      avgAuthTime: `${metrics.avgAuthTime.toFixed(2)}ms`
    });
  }, 5 * 60 * 1000);
  
  console.log('✅ WebSocket auth middleware with metrics enabled');
}