import { Router } from 'express';
import { authController } from '../../modules/auth/auth.controller';
import { authenticate } from '../middleware/authenticate';

const router: Router = Router();

/**
 * POST /api/v1/auth/register/user
 * Register new mobile user
 */
router.post('/register/user', (req, res) => 
  authController.registerUser(req, res)
);

/**
 * POST /api/v1/auth/register/company
 * Register new company
 */
router.post('/register/company', (req, res) => 
  authController.registerCompany(req, res)
);

/**
 * POST /api/v1/auth/login
 * Login (universal)
 */
router.post('/login', (req, res) => 
  authController.login(req, res)
);

/**
 * POST /api/v1/auth/refresh
 * Refresh access token
 */
router.post('/refresh', (req, res) => 
  authController.refresh(req, res)
);

/**
 * POST /api/v1/auth/logout
 * Logout
 */
router.post('/logout', (req, res) => 
  authController.logout(req, res)
);

/**
 * GET /api/v1/auth/me
 * Get current user (protected route)
 */
router.get('/me', authenticate, (req, res) => 
  authController.getMe(req, res)
);

export default router;