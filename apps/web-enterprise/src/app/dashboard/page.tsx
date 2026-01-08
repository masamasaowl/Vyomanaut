'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { fileAPI } from '@/lib/api';
import { FileMetadata } from '@/types';
import { Upload, Download, Trash2, LogOut, FileText } from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, logout } = useAuthStore();
  
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  
  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);
  
  // Load files on mount
  useEffect(() => {
    if (isAuthenticated) {
      loadFiles();
    }
  }, [isAuthenticated]);
  
  // Load files from backend
  const loadFiles = async () => {
    try {
      setLoading(true);
      const response = await fileAPI.list();
      setFiles(response.files);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load files');
    } finally {
      setLoading(false);
    }
  };
  
  // Handle file upload
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      setUploading(true);
      setError('');
      setUploadProgress(0);
      
      const response = await fileAPI.upload(file, (progress) => {
        setUploadProgress(progress);
      });
      
      // Reload files
      await loadFiles();
      
      // Reset input
      e.target.value = '';
      setUploadProgress(0);
      
    } catch (err: any) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };
  
  // Handle file download
  const handleDownload = async (fileId: string, fileName: string) => {
    try {
      setError('');
      await fileAPI.download(fileId, fileName);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Download failed');
    }
  };
  
  // Handle file delete
  const handleDelete = async (fileId: string) => {
    if (!confirm('Are you sure you want to delete this file?')) return;
    
    try {
      setError('');
      await fileAPI.delete(fileId);
      await loadFiles();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Delete failed');
    }
  };
  
  // Handle logout
  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return null;
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Vyomanaut Enterprise</h1>
            <p className="text-sm text-gray-600">Welcome, {user?.name}</p>
          </div>
          
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Error Alert */}
        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-4">
            <div className="text-sm text-red-800">{error}</div>
          </div>
        )}
        
        {/* Upload Section */}
        <div className="bg-white shadow rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Files</h2>
          
          <div className="flex items-center gap-4">
            <label className="flex-1">
              <input
                type="file"
                onChange={handleUpload}
                disabled={uploading}
                className="hidden"
              />
              
              <div className="cursor-pointer border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-indigo-500 transition">
                <Upload className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2 text-sm text-gray-600">
                  {uploading ? 'Uploading...' : 'Click to upload or drag and drop'}
                </p>
                {uploading && (
                  <div className="mt-4">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-indigo-600 h-2 rounded-full transition-all"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{uploadProgress}%</p>
                  </div>
                )}
              </div>
            </label>
          </div>
        </div>
        
        {/* Files List */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Your Files</h2>
            <p className="text-sm text-gray-500">{files.length} files stored</p>
          </div>
          
          {loading ? (
            <div className="p-8 text-center text-gray-600">Loading files...</div>
          ) : files.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <FileText className="mx-auto h-12 w-12 text-gray-300" />
              <p className="mt-2">No files uploaded yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {files.map((file) => (
                <div key={file.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-gray-900">{file.originalName}</h3>
                    <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
                      <span>{file.sizeMB} MB</span>
                      <span>•</span>
                      <span>{file.chunkCount} chunks</span>
                      <span>•</span>
                      <span className={`px-2 py-0.5 rounded ${
                        file.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                        file.status === 'UPLOADING' ? 'bg-blue-100 text-blue-800' :
                        file.status === 'DEGRADED' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {file.status}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDownload(file.id, file.originalName)}
                      disabled={file.status !== 'ACTIVE'}
                      className="p-2 text-indigo-600 hover:text-indigo-900 disabled:text-gray-400"
                      title="Download"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                    
                    <button
                      onClick={() => handleDelete(file.id)}
                      className="p-2 text-red-600 hover:text-red-900"
                      title="Delete"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
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