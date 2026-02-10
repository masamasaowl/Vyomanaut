'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useDeviceStore } from '@/store/deviceStore';
import { useToast } from '@/contexts/ToastContext';
import {
  Wifi,
  WifiOff,
  LogOut,
  RefreshCw,
  Activity,
  HardDrive,
  DollarSign,
  AlertCircle,
  CheckCircle,
  XCircle,
} from 'lucide-react';

/**
 * FIXED Device Dashboard Page
 * 
 * CRITICAL FIXES:
 * 1. ✅ Respect circuit breaker (max 3 retries)
 * 2. ✅ Stop auto-refresh if device not found
 * 3. ✅ Show clear error states
 * 4. ✅ Allow manual retry after fixing issues
 */

export default function DeviceDashboardPage() {
  const router = useRouter();
  
  // Auth
  const { user, isAuthenticated, logout } = useAuthStore();
  
  // Device
  const {
    device,
    isRegistered,
    isConnected,
    connectionError,
    latency,
    chunks,
    chunksLoading,
    chunksError,
    metrics,
    retryCount,
    maxRetries,
    loadChunks,
    connectSocket,
    resetRetryCount,
  } = useDeviceStore();
  
  const toast = useToast();
  
  // Local state
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [uptime, setUptime] = useState(0);
  
  // CRITICAL FIX: Track if circuit breaker is open
  const circuitBreakerOpen = retryCount >= maxRetries;
  
  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);
  
  // Redirect if not registered
  useEffect(() => {
    if (isAuthenticated && !isRegistered) {
      router.push('/device/register');
    }
  }, [isAuthenticated, isRegistered, router]);
  
  // FIXED: Auto-refresh with circuit breaker
  useEffect(() => {
    if (!device || !autoRefresh || circuitBreakerOpen) {
      return;
    }
    
    console.log('🔄 Setting up auto-refresh (every 5s)');
    
    const interval = setInterval(() => {
      console.log('🔄 Auto-refresh triggered');
      loadChunks();
    }, 5000);
    
    return () => {
      console.log('🔄 Clearing auto-refresh');
      clearInterval(interval);
    };
  }, [device, autoRefresh, loadChunks, circuitBreakerOpen]);
  
  // Uptime counter
  useEffect(() => {
    if (!isConnected) return;
    
    const interval = setInterval(() => {
      setUptime(prev => prev + 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isConnected]);
  
  // Load chunks on mount
  useEffect(() => {
    if (device && isConnected && !circuitBreakerOpen) {
      loadChunks();
    }
  }, [device, isConnected,loadChunks,circuitBreakerOpen]);
  
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
  
  // Handle reconnect
  const handleReconnect = async () => {
    if (!device) return;
    
    try {
      const jwt = localStorage.getItem('accessToken');
      if (!jwt) {
        toast.error('No authentication token. Please login again.');
        router.push('/login');
        return;
      }
      
      toast.info('Reconnecting...');
      await connectSocket(jwt, device.deviceId);
      toast.success('Reconnected successfully!');
    } catch (error: any) {
      toast.error(error.message || 'Reconnection failed');
    }
  };
  
  // Handle manual refresh
  const handleManualRefresh = () => {
    if (circuitBreakerOpen) {
      toast.error('Too many failed attempts. Please fix the issue and retry.');
      return;
    }
    
    toast.info('Refreshing chunks...');
    loadChunks();
  };
  
  // CRITICAL FIX: Handle circuit breaker reset
  const handleRetryAfterError = () => {
    console.log('🔄 User requested retry after circuit breaker');
    resetRetryCount();
    
    toast.info('Retrying...');
    loadChunks();
  };
  
  // Format uptime
  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  if (!isAuthenticated || !isRegistered || !device) {
    return null;
  }
  
  return (
    <div className="min-h-screen bg-linear-to-b from-indigo-50 to-white">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-gray-900">Vyomanaut Explorer</h1>
              
              {/* Connection Status Badge */}
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full border-2 ${
                isConnected
                  ? 'border-green-500 bg-green-50'
                  : 'border-red-500 bg-red-50'
              }`}>
                {isConnected ? (
                  <>
                    <Wifi className="w-4 h-4 text-green-600 animate-pulse" />
                    <span className="text-sm font-semibold text-green-700">
                      ONLINE
                    </span>
                    {latency > 0 && (
                      <span className="text-xs text-green-600 ml-1">
                        {latency}ms
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <WifiOff className="w-4 h-4 text-red-600" />
                    <span className="text-sm font-semibold text-red-700">
                      OFFLINE
                    </span>
                  </>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {!isConnected && (
                <button
                  onClick={handleReconnect}
                  className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition"
                >
                  Reconnect
                </button>
              )}
              
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* CRITICAL FIX: Show circuit breaker error */}
        {circuitBreakerOpen && (
          <div className="mb-6 bg-red-50 border-2 border-red-200 rounded-lg p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-red-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-red-900 mb-2">
                  Too Many Failed Attempts
                </h3>
                <p className="text-sm text-red-800 mb-3">
                  Failed to load chunks after {maxRetries} attempts. This usually means:
                </p>
                <ul className="text-sm text-red-700 space-y-1 mb-4">
                  <li>• Device was not properly registered via REST API</li>
                  <li>• Device ID mismatch between registration and connection</li>
                  <li>• Backend server is not running or not accessible</li>
                  <li>• Database connection issues</li>
                </ul>
                <div className="flex gap-3">
                  <button
                    onClick={handleRetryAfterError}
                    className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 transition"
                  >
                    Retry Now
                  </button>
                  <button
                    onClick={() => router.push('/device/register')}
                    className="px-4 py-2 bg-white text-red-600 text-sm font-medium border-2 border-red-600 rounded-md hover:bg-red-50 transition"
                  >
                    Re-register Device
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Connection Error */}
        {connectionError && !circuitBreakerOpen && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800">Connection Error</p>
                <p className="text-sm text-red-700 mt-1">{connectionError}</p>
              </div>
              <button
                onClick={handleReconnect}
                className="text-sm text-red-600 hover:text-red-700 font-medium"
              >
                Retry
              </button>
            </div>
          </div>
        )}
        
        {/* Device Info */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{device.name}</h2>
              <p className="text-sm text-gray-600 mt-1">ID: {device.deviceId}</p>
            </div>
            
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${
              isConnected
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-800'
            }`}>
              {isConnected ? '● ONLINE' : '● OFFLINE'}
            </div>
          </div>
          
          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">
                {(device.totalStorageBytes / (1024 ** 3)).toFixed(0)} GB
              </p>
              <p className="text-sm text-gray-600">Total Storage</p>
            </div>
            
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">
                {(metrics.bytesStored / (1024 ** 3)).toFixed(2)} GB
              </p>
              <p className="text-sm text-gray-600">Used</p>
            </div>
            
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">{chunks.length}</p>
              <p className="text-sm text-gray-600">Chunks</p>
            </div>
            
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">
                {device.reliabilityScore.toFixed(1)}%
              </p>
              <p className="text-sm text-gray-600">Reliability</p>
            </div>
          </div>
        </div>
        
        {/* Activity & Earnings */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          {/* Activity */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-5 h-5 text-indigo-600" />
              <h3 className="text-lg font-semibold text-gray-900">Activity</h3>
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Chunks Received</span>
                <span className="text-sm font-medium text-gray-900">
                  {metrics.chunksReceived}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Chunks Sent</span>
                <span className="text-sm font-medium text-gray-900">
                  {metrics.chunksSent}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Average Latency</span>
                <span className="text-sm font-medium text-gray-900">
                  {latency > 0 ? `${latency}ms` : '--'}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Session Uptime</span>
                <span className="text-sm font-medium text-gray-900">
                  {formatUptime(uptime)}
                </span>
              </div>
            </div>
          </div>
          
          {/* Earnings */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="w-5 h-5 text-green-600" />
              <h3 className="text-lg font-semibold text-gray-900">Earnings</h3>
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Session Earnings</span>
                <span className="text-sm font-medium text-gray-900">
                  ${metrics.sessionEarnings.toFixed(4)}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Total Earnings</span>
                <span className="text-sm font-medium text-gray-900">
                  ${device.totalEarnings.toFixed(2)}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Hourly Rate</span>
                <span className="text-sm font-medium text-gray-900">
                  ${(metrics.sessionEarnings / (uptime / 3600) || 0).toFixed(4)}/hr
                </span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Chunks List */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              <HardDrive className="w-5 h-5 text-indigo-600" />
              <h3 className="text-lg font-semibold text-gray-900">
                Stored Chunks ({chunks.length})
              </h3>
              {autoRefresh && !circuitBreakerOpen && (
                <span className="text-xs text-gray-500">• Updates every 5s</span>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  disabled={circuitBreakerOpen}
                  className="rounded"
                />
                Auto-refresh
              </label>
              
              <button
                onClick={handleManualRefresh}
                disabled={chunksLoading || circuitBreakerOpen}
                className="flex items-center gap-2 px-3 py-1 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-4 h-4 ${chunksLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
          
          {/* Chunks Error (not circuit breaker) */}
          {chunksError && !circuitBreakerOpen && (
            <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-yellow-800">{chunksError}</p>
                  <p className="text-xs text-yellow-700 mt-1">
                    Retrying... (attempt {retryCount}/{maxRetries})
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {/* Chunks List */}
          {chunks.length === 0 ? (
            <div className="text-center py-12">
              <HardDrive className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600">No chunks stored yet</p>
              <p className="text-sm text-gray-500 mt-1">
                Chunks will appear here when companies upload files
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {chunks.map((chunk) => (
                <div
                  key={chunk.id}
                  className="flex justify-between items-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
                >
                  <div className="flex items-center gap-3">
                    {chunk.isHealthy ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500" />
                    )}
                    
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        Chunk {chunk.id.substring(0, 8)}...
                      </p>
                      <p className="text-xs text-gray-600">
                        {(chunk.sizeBytes / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <p className={`text-xs font-medium ${
                      chunk.isHealthy ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {chunk.isHealthy ? 'Healthy' : 'Unhealthy'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(chunk.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      
      {/* Status Bar */}
      <div className={`fixed bottom-0 left-0 right-0 py-2 px-4 text-center text-sm ${
        isConnected ? 'bg-green-600' : 'bg-red-600'
      } text-white`}>
        {isConnected ? (
          <span>● Device is online and earning • Keep this tab open • {formatUptime(uptime)}</span>
        ) : (
          <span>● Device is offline • Reconnect to start earning again</span>
        )}
      </div>
    </div>
  );
}