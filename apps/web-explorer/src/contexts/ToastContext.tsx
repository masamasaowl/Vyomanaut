'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

/**
 * TOAST NOTIFICATION SYSTEM
 * 
 * Features:
 * - Multiple toast types (success, error, warning, info)
 * - Auto-dismiss with configurable duration
 * - Manual dismiss
 * - Stacking with max limit
 * - Animations
 */

// These are the types the toast can take
type ToastType = 'success' | 'error' | 'warning' | 'info';

// A single toast contains
interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

// The entire context has all of this
interface ToastContextType {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  dismissToast: (id: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

// Create the context
// The fallback is (undefined) for now
const ToastContext = createContext<ToastContextType | undefined>(undefined);


// The broadcaster which contains the entire app as it's children
export function ToastProvider({ children }: { children: React.ReactNode }) {

  // To store the toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  

  // We remove a single toast by it's ID
  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);


  /**
   * We create a toast 
   * It stays for 5 seconds
   */
  const showToast = useCallback((
    message: string,
    type: ToastType = 'info',
    duration: number = 5000
  ) => {

    // Generate a random ID of 7 numerics
    const id = Math.random().toString(36).substring(7);
    
    // We store the new toast 
    setToasts(prev => {
      const newToasts = [...prev, { id, type, message, duration }];

      // Limit to 3 latest toasts
      return newToasts.slice(-3);
    });
    
    // Auto dismiss after 5 seconds
    if (duration > 0) {
      setTimeout(() => {
        dismissToast(id);
      }, duration);
    }
  }, []);
  
  
  // SHORTCUT FUNCTIONS
  // Used directly to show toasts
  const success = useCallback((message: string) => {
    showToast(message, 'success', 4000);
  }, [showToast]);
  
  const error = useCallback((message: string) => {
    showToast(message, 'error', 6000);
  }, [showToast]);
  
  const warning = useCallback((message: string) => {
    showToast(message, 'warning', 5000);
  }, [showToast]);
  
  const info = useCallback((message: string) => {
    showToast(message, 'info', 4000);
  }, [showToast]);
  

  // Make the our toaster available to all the component  
  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast, success, error, warning, info }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}


// This is what all the components use to talk to the toaster 
export function useToast() {
  // Find the nearest toast provider
  const context = useContext(ToastContext);

  // Avoid misuse outside the app
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}


// Toast Container Component
// it wraps all the individual toast
function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-md">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}


// Individual Toast Component
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const styles = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };
  
  // The icons
  const icons = {
    success: <CheckCircle className="w-5 h-5 text-green-500" />,
    error: <AlertCircle className="w-5 h-5 text-red-500" />,
    warning: <AlertTriangle className="w-5 h-5 text-yellow-500" />,
    info: <Info className="w-5 h-5 text-blue-500" />,
  };
  
  return (
    <div
      className={`${styles[toast.type]} border rounded-lg p-4 shadow-lg flex items-start gap-3 animate-slide-in`}
      role="alert"
    >
      <div className="shrink-0 mt-0.5">
        {icons[toast.type]}
      </div>
      
      <div className="flex-1 text-sm font-medium">
        {toast.message}
      </div>
      
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 text-gray-400 hover:text-gray-600 transition"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}