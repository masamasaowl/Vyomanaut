// @ts-nocheck ( This file is only for testing )

// Simple WebSocket device simulator for testing
// It will create a demo-device so we can test backend separately form web-explorer

/**
 * OPTIMIZED Device Socket Simulator
 * 
 * NEW FLOW:
 * 1. Register device via REST API → get deviceId & JWT
 * 2. Connect WebSocket with JWT
 * 3. Emit 'device:connect' with deviceId
 * 4. Start heartbeats
 * 5. Handle chunk assignments
 * 
 * CHANGES:
 * - Added JWT authentication
 * - Separated REST registration from WebSocket connection
 * - Uses 'device:connect' instead of 'device:register'
 */

const io = require('socket.io-client');
const axios = require('axios');

// ========================================
// CONFIGURATION
// ========================================

const SERVER_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:3000/api/v1';

// User credentials (register once, reuse JWT)
const USER_EMAIL = 'test-user@vyomanaut.com';
const USER_PASSWORD = 'test-password-123';

// Device info
const DEVICE_ID = 'test-device-001';
const DEVICE_TYPE = 'ANDROID';
const TOTAL_STORAGE_GB = 10;
const AVAILABLE_STORAGE_GB = 8;

// State
let JWT_TOKEN = null;
let USER_ID = null;
let DEVICE_DB_ID = null;

// ========================================
// STEP 1: REGISTER/LOGIN USER
// ========================================

