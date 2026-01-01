import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';

/**
 * Request Logger Middleware
 * 
 * Logs every HTTP request with:
 * - Method, path
 * - Status code
 * - Response time
 * - User info (if authenticated)
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  // Log request
  logger.info(`→ ${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: req.user?.id,
  });
  
  // Capture response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 400 ? 'error' : 'info';
    
    logger[level](`← ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`, {
      statusCode: res.statusCode,
      duration,
      userId: req.user?.id,
    });
  });
  
  next();
}