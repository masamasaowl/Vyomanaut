import { Request, Response } from 'express';
import { authService } from './auth.service';

/**
 * Authentication Controller
 * 
 * REST API endpoints for auth
 */
class AuthController {
  
  /**
   * @desc    Register new mobile user
   * @route   POST /api/v1/auth/register/user
   */
  async registerUser(req: Request, res: Response): Promise<void> {
    try {
      const result = await authService.registerUser(req.body);
      res.status(201).json(result);
    } catch (error) {
      console.error('Registration error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Registration failed',
      });
    }
  }
  
  /**
   * @desc    Register new company
   * @route   POST /api/v1/auth/register/company
   */
  async registerCompany(req: Request, res: Response): Promise<void> {
    try {
      const result = await authService.registerCompany(req.body);
      res.status(201).json(result);
    } catch (error) {
      console.error('Registration error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Registration failed',
      });
    }
  }
  
  /**
   * @desc    Login (universal)
   * @route   POST /api/v1/auth/login
   */
  async login(req: Request, res: Response): Promise<void> {
    try {

      // Pass on the request body
      const result = await authService.login(req.body);

      res.json(result);

    } catch (error) {
      console.error('Login error:', error);
      res.status(401).json({
        success: false,
        error: error instanceof Error ? error.message : 'Login failed',
      });
    }
  }
  
  /**
   * @desc    Refresh access token
   * @route   POST /api/v1/auth/refresh
   */
  async refresh(req: Request, res: Response): Promise<void> {
    try {

      // Extract the refresh token
      const { refreshToken } = req.body;

      const result = await authService.refreshAccessToken(refreshToken);

      res.json({ success: true, ...result });

    } catch (error) {
      console.error('Refresh error:', error);
      res.status(401).json({
        success: false,
        error: error instanceof Error ? error.message : 'Token refresh failed',
      });
    }
  }
  
  /**
   * @desc    Logout
   * @route   POST /api/v1/auth/logout
   */
  async logout(req: Request, res: Response): Promise<void> {
    try {

      // Mark the refresh token as revoked
      const { refreshToken } = req.body;

      await authService.logout(refreshToken);

      res.json({ success: true, message: 'Logged out successfully' });

    } catch (error) {
      console.error('Logout error:', error);
      res.status(400).json({
        success: false,
        error: 'Logout failed',
      });
    }
  }
  
  /**
   * @desc    Get current user info
   * @route   GET /api/v1/auth/me
   */
  async getMe(req: Request, res: Response): Promise<void> {
    try {
      
      // User is attached by auth middleware
      res.json({
        success: true,

        // Set by authenticate middleware
        user: req.user, 
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }
  }
}

export const authController = new AuthController();