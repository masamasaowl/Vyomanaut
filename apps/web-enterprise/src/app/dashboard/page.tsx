'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { fileAPI } from '@/lib/api';
import { useFiles, useFileStats } from '@/hooks/useApi';
import { useToast } from '@/contexts/ToastContext';
import { 
  Upload, Download, Trash2, LogOut, FileText, 
  BarChart3, Settings, HardDrive, Eye, Search, Filter 
} from 'lucide-react';
import Link from 'next/link';
import { 
  formatFileSize, formatRelativeTime, 
  getFileStatusColor, validateFileSize, getErrorMessage 
} from '@/lib/utils';


export default function DashboardPage() {

  // We route to login
  const router = useRouter();
  // For Authentication
  const { user, logout } = useAuthStore();
  // Our toast notification
  const toast = useToast();
  
  // State variables
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  

  // Fetch files with SWR 
  // Manually update them
  const { files, isLoading, mutate: refreshFiles } = useFiles({ status: statusFilter });
  // Fetch status of files
  const { stats, mutate: refreshStats } = useFileStats();
  
  // Filter files by search query
  const filteredFiles = files.filter(file =>
    file.originalName.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  // Handle file upload
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {

    // We fetch the files when they get uploaded
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validate file size
    const validation = validateFileSize(file.size);
    if (!validation.valid) {
      toast.error(validation.error!);
      return;
    }
    
    try {
      // Track the upload
      setUploading(true);
      setUploadProgress(0);
      
      // Start the upload
      await fileAPI.upload(file, (progress) => {
        setUploadProgress(progress);
      });
      
      // Provide success notification
      toast.success(`${file.name} uploaded successfully!`);
      
      // Refresh data manually upon upload
      refreshFiles();
      refreshStats();
      
      // Reset the value of upload window 
      e.target.value = '';
      setUploadProgress(0);
      
    } catch (err: any) {
      toast.error(getErrorMessage(err));
    } finally {
      setUploading(false);
    }

    // We alter the memoized function if these variables change
  }, [toast, refreshFiles, refreshStats]);
  

  // Handle file download
  const handleDownload = useCallback(async (fileId: string, fileName: string) => { 
    try {

      // Notify for download start
      toast.info('Preparing download...');

      // Call the API which directly initiates the download of the file
      await fileAPI.download(fileId, fileName);

      // Notify for success
      toast.success('File downloaded!');
    } catch (err: any) {
      toast.error(getErrorMessage(err));
    }
  }, [toast]);
  
  
  // Handle file delete
  const handleDelete = useCallback(async (fileId: string, fileName: string) => {

    // Send a confirm deletion alert to the user via the browser 
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return;
    
    try {

      // We delete the file 
      await fileAPI.delete(fileId);

      // Give the success notification
      toast.success('File deleted successfully');

      // Begin a manual refresh of the dashboard
      refreshFiles();
      refreshStats();
    } catch (err: any) {
      toast.error(getErrorMessage(err));
    }
  }, [toast, refreshFiles, refreshStats]);
  

  // Handle logout
  const handleLogout = useCallback(async () => {

    // We simply await our Auth API
    await logout();
    router.push('/login');
  }, [logout, router]);
  

  return (
    
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-8">
              <h1 className="text-xl font-bold text-gray-900">Vyomanaut</h1>
              
              <nav className="hidden md:flex items-center gap-1">
                <Link
                  href="/dashboard"
                  className="px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-md"
                >
                  Files
                </Link>
                <Link
                  href="/dashboard/analytics"
                  className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md"
                >
                  <BarChart3 className="w-4 h-4 inline mr-1" />
                  Analytics
                </Link>
                <Link
                  href="/dashboard/devices"
                  className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md"
                >
                  <HardDrive className="w-4 h-4 inline mr-1" />
                  Devices
                </Link>
              </nav>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600">
                {user?.name}
              </div>
              
              <Link
                href="/dashboard/settings"
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md"
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </Link>
              
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-md"
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
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Total Files</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">
              {stats?.totalFiles || 0}
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Active Files</div>
            <div className="mt-2 text-3xl font-bold text-green-600">
              {stats?.activeFiles || 0}
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Storage Used</div>
            <div className="mt-2 text-3xl font-bold text-indigo-600">
              {stats?.totalSizeGB || '0'} GB
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-600">Total Chunks</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">
              {stats?.totalChunks || 0}
            </div>
          </div>
        </div>
        
        {/* Upload Section */}
        <div className="bg-white shadow rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Files</h2>
          
          <label className="block">
            <input
              type="file"
              onChange={handleUpload}
              disabled={uploading}
              className="hidden"
            />
            
            <div className="cursor-pointer border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-indigo-500 transition">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-4 text-sm font-medium text-gray-900">
                {uploading ? 'Uploading...' : 'Click to upload or drag and drop'}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Maximum file size: 50GB
              </p>
              
              {uploading && (
                <div className="mt-6 max-w-md mx-auto">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-gray-600">Progress</span>
                    <span className="font-medium text-indigo-600">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </label>
        </div>
        
        {/* Files List */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {/* Header with Search & Filter */}
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Your Files</h2>
                <p className="text-sm text-gray-500">{filteredFiles.length} files</p>
              </div>
              
              <div className="flex items-center gap-3">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search files..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                
                {/* Filter */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">All Status</option>
                  <option value="ACTIVE">Active</option>
                  <option value="UPLOADING">Uploading</option>
                  <option value="DEGRADED">Degraded</option>
                </select>
              </div>
            </div>
          </div>
          
          {/* Files */}
          {isLoading ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <p className="mt-4 text-sm text-gray-600">Loading files...</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <FileText className="mx-auto h-12 w-12 text-gray-300" />
              <p className="mt-4">
                {searchQuery ? 'No files match your search' : 'No files uploaded yet'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredFiles.map((file) => (
                <div key={file.id} className="px-6 py-4 hover:bg-gray-50 transition">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 truncate">
                        {file.originalName}
                      </h3>
                      
                      <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                        <span>{formatFileSize(file.sizeBytes)}</span>
                        <span>•</span>
                        <span>{file.chunkCount} chunks</span>
                        <span>•</span>
                        <span>{formatRelativeTime(file.createdAt)}</span>
                        <span>•</span>
                        <span className={`px-2 py-0.5 rounded border ${getFileStatusColor(file.status)}`}>
                          {file.status}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 ml-4">
                      <Link
                        href={`/dashboard/files/${file.id}`}
                        className="p-2 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                        title="View Details"
                      >
                        <Eye className="w-5 h-5" />
                      </Link>
                      
                      <button
                        onClick={() => handleDownload(file.id, file.originalName)}
                        disabled={file.status !== 'ACTIVE'}
                        className="p-2 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Download"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                      
                      <button
                        onClick={() => handleDelete(file.id, file.originalName)}
                        className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition"
                        title="Delete"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}