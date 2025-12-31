import { UserRole } from '@prisma/client';

/**
 * Authentication types
 */

// Registration payloads
// This is incoming from user
export interface UserRegisterPayload {
  email: string;
  password: string;
  name?: string;
  phone?: string;
}

// Incoming from company registrations
export interface CompanyRegisterPayload {
  email: string;
  password: string;
  name: string;
  website?: string;
  industry?: string;
}

// Login payloads for both Company and User
// The role is fetched from DB to prevent role spoofing
export interface LoginPayload {
  email: string;
  password: string;
}

// JWT token payloads
export interface JWTPayload {
  // User/Company/Admin ID
  id: string;           
  email: string;
  role: UserRole;

  // Standard JWT values (optional as managed by themselves)
  // Issued at time
  iat?: number;    
  // Expiry     
  exp?: number;         
}


// Auth responses
// This is what the reply client gets after log in
// We hand them both the access and the refresh token
export interface AuthResponse {
  success: boolean;
  accessToken: string;
  refreshToken: string;

  // These are exposed 
  // So frontend can quickly access them, without decoding JWT
  user: {
    id: string;
    email: string;
    role: UserRole;
    name?: string;
  };
}


// Useful when company moves via SDKs
export interface ApiKeyResponse {
  apiKey: string;
  // Only shown once, then we hash it
  // Generate → show once → hash → discard plaintext
  apiSecret: string; 
  message: string;
}
