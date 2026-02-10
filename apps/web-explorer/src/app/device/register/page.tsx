'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useDeviceStore } from '@/store/deviceStore';
import { useToast } from '@/contexts/ToastContext';
import { deviceAPI } from '@/lib/api';
import { Wifi, WifiOff, LogOut, Loader2, CheckCircle, Info, AlertCircle } from 'lucide-react';

/**
 * FIXED Device Registration Page
 * 
 * CRITICAL FIXES:
 * 1. ✅ Generate deviceId ONCE and store it
 * 2. ✅ Use SAME deviceId for REST and WebSocket
 * 3. ✅ Check JWT token before registration
 * 4. ✅ Handle 401 errors properly
 * 5. ✅ Add detailed error logging
 */

export default function DeviceRegisterPage() {
  const router = useRouter();
  
  // Auth
  const { user, isAuthenticated, logout } = useAuthStore();
  
  // Device
  const {
    isRegistered,
    isConnected,
    connectionError,
    registerDevice,
    connectSocket,
  } = useDeviceStore();
  
  const toast = useToast();
  
  // Local state
  const [storageGB, setStorageGB] = useState(10);
  const [step, setStep] = useState<'configure' | 'registering' | 'connecting' | 'complete'>('configure');
  const [error, setError] = useState('');

  // Give the device a name
  const [deviceName, setDeviceName] = useState(() => {
    // Are we in the browser
    if (typeof window === 'undefined') return '';

    // Which browser is it?
    const ua = navigator.userAgent;
    const browserInfo =
      ua.includes('Chrome') ? 'Chrome' :
      ua.includes('Firefox') ? 'Firefox' :
      ua.includes('Safari') ? 'Safari' : 'Browser';

    return `My ${browserInfo} Device`;
  });
  

  // Store generated deviceId in state
  const [generatedDeviceId, setGeneratedDeviceId] = useState<string>('');
  
  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);
  
  // Auto-redirect if already registered and connected
  useEffect(() => {
    if (isRegistered && isConnected) {
      router.push('/device/dashboard');
    }
  }, [isRegistered, isConnected, router]);
  
  
  
  // Handle logout
  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Logged out successfully');
      router.push('/login');
    } catch (error) {
      toast.error('Logout failed');
      console.log(error);
    }
  };
  
  // FIXED: Handle registration with proper device ID management
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      setError('User not found. Please login again.');
      return;
    }
    
    setError('');
    
    // CRITICAL FIX: Check JWT token exists
    const jwt = localStorage.getItem('accessToken');
    if (!jwt) {
      setError('No authentication token found. Please login again.');
      toast.error('Session expired. Please login again.');
      setTimeout(() => router.push('/login'), 2000);
      return;
    }
    
    console.log('🔍 DEBUG: Starting registration...');
    console.log('🔍 User ID:', user.id);
    console.log('🔍 JWT exists:', !!jwt);
    console.log('🔍 JWT length:', jwt.length);
    
    try {
      // CRITICAL FIX: Generate deviceId ONCE and store it
      const deviceId = `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setGeneratedDeviceId(deviceId);
      
      console.log('🔍 Generated Device ID:', deviceId);
      
      const storageBytes = storageGB * 1024 * 1024 * 1024;
      
      // ============================================
      // STEP 1: Register device via REST API
      // ============================================
      setStep('registering');
      console.log('📝 Step 1: Registering device via REST API...');
      
      const response = await deviceAPI.register({
        deviceId,
        deviceType: 'DESKTOP',
        totalStorageBytes: storageBytes,
      });
      
      console.log('✅ REST registration response:', response);
      toast.success('Device registered successfully!');
      
      // CRITICAL FIX: Update deviceStore with the SAME deviceId
      // Pass the deviceId we just registered
      await registerDevice(deviceName, storageBytes, user.id, deviceId);
      
      console.log('✅ Device store updated with deviceId:', deviceId);
      
      // ============================================
      // STEP 2: Connect WebSocket with SAME deviceId
      // ============================================
      setStep('connecting');
      console.log('📡 Step 2: Connecting WebSocket...');
      console.log('📡 Using Device ID:', deviceId);
      console.log('📡 Using JWT:', jwt.substring(0, 20) + '...');
      
      // CRITICAL FIX: Pass deviceId to connectSocket
      await connectSocket(jwt, deviceId);
      
      console.log('✅ WebSocket connected successfully');
      toast.success('Device connected to network!');
      
      // ============================================
      // STEP 3: Complete - redirect to dashboard
      // ============================================
      setStep('complete');
      console.log('🎉 Registration complete!');
      
      setTimeout(() => {
        router.push('/device/dashboard');
      }, 1000);
      
    } catch (err: any) {
      console.error('❌ Registration failed:', err);
      console.error('❌ Error details:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
      });
      
      // Handle specific error codes
      if (err.response?.status === 401) {
        setError('Authentication failed. Your session may have expired. Please login again.');
        toast.error('Session expired. Please login again.');
        setTimeout(() => router.push('/login'), 2000);
      } else if (err.response?.status === 400) {
        setError(err.response?.data?.error || 'Invalid device configuration');
        toast.error(err.response?.data?.error || 'Registration failed');
      } else {
        setError(err.message || 'Registration failed. Please try again.');
        toast.error(err.message || 'Registration failed');
      }
      
      setStep('configure');
    }
  };
  
  // Render different states
  const renderContent = () => {
    // Configuration step
    if (step === 'configure') {
      return (
        <form onSubmit={handleRegister} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Device Name
            </label>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-base"
              placeholder="My Device"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Storage Allocation: <span className="text-indigo-600 font-semibold">{storageGB} GB</span>
            </label>
            <input
              type="range"
              min="1"
              max="50"
              step="1"
              value={storageGB}
              onChange={(e) => setStorageGB(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1 GB</span>
              <span>50 GB</span>
            </div>
          </div>
          
          {/* Earnings Estimate */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-green-900">Potential Earnings</p>
                <p className="text-xs text-green-700">Estimated per month</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-green-600">
                  ₹{(storageGB * 0.5 * 30).toFixed(0)}
                </p>
                <p className="text-xs text-green-700">~₹0.5/GB/day</p>
              </div>
            </div>
          </div>
          
          {/* Info Box */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
              <div className="text-sm text-indigo-900">
                <p className="font-medium mb-1">What happens next?</p>
                <ul className="space-y-1 text-indigo-800">
                  <li>✓ Your device will be registered on the network</li>
                  <li>✓ Encrypted file chunks will be stored in your browser</li>
                  <li>✓ You will start earning based on storage × uptime</li>
                  <li>✓ Keep this tab open to stay connected</li>
                </ul>
              </div>
            </div>
          </div>
          
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-800">Registration Failed</p>
                  <p className="text-sm text-red-700 mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}
          
          <button
            type="submit"
            className="w-full py-3 px-6 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition flex items-center justify-center gap-2"
          >
            Register & Connect Device
          </button>
          
          {/* Debug Info (remove in production) */}
          <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-600">
            <p className="font-medium mb-1">Debug Info:</p>
            <p>User ID: {user?.id}</p>
            <p>Email: {user?.email}</p>
            <p>JWT: {localStorage.getItem('accessToken') ? '✓ Present' : '✗ Missing'}</p>
          </div>
        </form>
      );
    }
    
    // Processing steps
    return (
      <div className="space-y-6">
        {/* Progress Steps */}
        <div className="space-y-4">
          {/* Step 1: Registering */}
          <div className={`flex items-center gap-3 p-4 rounded-lg border-2 ${
            step === 'registering' ? 'border-indigo-500 bg-indigo-50' :
            step === 'connecting' || step === 'complete' ? 'border-green-500 bg-green-50' :
            'border-gray-200'
          }`}>
            {step === 'registering' && (
              <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
            )}
            {(step === 'connecting' || step === 'complete') && (
              <CheckCircle className="w-5 h-5 text-green-600" />
            )}
            
            
            <div className="flex-1">
              <p className="font-medium text-gray-900">Registering Device</p>
              <p className="text-sm text-gray-600">Creating device on server...</p>
              {generatedDeviceId && (
                <p className="text-xs text-gray-500 mt-1">ID: {generatedDeviceId}</p>
              )}
            </div>
          </div>
          
          {/* Step 2: Connecting */}
          <div className={`flex items-center gap-3 p-4 rounded-lg border-2 ${
            step === 'connecting' ? 'border-indigo-500 bg-indigo-50' :
            step === 'complete' ? 'border-green-500 bg-green-50' :
            'border-gray-200'
          }`}>
            {step === 'connecting' && (
              <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
            )}
            {step === 'complete' && (
              <CheckCircle className="w-5 h-5 text-green-600" />
            )}
            {( step === 'registering') && (
              <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
            )}
            
            <div className="flex-1">
              <p className="font-medium text-gray-900">Connecting to Network</p>
              <p className="text-sm text-gray-600">Establishing WebSocket connection...</p>
            </div>
          </div>
          
          {/* Step 3: Complete */}
          <div className={`flex items-center gap-3 p-4 rounded-lg border-2 ${
            step === 'complete' ? 'border-green-500 bg-green-50' : 'border-gray-200'
          }`}>
            {step === 'complete' && (
              <CheckCircle className="w-5 h-5 text-green-600" />
            )}
            {step !== 'complete' && (
              <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
            )}
            
            <div className="flex-1">
              <p className="font-medium text-gray-900">Ready to Earn</p>
              <p className="text-sm text-gray-600">Device is online and operational</p>
            </div>
          </div>
        </div>
        
        {connectionError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800">Connection Error</p>
                <p className="text-sm text-red-700 mt-1">{connectionError}</p>
              </div>
            </div>
            <button
              onClick={() => setStep('configure')}
              className="mt-3 text-sm text-red-600 hover:text-red-700 font-medium"
            >
              ← Try Again
            </button>
          </div>
        )}
      </div>
    );
  };
  
  if (!isAuthenticated) {
    return null;
  }
  
  return (
    <div className="min-h-screen bg-linear-to-b from-indigo-50 to-white">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">Vyomanaut Explorer</h1>
              
              {/* Connection Status */}
              {isRegistered && (
                <div className="flex items-center gap-2">
                  {isConnected ? (
                    <>
                      <Wifi className="w-4 h-4 text-green-500" />
                      <span className="text-sm text-green-600 font-medium">Connected</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-4 h-4 text-red-500" />
                      <span className="text-sm text-red-600 font-medium">Disconnected</span>
                    </>
                  )}
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{user?.email}</span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-md transition"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              {step === 'configure' ? 'Register Your Device' : 'Setting Up Device'}
            </h2>
            <p className="text-gray-600">
              {step === 'configure' 
                ? 'Configure your device to start earning'
                : 'Please wait while we set up your device...'
              }
            </p>
          </div>
          
          {renderContent()}
        </div>
      </main>
    </div>
  );
}