'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useDeviceStore } from '@/store/deviceStore';
import { useToast } from '@/contexts/ToastContext';
import {
  HardDrive, Wifi, WifiOff, TrendingUp, Package,
  LogOut, Circle, Activity, RefreshCw, AlertCircle
} from 'lucide-react';
import { formatFileSize, formatCurrency, formatRelativeTime } from '@/lib/utils';

/**
 * OPTIMIZED Device Dashboard
 * 
 * IMPROVEMENTS:
 * 1. Real-time connection status (always visible)
 * 2. Live chunk assignment feed
 * 3. Connection health indicator
 * 4. Auto-refresh every 5 seconds
 * 5. Clear error messages
 * 6. Reconnect button
 */

export default function DeviceDashboardPage() {
  const router = useRouter();
  
  // Auth
  const { user, logout } = useAuthStore();
  
  // Device
  const {
    device,
    isRegistered,
    isConnected,
    connectionError,
    chunks,
    metrics,
    loadChunks,
    disconnectSocket,
  } = useDeviceStore();
  
  const toast = useToast();
  
  // Local state
  const [currentTime, setCurrentTime] = useState(new Date());
  const [sessionStart] = useState(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  // Redirect if not registered
  useEffect(() => {
    if (!isRegistered) {
      router.push('/device/register');
    }
  }, [isRegistered, router]);
  
  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  
  // Auto-refresh chunks every 5 seconds
  useEffect(() => {
    if (autoRefresh && device) {
      const interval = setInterval(() => {
        loadChunks();
      }, 5000);
      
      return () => clearInterval(interval);
    }
  }, [autoRefresh, device, loadChunks]);
  
  // Load chunks on mount
  useEffect(() => {
    if (device) {
      loadChunks();
    }
  }, [device]);
  
  // Handle logout
  const handleLogout = async () => {
    try {
      disconnectSocket();
      await logout();
      toast.success('Logged out successfully');
      router.push('/login');
    } catch (error) {
      toast.error('Logout failed');
    }
  };
  
  // Handle reconnect
  const handleReconnect = async () => {
    try {
      const jwt = localStorage.getItem('accessToken');
      if (!jwt) {
        throw new Error('No JWT token');
      }
      
      // This would need to be added to deviceStore
      // await connectSocket(jwt);
      toast.success('Reconnecting...');
      window.location.reload();
    } catch (error) {
      toast.error('Reconnect failed');
    }
  };
  
  // Calculate metrics
  const storageUsedBytes = device ? device.totalStorageBytes - device.availableStorageBytes : 0;
  const storageUsedPercent = device ? (storageUsedBytes / device.totalStorageBytes) * 100 : 0;
  
  const sessionUptimeSeconds = Math.floor((currentTime.getTime() - sessionStart.getTime()) / 1000);
  const uptimeHours = Math.floor(sessionUptimeSeconds / 3600);
  const uptimeMinutes = Math.floor((sessionUptimeSeconds % 3600) / 60);
  const uptimeSeconds = sessionUptimeSeconds % 60;
  
  const earningsPerHour = device ? (device.totalStorageBytes / (1024 ** 3)) * (0.5 / 24) : 0;
  const sessionEarnings = earningsPerHour * (sessionUptimeSeconds / 3600);
  
  if (!device) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading device...</div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header with Connection Status */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-gray-900">Vyomanaut Explorer</h1>
              
              {/* Connection Status - Prominent */}
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
                isConnected 
                  ? 'bg-green-100 border-2 border-green-300' 
                  : 'bg-red-100 border-2 border-red-300'
              }`}>
                {isConnected ? (
                  <>
                    <Wifi className="w-4 h-4 text-green-600 animate-pulse" />
                    <span className="text-sm text-green-700 font-semibold">ONLINE</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-4 h-4 text-red-600" />
                    <span className="text-sm text-red-700 font-semibold">OFFLINE</span>
                  </>
                )}
              </div>
              
              {/* Latency indicator */}
              {isConnected && (
                <div className="text-xs text-gray-500">
                  Latency: {metrics.avgLatency.toFixed(0)}ms
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600">
                {user?.email}
              </div>
              
              {!isConnected && (
                <button
                  onClick={handleReconnect}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition"
                >
                  <RefreshCw className="w-4 h-4" />
                  Reconnect
                </button>
              )}
              
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
      
      {/* Connection Error Banner */}
      {connectionError && (
        <div className="bg-red-50 border-b border-red-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <div className="flex-1">
                <p className="text-sm text-red-800 font-medium">Connection Error</p>
                <p className="text-xs text-red-700">{connectionError}</p>
              </div>
              <button
                onClick={handleReconnect}
                className="px-3 py-1 text-sm text-red-700 hover:text-red-800 font-medium"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Device Info Card */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{device.deviceId}</h2>
              <p className="text-sm text-gray-500">Device ID</p>
            </div>
            <div className={`px-4 py-2 rounded-full border-2 ${
              isConnected 
                ? 'bg-green-50 border-green-200 text-green-700' 
                : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              <div className="flex items-center gap-2">
                <Circle className={`w-3 h-3 ${isConnected ? 'fill-green-500' : 'fill-red-500'}`} />
                <span className="font-medium">{isConnected ? 'ONLINE' : 'OFFLINE'}</span>
              </div>
            </div>
          </div>
          
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm font-medium text-gray-600 mb-1">Total Storage</div>
              <div className="text-2xl font-bold text-gray-900">
                {formatFileSize(device.totalStorageBytes)}
              </div>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm font-medium text-gray-600 mb-1">Used Storage</div>
              <div className="text-2xl font-bold text-indigo-600">
                {formatFileSize(storageUsedBytes)}
              </div>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm font-medium text-gray-600 mb-1">Chunks Stored</div>
              <div className="text-2xl font-bold text-gray-900">
                {chunks.length}
              </div>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm font-medium text-gray-600 mb-1">Reliability</div>
              <div className="text-2xl font-bold text-green-600">
                {device.reliabilityScore.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
        
        {/* Storage & Earnings Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Storage Visualization */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Storage Usage</h3>
              <HardDrive className="w-5 h-5 text-gray-400" />
            </div>
            
            <div className="mb-6">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-600">
                  {formatFileSize(storageUsedBytes)} / {formatFileSize(device.totalStorageBytes)}
                </span>
                <span className="font-medium text-indigo-600">
                  {storageUsedPercent.toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                  style={{ width: `${storageUsedPercent}%` }}
                />
              </div>
            </div>
            
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Available</span>
                <span className="font-medium text-gray-900">
                  {formatFileSize(device.availableStorageBytes)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">In Use</span>
                <span className="font-medium text-indigo-600">
                  {formatFileSize(storageUsedBytes)}
                </span>
              </div>
            </div>
          </div>
          
          {/* Earnings */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Earnings</h3>
              <TrendingUp className="w-5 h-5 text-green-500" />
            </div>
            
            <div className="mb-6">
              <div className="text-sm text-gray-600 mb-2">This Session</div>
              <div className="text-4xl font-bold text-green-600">
                {formatCurrency(sessionEarnings)}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Uptime: {uptimeHours}h {uptimeMinutes}m {uptimeSeconds}s
              </div>
            </div>
            
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Rate per hour</span>
                <span className="font-medium text-gray-900">
                  {formatCurrency(earningsPerHour)}/hr
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total earnings</span>
                <span className="font-medium text-green-600">
                  {formatCurrency(device.totalEarnings)}
                </span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Activity Metrics */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Activity</h3>
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded"
                />
                <span className="text-gray-600">Auto-refresh</span>
              </label>
              <button
                onClick={() => loadChunks()}
                className="flex items-center gap-1 text-indigo-600 hover:text-indigo-700"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">{metrics.chunksReceived}</div>
              <div className="text-sm text-gray-600">Chunks Received</div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">{metrics.chunksSent}</div>
              <div className="text-sm text-gray-600">Chunks Sent</div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">{metrics.avgLatency.toFixed(0)}ms</div>
              <div className="text-sm text-gray-600">Avg Latency</div>
            </div>
          </div>
        </div>
        
        {/* Chunks List */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Stored Chunks</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {chunks.length} chunks • Updates every 5 seconds
                </p>
              </div>
              <Package className="w-5 h-5 text-gray-400" />
            </div>
          </div>
          
          {chunks.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <Package className="mx-auto h-12 w-12 text-gray-300 mb-4" />
              <p className="font-medium">No chunks stored yet</p>
              <p className="text-sm mt-2">
                {isConnected 
                  ? 'Keep your device online to start receiving chunks'
                  : 'Connect your device to start receiving chunks'
                }
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
              {chunks.map((chunk) => (
                <div key={chunk.id} className="px-6 py-4 hover:bg-gray-50 transition">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center shrink-0">
                          <Package className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-medium text-gray-900 truncate">
                            Chunk {chunk.chunkId.substring(0, 12)}...
                          </h4>
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                            <span>Stored {formatRelativeTime(chunk.createdAt)}</span>
                            <span>•</span>
                            <span className={`flex items-center gap-1 ${
                              chunk.isHealthy ? 'text-green-600' : 'text-red-600'
                            }`}>
                              <Circle className={`w-2 h-2 ${
                                chunk.isHealthy ? 'fill-green-500' : 'fill-red-500'
                              }`} />
                              {chunk.isHealthy ? 'Healthy' : 'Unhealthy'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="text-right ml-4">
                      <div className="text-sm font-medium text-gray-900 truncate max-w-xs">
                        {chunk.localPath}
                      </div>
                      {chunk.lastVerified && (
                        <div className="text-xs text-gray-500 mt-1">
                          Verified {formatRelativeTime(chunk.lastVerified)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Status Bar */}
        <div className={`mt-6 rounded-lg p-4 border-2 ${
          isConnected 
            ? 'bg-green-50 border-green-200' 
            : 'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className={`w-5 h-5 ${
                isConnected ? 'text-green-600' : 'text-red-600'
              }`} />
              <div>
                <div className={`text-sm font-medium ${
                  isConnected ? 'text-green-900' : 'text-red-900'
                }`}>
                  {isConnected ? 'Device is online and earning' : 'Device is offline'}
                </div>
                <div className={`text-xs ${
                  isConnected ? 'text-green-700' : 'text-red-700'
                }`}>
                  {isConnected 
                    ? 'Keep this tab open to continue earning' 
                    : 'Reconnect to start earning again'
                  }
                </div>
              </div>
            </div>
            <div className={`text-sm ${
              isConnected ? 'text-green-600' : 'text-red-600'
            }`}>
              {currentTime.toLocaleTimeString()}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}