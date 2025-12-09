import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env';
import { prisma, disconnectDatabase, checkDatabaseHealth } from './config/database';
import { redisManager } from './config/redis';
import { initializeCrypto } from './utils/crypto';

/**
 * Vyomanaut Backend Server
 * 
 * Architecture:
 * - Express: REST API for companies (upload/download files)
 * - Socket.io: Real-time communication with user devices
 * - PostgreSQL: Persistent storage (chunk locations, device info)
 * - Redis: Fast cache + pub/sub for scaling
 */

class VyomonautServer {

  // declare private variables 
  private app: express.Application;
  private httpServer: ReturnType<typeof createServer>;
  private io: SocketIOServer;

  // The ON switch
  constructor() {

    // const app = express();
    this.app = express();
    // const httpServer = http.createServer(app);
    this.httpServer = createServer(this.app);
    
    // Initialize Socket.io on the same PORT as our http server
    this.io = new SocketIOServer(this.httpServer, {
      // setup cors for wsServer
      cors: {

        // Dev -> all
        // Prod -> look env
        origin: config.isDevelopment ? '*' : process.env.ALLOWED_ORIGINS?.split(','),
        // allowed methods
        methods: ['GET', 'POST'],
      },

      // send pings to check up on client health
      pingInterval: config.websocket.pingInterval,
      pingTimeout: config.websocket.pingTimeout,
    });

    // The flow to execute for the constructor
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupGracefulShutdown();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Security headers
    this.app.use(helmet());

    // CORS
    this.app.use(cors({
      origin: config.isDevelopment ? '*' : process.env.ALLOWED_ORIGINS?.split(','),
      credentials: true,
    }));

    // Body parsing
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Request logging in development
    if (config.isDevelopment) {
      this.app.use((req, res, next) => {
        console.log(`${req.method} ${req.path}`);
        next();
      });
    }
  }

  /**
   * Setup REST API routes
   */
  private setupRoutes(): void {
    // Import routes
    const deviceRoutes = require('./api/routes/devices.routes').default;

    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      const dbHealthy = await checkDatabaseHealth();
      const redisHealthy = await redisManager.checkHealth();

      const health = {
        status: dbHealthy && redisHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        services: {
          database: dbHealthy ? 'up' : 'down',
          redis: redisHealthy ? 'up' : 'down',
        },
      };

      res.status(health.status === 'healthy' ? 200 : 503).json(health);
    });

    // Home Route
    this.app.get('/api/v1', (req, res) => {
      res.json({
        message: 'Vyomanaut API v1',
        version: '0.1.0',
        endpoints: {
          health: '/health',
          devices: '/api/v1/devices',
          files: '/api/v1/files',
        },
      });
    });

    // Use device routes
    this.app.use('/api/v1/devices', deviceRoutes);

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
      });
    });

    // Error handler
    this.app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('❌ Error:', err);
      res.status(500).json({
        error: 'Internal Server Error',
        message: config.isDevelopment ? err.message : 'Something went wrong',
      });
    });
  }

  /**
   * Setup WebSocket handlers
   * This is where devices connect and listen for chunk assignments
   */
  private setupWebSocket(): void {
    // Import device events handler
    const { setupDeviceEvents } = require('./websocket/device.events');

    this.io.on('connection', (socket) => {
      console.log(`🔌 New connection: ${socket.id}`);

      // Setup all device-related event handlers for this socket
      setupDeviceEvents(socket);
    });

    console.log('🔌 WebSocket server initialized');
  }

  /**
   * Graceful shutdown handler
   * Ensures connections are closed cleanly
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(`\n📡 ${signal} received, shutting down gracefully...`);

      // Stop accepting new http requests
      this.httpServer.close(() => {
        console.log('🔒 HTTP server closed');
      });

      // Close WebSocket connections
      this.io.close(() => {
        console.log('🔒 WebSocket server closed');
      });

      // Close database & Redis connections
      await disconnectDatabase();
      await redisManager.disconnect();

      console.log('👋 Shutdown complete');
      process.exit(0);
    };

    // Let NODE know when to run the shutdown plan
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }


  /**
   * Start the server
   */
  async start(): Promise<void> {
    try {
      
      // Initialize cryptography
      initializeCrypto(config.encryption.masterKEK);
      console.log('✅ Cryptography initialized');

      // Test database connection
      await prisma.$connect();
      console.log('✅ Database connected');

      // Test Redis connection
      await redisManager.getClient();
      console.log('✅ Redis connected');

      // Start HTTP server
      this.httpServer.listen(config.server.port, config.server.host, () => {
        console.log(`
          🚀 Vyomanaut Backend Server Running!

          Environment: ${config.isDevelopment ? 'Development' : 'Production'}
          HTTP Server: http://${config.server.host}:${config.server.port}
          WebSocket Server: ws://${config.server.host}:${config.server.port}
          Health Check: http://${config.server.host}:${config.server.port}/health

          Ready to coordinate distributed storage! 📦
        `);
      });
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Start the server
const server = new VyomonautServer();
server.start();