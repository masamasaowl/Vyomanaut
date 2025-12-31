import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../../config/database';
import { config } from '../../config/env';
import {
  UserRegisterPayload,
  CompanyRegisterPayload,
  LoginPayload,
  AuthResponse,
  JWTPayload,
} from '../../types/auth.types';
import { UserRole } from '@prisma/client';


/**
 * Authentication Service
 * 
 * 
 * Responsibilities:
 * 1. Register new users/companies
 * 2. Login authentication
 * 3. JWT token generation
 * 4. Password hashing
 * 5. Email verification
 * 6. Password reset
 */
class AuthService {
  
  private readonly JWT_SECRET = config.jwt.secret;
  private readonly JWT_EXPIRES_IN = '15m'; // Access token: 15 minutes
  private readonly REFRESH_EXPIRES_IN = '7d'; // Refresh token: 7 days
  private readonly SALT_ROUNDS = 12;
  

  // ================================================
  // USER REGISTRATION (Mobile App)
  // ================================================
  
  /**
   * Register a new mobile app user
   * 
   * Flow:
   * 1. Validate email 
   * 2. Hash password
   * 3. Create User record
   * 4. Generate verification email (optional for MVP)
   * 5. Return JWT tokens
   */
  async registerUser(payload: UserRegisterPayload): Promise<AuthResponse> {
    
    console.log(`📱 Registering new user: ${payload.email}`);
    
    // Step 1: Check if email exists
    const existingUser = await prisma.user.findUnique({
      where: { email: payload.email },
    });
    
    if (existingUser) {
      throw new Error('Email already registered');
    }
    
    // Step 2: Hash password
    const hashedPassword = await bcrypt.hash(payload.password, this.SALT_ROUNDS);
    
    
    // Step 3: Create user
    const user = await prisma.user.create({
      data: {
        email: payload.email,
        password: hashedPassword,
        name: payload.name || null,
        phone: payload.phone,
        role: UserRole.USER,

        // Generate verification token (later it aids us for verification by email of user)
        verificationToken: crypto.randomBytes(32).toString('hex'),
      },
    });
    
    console.log(`✅ User registered: ${user.id}`);
    

    // Step 4: Generate JWT tokens for this user 
    const { accessToken, refreshToken } = await this.generateTokens(
      user.id,
      user.email,
      user.role
    );
    
    // TODO: Send verification email through the verification token we have saved in DB
    // example: await emailService.sendVerificationEmail(user.email, user.verificationToken);
    

    return {
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name || undefined,
      },
    };
  }
  

  // =================================================
  // COMPANY REGISTRATION (Dashboard)
  // =================================================
  
  /**
   * Register a new company
   * 
   * Similar to user registration but for companies
   * Contains the API way to register and send files
   */
  async registerCompany(payload: CompanyRegisterPayload): Promise<AuthResponse> {
    
    console.log(`🏢 Registering new company: ${payload.email}`);
    
    // Step 1: Check if email exists
    const existingCompany = await prisma.company.findUnique({
      where: { email: payload.email },
    });
    
    if (existingCompany) {
      throw new Error('Email already registered');
    }
    
    // Step 2: Hash password
    const hashedPassword = await bcrypt.hash(payload.password, this.SALT_ROUNDS);
    

    // Step 3: Generate API key and secret
    // The company must send us both 
    // apiKey -> username
    // apiSecret -> password for verification
    const apiKey = `vyo_${crypto.randomBytes(24).toString('hex')}`;

    const apiSecret = crypto.randomBytes(32).toString('hex');

    // Hash the secret and store in our DB
    const apiSecretHash = await bcrypt.hash(apiSecret, this.SALT_ROUNDS);
    

    // Step 4: Create company
    const company = await prisma.company.create({
      data: {
        email: payload.email,
        password: hashedPassword,
        name: payload.name,
        website: payload.website,
        industry: payload.industry,
        role: UserRole.COMPANY,
        apiKey,
        apiSecretHash,
        verificationToken: crypto.randomBytes(32).toString('hex'),
      },
    });
    
    console.log(`✅ Company registered: ${company.id}`);
    console.log(`   API Key: ${apiKey}`);
    

    // Generate tokens
    const { accessToken, refreshToken } = await this.generateTokens(
      company.id,
      company.email,
      company.role
    );
    
    return {
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: company.id,
        email: company.email,
        role: company.role,
        name: company.name || undefined,
      },
    };
  }
  

  // =================================================
  // UNIVERSAL LOGIN 
  // =================================================
  
  /**
   * Login for any user type
   * 
   * Automatically detects if User, Company, or Admin
   */
  async login(payload: LoginPayload): Promise<AuthResponse> {
    
    console.log(`🔐 Login attempt: ${payload.email}`);
    
    // Step 1: Find the role of the user
    // Try to find the user role in all three tables
    // We'll optimize it in the future
    const user = await prisma.user.findUnique({
      where: { email: payload.email },
    });
    
    const company = await prisma.company.findUnique({
      where: { email: payload.email },
    });
    
    const admin = await prisma.admin.findUnique({
      where: { email: payload.email },
    });
    

    // We store the user role
    const account = user || company || admin;
    
    if (!account) {
      throw new Error('Invalid email or password');
    }
    

    // Step 2: Verify password
    // Done by bcrypt by comparing both the hashes 
    const isValidPassword = await bcrypt.compare(payload.password, account.password);
    
    if (!isValidPassword) {
      throw new Error('Invalid email or password');
    }
    

    // Step 3: Check if account is suspended
    // Check based on status of account
    // status field not present for ADMIN so first check if status field exists in object
    if ('status' in account && account.status === 'SUSPENDED') {
      throw new Error('Account is suspended. Contact support.');
    }
    
    console.log(`✅ Login successful: ${account.email} (${account.role})`);
    

    // Step 4: Hand over the tokens to the user 
    const { accessToken, refreshToken } = await this.generateTokens(
      account.id,
      account.email,
      account.role
    );
    
    // Login was successful
    return {
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: account.id,
        email: account.email,
        role: account.role,
        name: account.name || undefined,
      },
    };
  }
  

  
  // ================================================
  // TOKEN GENERATION
  // ================================================
  
  /**
   * Generate JWT access + refresh tokens
   * 
   * @params id, email, role - only ones needed
   * @returns - access and refresh token
   */
  private async generateTokens(
    id: string,
    email: string,
    role: UserRole
  ): Promise<{ accessToken: string; refreshToken: string }> {
    
    // Create JWT payload
    // Only these fields are necessary other fields could've been sensitive
    const payload: JWTPayload = { id, email, role };
    

    // Generate the short-lived JWT access token 
    const accessToken = jwt.sign(payload, this.JWT_SECRET, {
      expiresIn: this.JWT_EXPIRES_IN, // 15 minutes
    });
    

    // Generate long-lived refresh token 
    // This is random 512 bit hex token stored in DB
    const refreshToken = crypto.randomBytes(64).toString('hex');
    
    // Store refresh token in database for repetitive use 
    // The id is same as that of User/Company/Admin
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userType: role,
        userId: id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });
    
    return { accessToken, refreshToken };
  }
  

  /**
   * Refresh access token 
   * 
   * @param refreshToken - the hex code stored in DB
   * @returns new accessToken
   */
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
    

    // Find refresh token in database
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });
    
    // Errors to ask user to login again
    // Error 1
    if (!tokenRecord || tokenRecord.isRevoked) {
      throw new Error('Invalid refresh token');
    }
    
    // Error 2: Check if expired
    if (new Date() > tokenRecord.expiresAt) {
      throw new Error('Refresh token expired');
    }
    

    // Pass the new access token based on the same userId stored in both refreshToken and User/Company/Admin table
    let account;

    // We use one RefreshToken table for all
    // So check the role every time
    // role: User
    if (tokenRecord.userType === UserRole.USER) {
      account = await prisma.user.findUnique({ where: { id: tokenRecord.userId } });

      // role: Company
    } else if (tokenRecord.userType === UserRole.COMPANY) {
      account = await prisma.company.findUnique({ where: { id: tokenRecord.userId } });

      // role: Admin
    } else {
      account = await prisma.admin.findUnique({ where: { id: tokenRecord.userId } });
    }
    
    if (!account) {
      throw new Error('Account not found');
    }
    

    // Generate new access token
    const accessToken = jwt.sign(
      { id: account.id, email: account.email, role: account.role },
      this.JWT_SECRET,
      { expiresIn: this.JWT_EXPIRES_IN }
    );
    
    return { accessToken };
  }
  

  /**
   * Verify JWT token 
   * 
   * this is used by the authenticate.ts middleware that validates
   * - signature
   * - expiry 
   * - decodes payload
   */
  async verifyToken(token: string): Promise<JWTPayload> {
    try {

      // Verify the signature using JWT
      const decoded = jwt.verify(token, this.JWT_SECRET) as JWTPayload;

      // contains the decoded payload: id, email, role
      return decoded;
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }
  

  /**
   * Logout 
   * 
   * Revoke the refresh token to log out from all devices at once and terminate the session
   */
  async logout(refreshToken: string): Promise<void> {

    // We use updateMany only for safety as we are not passing the id
    await prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      // We revoke and not delete
      data: { isRevoked: true },
    });
  }
  


  // ============================================
  // API KEY AUTHENTICATION FOR SDKs
  // =============================================
  
  /**
   * Verify API key 
   * Login via API
   * 
   * Validates companies contacting us through REST APIs
   * 
   * used by authenticate.ts middleware
   * 
   * @param apiKey - Identify company 
   * @param apiSecret - Prove authenticity
   * @returns company details in DB
   */
  async verifyApiKey(apiKey: string, apiSecret: string): Promise<any> {
    
    // Extract company info based on apiKey
    const company = await prisma.company.findUnique({
      where: { apiKey },
    });
    
    // Don't make the error reveal if the issue lies in the key or the secret 
    if (!company) {
      throw new Error('Invalid API connection request');
    }
    
    // Verify secret by matching the hashes
    const isValid = await bcrypt.compare(apiSecret, company.apiSecretHash!);
    
    if (!isValid) {
      throw new Error('Invalid API connection credentials');
    }
    
    return company;
  }
  

  /**
   * Regenerate API key
   * 
   * @param companyId - simply based in company ID
   * @returns new apiKey and apiSecret 
   */
  async regenerateApiKey(companyId: string): Promise<{
    apiKey: string;
    apiSecret: string;
  }> {
    
    // Let's regenerate them for the company
    // API key 
    const apiKey = `vyo_${crypto.randomBytes(24).toString('hex')}`;

    // API secret 
    const apiSecret = crypto.randomBytes(32).toString('hex');
    // Hash it
    const apiSecretHash = await bcrypt.hash(apiSecret, this.SALT_ROUNDS);
    

    // Assign them new for the company
    // The previous credentials vanish instantly 
    await prisma.company.update({
      where: { id: companyId },
      data: { apiKey, apiSecretHash },
    });
    
    // Return for reference 
    return { apiKey, apiSecret };
  }
}

export const authService = new AuthService();