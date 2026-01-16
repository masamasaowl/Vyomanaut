'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useFile, useFileChunks } from '@/hooks/useApi';
import { useToast } from '@/contexts/ToastContext';
import { fileAPI } from '@/lib/api';
import {
  ArrowLeft, Download, Trash2, FileText, 
  HardDrive, CheckCircle, AlertTriangle, Clock
} from 'lucide-react';
import {
  formatFileSize, formatDateTime, formatBytes,
  getFileStatusColor, getChunkStatusColor, getErrorMessage
} from '@/lib/utils';

export default function FileDetailsPage({ params }: { params: Promise<{ id: string }> }) {

  // Fetch the ID of the user
  const { id } = use(params);
  // Route back dashboard
  const router = useRouter();
  const toast = useToast();
  
  // Use SWR to fetch the file details 
  const { file, isLoading: fileLoading } = useFile(id);
  // Fetch the file chunks
  const { chunks, count, isLoading: chunksLoading } = useFileChunks(id);
  
  // Directly download the file
  const handleDownload = async () => {
    if (!file) return;
    
    try {
      toast.info('Preparing download...');

      // Call the API
      await fileAPI.download(file.id, file.originalName);
      toast.success('File downloaded!');
    } catch (err: any) {
      toast.error(getErrorMessage(err));
    }
  };
  
  // Delete the file directly
  const handleDelete = async () => {
    if (!file) return;

    // Confirm the deletion from the user 
    if (!confirm(`Delete "${file.originalName}"? This cannot be undone.`)) return;
    
    try {
        // Fetch our API for deletion
      await fileAPI.delete(file.id);
      // Notify on success
      toast.success('File deleted successfully');
      // Return to the dashboard
      router.push('/dashboard');
    } catch (err: any) {
      toast.error(getErrorMessage(err));
    }
  };
  
  // The loading state fetched from SWR
  if (fileLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-sm text-gray-600">Loading file details...</p>
        </div>
      </div>
    );
  }
  
  // If the file doesn't exist 
  // Provide link back to dashboard 
  if (!file) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <FileText className="mx-auto h-12 w-12 text-gray-400" />
          <h2 className="mt-4 text-lg font-semibold text-gray-900">File not found</h2>
          <Link href="/dashboard" className="mt-2 text-sm text-indigo-600 hover:text-indigo-700">
            ← Back to files
          </Link>
        </div>
      </div>
    );
  }
  
  // We inform the user about the chunks that are currently healthy
  const healthyChunks = chunks.filter(c => c.status === 'HEALTHY').length;
  // Provide the percentage of the healthy chunks
  const healthPercentage = count > 0 ? Math.round((healthyChunks / count) * 100) : 0;
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{file.originalName}</h1>
                <p className="text-sm text-gray-500 mt-1">File Details</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownload}
                disabled={file.status !== 'ACTIVE'}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
              >
                <Download className="w-4 h-4" />
                Download
              </button>
              
              <button
                onClick={handleDelete}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Overview Card */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Overview</h2>
              </div>
              
              <div className="p-6">
                <dl className="grid grid-cols-2 gap-6">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">File Size</dt>
                    <dd className="mt-1 text-lg font-semibold text-gray-900">
                      {formatFileSize(file.sizeBytes)}
                    </dd>
                  </div>
                  
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Status</dt>
                    <dd className="mt-1">
                      <span className={`inline-flex px-3 py-1 text-sm font-medium rounded-full border ${getFileStatusColor(file.status)}`}>
                        {file.status}
                      </span>
                    </dd>
                  </div>
                  
                  <div>
                    <dt className="text-sm font-medium text-gray-500">MIME Type</dt>
                    <dd className="mt-1 text-lg font-semibold text-gray-900">
                      {file.mimeType}
                    </dd>
                  </div>
                  
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Total Chunks</dt>
                    <dd className="mt-1 text-lg font-semibold text-gray-900">
                      {file.chunkCount}
                    </dd>
                  </div>
                  
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Created</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {formatDateTime(file.createdAt)}
                    </dd>
                  </div>
                  
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Last Updated</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {formatDateTime(file.updatedAt)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
            
            {/* Chunks List */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Chunks Distribution</h2>
                <p className="text-sm text-gray-500 mt-1">{count} total chunks</p>
              </div>
              
              {chunksLoading ? (
                <div className="p-8 text-center">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {chunks.map((chunk) => (
                    <div key={chunk.id} className="px-6 py-4 hover:bg-gray-50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="shrink-0 w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                            <HardDrive className="w-6 h-6 text-gray-600" />
                          </div>
                          
                          <div>
                            <h3 className="text-sm font-medium text-gray-900">
                              Chunk #{chunk.sequenceNum + 1}
                            </h3>
                            <p className="text-xs text-gray-500 mt-1">
                              {formatBytes(chunk.sizeBytes)} • 
                              {' '}{chunk.currentReplicas}/{chunk.targetReplicas} replicas
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <span className={`px-3 py-1 text-xs font-medium rounded-full border ${getChunkStatusColor(chunk.status)}`}>
                            {chunk.status}
                          </span>
                          
                          {chunk.status === 'HEALTHY' && (
                            <CheckCircle className="w-5 h-5 text-green-500" />
                          )}
                          {chunk.status === 'DEGRADED' && (
                            <AlertTriangle className="w-5 h-5 text-yellow-500" />
                          )}
                          {chunk.status === 'REPLICATING' && (
                            <Clock className="w-5 h-5 text-blue-500 animate-spin" />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* Sidebar */}
          <div className="space-y-6">
            {/* Health Score */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-sm font-medium text-gray-900 mb-4">Health Score</h3>
              
              <div className="text-center">
                <div className="relative inline-flex">
                  <svg className="w-32 h-32 transform -rotate-90">
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="currentColor"
                      strokeWidth="8"
                      fill="transparent"
                      className="text-gray-200"
                    />
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="currentColor"
                      strokeWidth="8"
                      fill="transparent"
                      strokeDasharray={`${2 * Math.PI * 56}`}
                      strokeDashoffset={`${2 * Math.PI * 56 * (1 - healthPercentage / 100)}`}
                      className={
                        healthPercentage === 100 ? 'text-green-500' :
                        healthPercentage >= 80 ? 'text-yellow-500' :
                        'text-red-500'
                      }
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-3xl font-bold text-gray-900">
                      {healthPercentage}%
                    </span>
                  </div>
                </div>
                
                <p className="mt-4 text-sm text-gray-600">
                  {healthyChunks} of {count} chunks healthy
                </p>
              </div>
            </div>
            
            {/* Replication Status */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-sm font-medium text-gray-900 mb-4">Replication Status</h3>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Healthy</span>
                  <span className="text-sm font-medium text-green-600">
                    {chunks.filter(c => c.status === 'HEALTHY').length}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Replicating</span>
                  <span className="text-sm font-medium text-blue-600">
                    {chunks.filter(c => c.status === 'REPLICATING').length}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Degraded</span>
                  <span className="text-sm font-medium text-yellow-600">
                    {chunks.filter(c => c.status === 'DEGRADED').length}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Pending</span>
                  <span className="text-sm font-medium text-gray-600">
                    {chunks.filter(c => c.status === 'PENDING').length}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Security Info */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-sm font-medium text-gray-900 mb-4">Security</h3>
              
              <div className="space-y-3 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>AES-256-GCM Encryption</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>3x Redundancy</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>SHA-256 Checksum</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>Tamper Detection</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}