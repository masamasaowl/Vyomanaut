// @ts-nocheck ( This file is only for testing )

// Simple WebSocket device simulator for testing
// It will create a demo-device so we can test backend separately form web-explorer
const io = require('socket.io-client');

// Configuration
const SERVER_URL = 'http://localhost:3000';
const DEVICE_ID = 'test-device-001';
const USER_ID = 'YOUR_USER_ID_HERE'; // Copy from Postman after registering user
const TOTAL_STORAGE_GB = 10;
const AVAILABLE_STORAGE_GB = 8;

// Create socket connection
console.log('🔌 Connecting to', SERVER_URL);
const socket = io(SERVER_URL);

// Connection events
socket.on('connect', () => {
  console.log('✅ Connected to server!');
  console.log('📱 Socket ID:', socket.id);
  
  // Auto-register on connect
  registerDevice();
});

socket.on('disconnect', (reason) => {
  console.log('❌ Disconnected:', reason);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error.message);
});

// Device registration
function registerDevice() {
  const payload = {
    deviceId: DEVICE_ID,
    userId: USER_ID,
    deviceType: 'ANDROID',
    totalStorageBytes: TOTAL_STORAGE_GB * 1024 * 1024 * 1024
  };
  
  console.log('\n📝 Registering device...');
  socket.emit('device:register', payload);
}

// Listen for registration response
socket.on('device:registered', (data) => {
  console.log('✅ Device registered!');
  console.log('   Status:', data.device?.status);
  console.log('   Reliability:', data.device?.reliabilityScore + '%');
  
  // Start heartbeat
  startHeartbeat();
});

// Heartbeat
let heartbeatInterval;
function startHeartbeat() {
  console.log('\n💓 Starting heartbeat (every 60s)...');
  
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

socket.on('device:pong', (data) => {
  console.log('💓 Heartbeat ACK - Status:', data.status);
});

// Chunk assignment
socket.on('chunk:assign', (data) => {
  console.log('\n📦 Chunk assigned:', data.chunkId);
  console.log('   File ID:', data.fileId);
  console.log('   Sequence:', data.sequenceNum);
  console.log('   Size:', (data.sizeBytes / 1024).toFixed(2) + 'KB');
  
  // Auto-confirm after 1 second (simulating storage)
  setTimeout(() => {
    socket.emit(`chunk:confirm:${data.chunkId}`, { success: true });
    console.log('   ✅ Confirmed chunk', data.chunkId);
  }, 1000);
});

// Chunk retrieval
socket.on('chunk:request', (data) => {
  console.log('\n📤 Chunk requested:', data.chunkId);
  
  // Simulate reading chunk (in real app, read from storage)
  setTimeout(() => {
    socket.emit(`chunk:data:${data.chunkId}`, {
      success: true,
      data: 'base64encodedchunkdata...' // In real app, actual chunk data
    });
    console.log('   ✅ Sent chunk', data.chunkId);
  }, 1000);
});

// Chunk deletion
socket.on('chunk:delete', (data) => {
  console.log('\n🗑️ Delete request:', data.chunkId);
  console.log('   Reason:', data.reason);
  
  // Simulate deletion
  setTimeout(() => {
    socket.emit(`chunk:deleted:${data.chunkId}`, { success: true });
    console.log('   ✅ Deleted chunk', data.chunkId);
  }, 500);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Disconnecting...');
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  socket.disconnect();
  process.exit(0);
});

console.log('\n🚀 Device Simulator Started');
console.log('📌 Press Ctrl+C to stop\n');