async function registerOrLoginUser() {
  try {
    console.log('\n📝 Step 1: Register/Login user...');
    
    // Try to register (will fail if user exists)
    try {
      const registerResponse = await axios.post(`${API_URL}/auth/register/user`, {
        email: USER_EMAIL,
        password: USER_PASSWORD,
        name: 'Test User'
      });
      
      JWT_TOKEN = registerResponse.data.accessToken;
      USER_ID = registerResponse.data.user.id;
      
      console.log('✅ User registered successfully');
      console.log('   User ID:', USER_ID);
    } catch (error) {
      // User already exists, login instead
      if (error.response?.status === 400) {
        console.log('   User already exists, logging in...');
        
        const loginResponse = await axios.post(`${API_URL}/auth/login`, {
          email: USER_EMAIL,
          password: USER_PASSWORD
        });
        
        JWT_TOKEN = loginResponse.data.accessToken;
        USER_ID = loginResponse.data.user.id;
        
        console.log('✅ User logged in successfully');
        console.log('   User ID:', USER_ID);
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('❌ Failed to register/login user:', error.response?.data || error.message);
    process.exit(1);
  }
}

// ========================================
// STEP 2: REGISTER DEVICE VIA REST API
// ========================================

async function registerDevice() {
  try {
    console.log('\n📱 Step 2: Register device via REST API...');
    
    const response = await axios.post(
      `${API_URL}/devices/register`,
      {
        deviceId: DEVICE_ID,
        deviceType: DEVICE_TYPE,
        totalStorageBytes: TOTAL_STORAGE_GB * 1024 * 1024 * 1024
      },
      {
        headers: {
          'Authorization': `Bearer ${JWT_TOKEN}`
        }
      }
    );
    
    DEVICE_DB_ID = response.data.device.id;
    
    console.log('✅ Device registered via REST API');
    console.log('   Device DB ID:', DEVICE_DB_ID);
    console.log('   Device ID:', DEVICE_ID);
    console.log('   Status:', response.data.device.status);
    console.log('   Reliability:', response.data.device.reliabilityScore + '%');
  } catch (error) {
    console.error('❌ Failed to register device:', error.response?.data || error.message);
    process.exit(1);
  }
}

// ========================================
// STEP 3: CONNECT WEBSOCKET
// ========================================

let socket = null;

async function connectWebSocket() {
  console.log('\n🔌 Step 3: Connecting WebSocket...');
  console.log('   Using JWT:', JWT_TOKEN.substring(0, 20) + '...');
  
  // Connect with JWT in auth
  socket = io(SERVER_URL, {
    auth: {
      token: JWT_TOKEN
    }
  });
  
  // Connection events
  socket.on('connect', () => {
    console.log('✅ WebSocket connected!');
    console.log('   Socket ID:', socket.id);
    
    // Send device:connect event
    connectDevice();
  });
  
  socket.on('disconnect', (reason) => {
    console.log('❌ WebSocket disconnected:', reason);
  });
  
  socket.on('connect_error', (error) => {
    console.error('❌ WebSocket connection error:', error.message);
  });
}

// ========================================
// STEP 4: CONNECT DEVICE
// ========================================

function connectDevice() {
  console.log('\n📡 Step 4: Connecting device...');
  
  const payload = {
    deviceId: DEVICE_ID,
    availableStorageBytes: AVAILABLE_STORAGE_GB * 1024 * 1024 * 1024
  };
  
  socket.emit('device:connect', payload);
}

// Listen for connection response
socket?.on('device:connected', (data) => {
  if (data.success) {
    console.log('✅ Device connected to WebSocket!');
    console.log('   Status:', data.device?.status);
    console.log('   Reliability:', data.device?.reliabilityScore + '%');
    
    // Start heartbeat
    startHeartbeat();
  } else {
    console.error('❌ Device connection failed:', data.message);
  }
});

// ========================================
// STEP 5: HEARTBEAT
// ========================================

let heartbeatInterval = null;

function startHeartbeat() {
  console.log('\n💓 Step 5: Starting heartbeat (every 60s)...');
  
  // Send immediately
  sendHeartbeat();
  
  // Then every 60s
  heartbeatInterval = setInterval(sendHeartbeat, 60000);
}

function sendHeartbeat() {
  const payload = {
    deviceId: DEVICE_ID,
    availableStorageBytes: AVAILABLE_STORAGE_GB * 1024 * 1024 * 1024
  };
  
  socket.emit('device:ping', payload);
}

socket?.on('device:pong', (data) => {
  console.log('💓 Heartbeat ACK - Status:', data.status);
});

// ========================================
// CHUNK HANDLING
// ========================================

socket?.on('chunk:assign', (data) => {
  console.log('\n📦 Chunk assigned:', data.chunkId);
  console.log('   File ID:', data.fileId);
  console.log('   Sequence:', data.sequenceNum);
  console.log('   Size:', (data.sizeBytes / 1024).toFixed(2) + 'KB');
  
  // Simulate storage delay
  setTimeout(() => {
    socket.emit(`chunk:confirm:${data.chunkId}`, { success: true });
    console.log('   ✅ Confirmed chunk', data.chunkId);
  }, 1000);
});

socket?.on('chunk:request', (data) => {
  console.log('\n📤 Chunk requested:', data.chunkId);
  
  // Simulate reading chunk
  setTimeout(() => {
    socket.emit(`chunk:data:${data.chunkId}`, {
      success: true,
      data: 'base64encodedchunkdata...'
    });
    console.log('   ✅ Sent chunk', data.chunkId);
  }, 1000);
});

socket?.on('chunk:delete', (data) => {
  console.log('\n🗑️ Delete request:', data.chunkId);
  console.log('   Reason:', data.reason);
  
  setTimeout(() => {
    socket.emit(`chunk:deleted:${data.chunkId}`, { success: true });
    console.log('   ✅ Deleted chunk', data.chunkId);
  }, 500);
});

// ========================================
// GRACEFUL SHUTDOWN
// ========================================

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (socket) socket.disconnect();
  process.exit(0);
});

// ========================================
// RUN SIMULATOR
// ========================================

async function runSimulator() {
  console.log('🚀 Starting Device Simulator');
  console.log('📌 Press Ctrl+C to stop\n');
  
  await registerOrLoginUser();
  await registerDevice();
  await connectWebSocket();
}

runSimulator().catch(error => {
  console.error('❌ Simulator failed:', error);
  process.exit(1);
});