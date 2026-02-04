import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env';
import { prisma, disconnectDatabase, checkDatabaseHealth } from './config/database';
import { redisManager } from './config/redis';
import { initializeCrypto } from './utils/crypto';
import { chunkDistributionService } from './modules/chunks/distribution.service';
import { chunkRetrievalService } from './modules/chunks/retrieval.service';
import { startHealingWorker } from './workers/healing.worker';
import { healthScheduler } from './workers/healthScheduler';
import { closeQueues } from './config/queue';
import { chunkDeletionService } from './modules/chunks/deletion.service';
import { logger } from './utils/logger';
import { deviceService } from './modules/devices/device.service';

// Import routes
const deviceRoutes = require('./api/routes/devices.routes').default;
const fileRoutes = require('./api/routes/file.routes').default;
const paymentRoutes = require('./api/routes/payment.routes').default;
const authRoutes = require('./api/routes/auth.routes').default;
const websocketRoutes = require('./api/routes/websocket.routes').default;


/**
 * Vyomanaut Backend Server
 */
class VyomonautServer {

  // declare private variables 
  private app: express.Application;
  private httpServer: ReturnType<typeof createServer>;
  private io: SocketIOServer;
  // Heartbeat flush timer
  private heartbeatFlushInterval: NodeJS.Timeout | null = null;


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


  // =================================================
  // MIDDLEWARES
  // =================================================
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


  // =================================================
  // ROUTES
  // =================================================
  private setupRoutes(): void {

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
      // Our response
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
    // Use file routes
    this.app.use('/api/v1/files', fileRoutes);
    // Use payment routes
    this.app.use('/api/v1/payments', paymentRoutes);
    // Use authenticate routes 
    this.app.use('/api/v1/auth', authRoutes);
    // Use Websocket routes
    this.app.use('/api/v1/websocket', websocketRoutes);


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

  // =================================================
  // WEBSOCKET HANDLERS
  // =================================================
  private setupWebSocket(): void {

    // Websocket imports 
    const { setupDeviceEvents } = require('./websocket/device.events');
    const { websocketDeviceManager } = require('./websocket/device.manager');

    // Every incoming socket must be authenticated here by the JWT middleware
    const { setupSocketAuth } = require('./websocket/device.manager');
    setupSocketAuth(this.io);
    
    // Hand over the socket walkie-talkie to components to socket events
    
    // This is the Distribution call for all our Explorers
    chunkDistributionService.setSocketIO(this.io);
    // This is the Retrieval call for all our Explorers
    chunkRetrievalService.setSocketIO(this.io);
    // This is the termination call for all the devices          
    chunkDeletionService.setSocketIO(this.io);


    // The Handshake happens
    this.io.on('connection', (socket) => {
      console.log(`🔌 New connection: ${socket.id}`);

      // Log connection stats
      const stats = websocketDeviceManager.getConnectionStats();
      console.log(`📊 Active connections: ${stats.totalConnections} (${stats.uniqueDevices} unique devices)`);

      // Setup all event handlers when the socket starts
      setupDeviceEvents(socket);
    });


    // Start Periodic heartbeat flush to Postgres every 120 seconds
    this.heartbeatFlushInterval = setInterval(async () => {
      // Fetch all the devices connected to the websocket 
      const devices = websocketDeviceManager.getConnectedDevices();

      // Iterate over all the connected devices
      for (const dev of devices) {
        try {
          // Update the DB with a single Db call
          await deviceService.flushHeartbeatToDB(
            dev.deviceId,
            dev.availableStorageBytes,
          );
        } catch (err) {
          console.error(`❌ Heartbeat flush failed for ${dev.deviceId}:`, err);
        }
      }
    }, 120_000); // 120 seconds

    console.log('🔌 WebSocket server initialized');
  }

  /**
   * Graceful shutdown handler
   * Ensures connections are closed cleanly
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(`\n📡 ${signal} received, shutting down gracefully...`);

      // Stop the heartbeat flush timer
      if (this.heartbeatFlushInterval) {
        clearInterval(this.heartbeatFlushInterval);
        console.log('⏹️  Heartbeat flush timer stopped');
      }

      // Stop accepting new http requests
      this.httpServer.close(() => {
        console.log('🔒 HTTP server closed');
      });

      // Close WebSocket connections
      this.io.close(() => {
        console.log('🔒 WebSocket server closed');
      });

      // Stop background workers
      if (!config.isDevelopment || process.env.START_WORKERS === 'true') {
        // Stop scheduling
        healthScheduler.stop();
        // Stop creating new queues
        await closeQueues();
      }

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

      // Start background workers (only in production)
      if (!config.isDevelopment || process.env.START_WORKERS === 'true') {
        console.log('🦸 Starting background workers...');
        startHealingWorker();
        healthScheduler.start();
        console.log(' Background workers started');
      } else {
        console.log('Background workers disabled in development. Set START_WORKERS=true to enable.');
      }

      // Start HTTP server
      this.httpServer.listen(config.server.port, config.server.host, () => {

       // Log it using Winston
        logger.info('🚀 Vyomanaut Backend Server Running', {
          environment: config.isDevelopment ? 'Development' : 'Production',
          httpServer: `http://${config.server.host}:${config.server.port}`,
          wsServer: `ws://${config.server.host}:${config.server.port}`,
          healthCheck: `http://${config.server.host}:${config.server.port}/health`,
        });
      });
    } catch (error: any) {
      logger.error('❌ Failed to start server', {
        error: error.message,
        stack: error.stack,
      });

      process.exit(1);
    }
  }
}

// Start the server
const server = new VyomonautServer();
server.start();