import { Request, Response, NextFunction } from 'express';
import { authService } from '../../modules/auth/auth.service';
import { JWTPayload } from '../../types/auth.types';
import { UserRole } from '@prisma/client';


/**
 * Extend Express Request interface
 * to add the user variable as a global var 
 * 
 * This is later used inside controllers and carry the decoded token values 
 */
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}


/**
 * Authentication Middleware
 * 
 * Verifies JWT token and attaches user to request
 * 
 * Usage:
 * router.get('/protected', authenticate, controller.method);
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  
  try {
    // Get token from header
    // Expected format: Authorization: Bearer <JWT>
    const authHeader = req.headers.authorization;
    
    // Re-login if token doesn't exist 
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'No token provided',
      });
      return;
    }
    
    // Extract the token by splitting from Bearer
    const token = authHeader.split(' ')[1];
    

    // Verify token
    // This logic is served in auth.service.ts
    const decoded = await authService.verifyToken(token);
    

    // Assign this value to the req.user object
    // Now this value can be used everywhere in our controller
    // Example Usage:
    // req.user?.role   
    // req.user?.id
    req.user = decoded;
    
    next();
    
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
    });
  }
}

/**
 * Role-based authorization middleware
 * 
 * It is a higher order function, the outer function is used to remember the role of the user 
 * 
 * Usage:
 * router.post('/admin-only', authenticate, authorize('ADMIN'), controller.method);
 * 
 * @param allowedRoles - It can accept an array of roles from ["USER" | "COMPANY" | "ADMIN"]
 * @returns an Express Authorization Middleware
 */
export function authorize(...allowedRoles: UserRole[]) {

    // This is the actual Express middleware
    // Written inside a function to remember the role
    // By Closure this inner function would too remember the role
  return (req: Request, res: Response, next: NextFunction): void => {
    
    // Are you logged in?
    // Authenticate check
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
      return;
    }
    
    // Are you on the list of allowed roles?
    // Authorization check
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      });
      return;
    }
    
    next();
  };
}


/**
 * API Key authentication (for programmatic access)
 * 
 * Usage:
 * router.post('/api-endpoint', authenticateApiKey, controller.method);
 */
export async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  
  try {

    // We expect the key and secret to arrive as headers 
    // We extract both credentials 
    const apiKey = req.headers['x-api-key'] as string;
    const apiSecret = req.headers['x-api-secret'] as string;
    
    if (!apiKey || !apiSecret) {
      res.status(401).json({
        success: false,
        error: 'API key and secret required',
      });
      return;
    }
    
    // Verify both the credentials from auth.service.ts
    const company = await authService.verifyApiKey(apiKey, apiSecret);
    
    // Attach company to request object so it can be used globally 
    req.user = {
      id: company.id,
      email: company.email,
      role: UserRole.COMPANY,
    };
    
    next();
    
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Invalid API credentials',
    });
  }
}