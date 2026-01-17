'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';

/**
 * AuthProvider - Loads user on app start
 * 
 * This runs once when the app loads and checks
 * if user is already logged in (from localStorage)
 */

// We fetch all components as children
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const loadUser = useAuthStore((state) => state.loadUser);
  
  useEffect(() => {
    loadUser();
  }, [loadUser]);
  
  return <>{children}</>;
}