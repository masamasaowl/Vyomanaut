'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useDeviceStore } from '@/store/deviceStore';
import { useToast } from '@/contexts/ToastContext';

export default function DeviceRegisterPage() {
  const router = useRouter();

 // The Auth store
  const {
    user,
    isAuthenticated, 
    isLoading: authLoading 
  } = useAuthStore();

  // The Device store (our socket events)
  const {
    isConnected,
    isRegistered,
    connectSocket,
    registerDevice,
    connectionError,
  } = useDeviceStore();

  const toast = useToast();
  
  // State variables
  const [deviceName, setDeviceName] = useState('');
  // We set storage by default 5GB
  const [storageGB, setStorageGB] = useState(5); 
  const [connecting, setConnecting] = useState(false);
  const [registering, setRegistering] = useState(false);
  // To render conditional styling between login and register, we mark the step
  const [step, setStep] = useState<'connect' | 'register'>('connect');
  

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);
  

  // Redirect to dashboard if already registered
  useEffect(() => {
    if (isRegistered) {
      router.push('/device/dashboard');
    }
  }, [isRegistered, router]);
  

  // Auto-generate device name from browser
  useEffect(() => {
    // Extract the browser 
    if (!deviceName) {
      const browserInfo =
        navigator.userAgent.includes('Chrome') ? 'Chrome' :
        navigator.userAgent.includes('Firefox') ? 'Firefox' :
        navigator.userAgent.includes('Safari') ? 'Safari' : 'Browser';

      // Set browser as the device name 
      setDeviceName(`My ${browserInfo} Device`);
    }
  }, []);
  
  
  // Handle WebSocket connection
  const handleConnect = async () => {
    setConnecting(true);
    
    try {
      // Call the store to connect to server
      await connectSocket();
      // Success
      toast.success('Connected to Vyomanaut network!');

      // Now we can register our device
      setStep('register');
    } catch (error: any) {
      toast.error(error.message || 'Connection failed');
    } finally {
      // We are connected
      setConnecting(false);
    }
  };
  
  // Handle device registration
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Make sure user is logged in
    if (!user) {
      toast.error('User not found. Please login again.');
      router.push('/login');
      return;
    }
    
    // Let's register the device
    setRegistering(true);
    
    try {
      // Convert GB to bytes
      // We showcase it as 5GB
      const storageBytes = storageGB * 1024 * 1024 * 1024; 
      
      // Call the store to get the device registered
      await registerDevice(deviceName, storageBytes, user.id);
      
      toast.success('Device registered successfully! Starting to earn...');
      // redirect
      router.push('/device/dashboard');
    } catch (error: any) {
      toast.error(error.message || 'Registration failed');
    } finally {
      // The device is registered
      setRegistering(false);
    }
  };
  
  
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-linear-to-b from-indigo-50 to-white py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Register Your Device
          </h1>
          <p className="text-gray-600">
            Connect to the Vyomanaut network and start earning
          </p>
        </div>
        
        {/* Step Indicator */}
        <div className="flex items-center justify-center mb-8">
          <div className={`flex items-center ${step === 'connect' ? 'text-indigo-600' : 'text-green-600'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${step === 'connect' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-green-600 bg-green-600 text-white'}`}>
              {step === 'connect' ? '1' : '✓'}
            </div>
            <span className="ml-2 font-medium">Connect</span>
          </div>
          
          <div className="w-16 h-0.5 mx-4 bg-gray-300"></div>
          
          <div className={`flex items-center ${step === 'register' ? 'text-indigo-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${step === 'register' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300'}`}>
              2
            </div>
            <span className="ml-2 font-medium">Register</span>
          </div>
        </div>
        
        {/* Main Content */}
        <div className="bg-white rounded-lg shadow-lg p-8">
          {step === 'connect' ? (
            /* Step 1: Connect to WebSocket */
            <div className="text-center">
              <div className="w-24 h-24 mx-auto mb-6 bg-indigo-100 rounded-full flex items-center justify-center">
                <svg className="w-12 h-12 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                </svg>
              </div>
              
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Connect to Network
              </h2>
              
              <p className="text-gray-600 mb-8">
                We will establish a secure connection to the Vyomanaut backend. Your device will be able to receive and serve file chunks.
              </p>
              
              {connectionError && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-800">{connectionError}</p>
                </div>
              )}
              
              {isConnected ? (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-md">
                  <p className="text-sm text-green-800">✓ Connected successfully!</p>
                </div>
              ) : null}
              
              <button
                onClick={handleConnect}
                disabled={connecting || isConnected}
                className="w-full py-3 px-6 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 disabled:bg-gray-400 transition"
              >
                {connecting ? 'Connecting...' : isConnected ? 'Connected ✓' : 'Connect to Network'}
              </button>
            </div>
          ) : (
            /* Step 2: Register Device */
            <form onSubmit={handleRegister}>
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Device Name
                  </label>
                  <input
                    type="text"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                
                {/* Info Box */}
                <div className="bg-indigo-50 border border-indigo-200 rounded-md p-4">
                  <h3 className="font-medium text-indigo-900 mb-2">What happens next?</h3>
                  <ul className="text-sm text-indigo-800 space-y-1">
                    <li>✓ Your device will be registered on the network</li>
                    <li>✓ Companies file chunks will be stored in your browser</li>
                    <li>✓ You will start earning money based on storage × uptime</li>
                    <li>✓ Your device stays online as long as this tab is open</li>
                  </ul>
                </div>
                
                {/* Earnings Estimate */}
                <div className="bg-green-50 border border-green-200 rounded-md p-4">
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
                
                <button
                  type="submit"
                  disabled={registering}
                  className="w-full py-3 px-6 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 disabled:bg-gray-400 transition"
                >
                  {registering ? 'Registering...' : 'Register Device'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}