import { create } from 'zustand';
import { authAPI } from '@/lib/api';

/**
 * Auth Store (Zustand)
 * 
 * Manages authentication state globally
 */

// Define Types
// The user after login
interface User {
  id: string;
  email: string;
  role: string;
  name?: string;
}

// The elements making up our store 
interface AuthState {
  // The variables 
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // The Actions
  // We define the params which the function takes and the async output it produces
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    name: string;
    website?: string;
    industry?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}


// Let's initialize our store 
export const useAuthStore = create<AuthState>((set) => ({

  // Define the state variables
  user: null,
  isAuthenticated: false,
  isLoading: true,
  
  // Login function
  // Pass Email and password as params
  login: async (email, password) => {
    try {
      // await Response from Axios
      const response = await authAPI.login({ email, password });
      
      // Spread response.data to save tokens
      localStorage.setItem('accessToken', response.accessToken);
      localStorage.setItem('refreshToken', response.refreshToken);
      localStorage.setItem('user', JSON.stringify(response.user));
      
      // Set the user and other state variables
      set({
        user: response.user,
        isAuthenticated: true,
        isLoading: false,
      });
      
    
    } catch (error: any) {
      set({ isLoading: false });
      throw new Error(error.response?.data?.error || 'Login failed');
    }
  },
  

  // Register function
  // Performs the same function as login
  register: async (data) => {
    try {
      const response = await authAPI.register(data);
      
      // Save tokens
      localStorage.setItem('accessToken', response.accessToken);
      localStorage.setItem('refreshToken', response.refreshToken);
      localStorage.setItem('user', JSON.stringify(response.user));
      
      set({
        user: response.user,
        isAuthenticated: true,
        isLoading: false,
      });
      
    } catch (error: any) {
      set({ isLoading: false });
      throw new Error(error.response?.data?.error || 'Registration failed');
    }
  },
  

  // Logout using the refresh token
  logout: async () => {
    try {

      // Fetch the refresh token
      const refreshToken = localStorage.getItem('refreshToken');
      
      // Logout using API
      if (refreshToken) {
        await authAPI.logout(refreshToken);
      }
      
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Clear local storage of all the tokens
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      
      // Set state variables after logout
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },
  

  // Load user from localStorage on app start
  // This fetches all the tokens and if they exist then begin from there
  loadUser: async () => {
    try {

      // Fetch the tokens
      const userStr = localStorage.getItem('user');
      const accessToken = localStorage.getItem('accessToken');
      
      // If the user is logged in
      if (userStr && accessToken) {
        // Parse the name
        const user = JSON.parse(userStr);
        
        // Set the state variables for a upstart
        set({
          user,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
      
    } catch (error) {
      set({ isLoading: false });
      console.error('User did not load:', error);
    }
  },
}));