import axios, { AxiosInstance, AxiosError } from 'axios';

/**
 * API Client for Vyomanaut Backend
 * 
 * Handles:
 * - Axios Instance
 * - Request/response interceptors
 * - Automatic JWT refresh
 * - Request retry with exponential backoff
 * - Request deduplication
 * - Multiple refresh token requests
 * - 
 */


// Fetch the orchestration backend 
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';


// Flag to check if access token is already refreshing 
let isTokenRefreshing = false;


// Here we store all the requests made to refresh the token
// He makes a queue of all the requests
let failedQueue: any[] = [];

// He informs all the members in the queue about the result of the token fetch request 
const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {

      // Hand them the refresh token they were asking for
      prom.resolve(token);
    }
  });

  // Empty the queue for new fresh requests
  failedQueue = [];
};


// Create axios instance
const api: AxiosInstance = axios.create({
  // Send requests here by default
  baseURL: API_BASE_URL,
  // Return JSON
  headers: {
    'Content-Type': 'application/json',
  },
  // Wait for response for 30 seconds
  timeout: 30000, 
});


// Request interceptor 
// With every request we send the JWT for Authentication purposes in the backend
api.interceptors.request.use(

  // Let's modify the request a little
  (config) => {

    // Fetch the access token generated after login
    const token = localStorage.getItem('accessToken');
    
    // Add the Authorization header to the request
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  
    return config;
  },
  (error) => Promise.reject(error)
);


// Response interceptor 
// Handle Token Expired error by refreshing the token
api.interceptors.response.use(

  // If the response is good we let it pass
  (response) => response,

  // In case of an error
  async (error: AxiosError) => {
    
    // Step 1: Fetch the original request the user made from Axios
    const originalRequest = error.config as any;
    
    // If 401 error shows up & if we have not already tried refreshing the token then
    if (error.response?.status === 401 && !originalRequest._retry) {


      // If another request is working then don't refresh again
      if (isTokenRefreshing) {

        // Simply Queue these requests while refreshing
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })

        // When the token arrives
        // 1. Attach new token
        // 2. retry original request
          .then(token => {
            originalRequest.headers.Authorization = `Bearer ${token}`;

            return api(originalRequest);
          })
          .catch(err => Promise.reject(err));
      }


      // The first request becomes the leader 
      // A boolean to check if we have to retry 
      originalRequest._retry = true;
      // No more requests please
      isTokenRefreshing = true;
      
      try {

        // Step 2: Fetch the refresh token generated after login
        const refreshToken = localStorage.getItem('refreshToken');
        
        // A logout must happen if refresh token is not present
        if (!refreshToken) {
          throw new Error('No refresh token');
        }
        
        // Step 3: Request the server to Refresh access token
        // It return a new
        const { data } = await axios.post(`${API_BASE_URL}/api/v1/auth/refresh`, {

          // Attach the token
          refreshToken,
        });
        

        // Step 4: Save new access token 
        localStorage.setItem('accessToken', data.accessToken);
        
        // Step 5: Announce to all request makers that the token has reached
        processQueue(null, data.accessToken);


        // The leader request retries itself
        // Step 6: Attach the new token to the header
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;


        // Step 7: Retry original request with new token
        // We don't use axios.post() but a fresh instance so the old token doesn't stick to the request
        return api(originalRequest);
        
        // If the refresh token doesn't exist
      } catch (refreshError) {

        // Refresh failed - logout user
        // Remove all his token cookies
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        
        // Redirect to login
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        
        return Promise.reject(refreshError);
      }
      finally {
        // The token has been refreshed
        isTokenRefreshing = false;
      }
    }


    // We Retry on network errors (3 times )
    if (!error.response && !originalRequest._retryCount) {
      // initialize request error
      originalRequest._retryCount = 0;
    }
    
    // We try three times
    if (!error.response && originalRequest._retryCount < 3) {

      // We count again
      originalRequest._retryCount++;

      // We define a delay
      // Exponential backoff: 2s, 4s, 8s
      const delay = Math.pow(2, originalRequest._retryCount) * 1000;
      
      // Now we wait for the delay to end before sending the request again 
      // The code stops here for the delay time
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Request again
      return api(originalRequest);
    }
    
    return Promise.reject(error);
  }
);



// ===================================
// AUTH APIs
// ===================================

/**
 * Directly call Auth operations as methods
 * It directly talks to the backend to perform the following operations: 
 * - Register
 * - Login
 * - Logout
 * - GetMe
 */
export const authAPI = {
  // Register new company
  register: async (data: {
    email: string;
    password: string;
    name: string;
    website?: string;
    industry?: string;
  }) => {
    const response = await api.post('/api/v1/auth/register/user', data);
    return response.data;
  },
  
  // Login
  login: async (data: { email: string; password: string }) => {
    const response = await api.post('/api/v1/auth/login', data);
    return response.data;
  },
  
  // Logout
  logout: async (refreshToken: string) => {
    const response = await api.post('/api/v1/auth/logout', { refreshToken });
    return response.data;
  },
  
  // Get current user
  getMe: async () => {
    const response = await api.get('/api/v1/auth/me');
    return response.data;
  },
};

// ===================================
// DEVICE APIs (NEW)
// ===================================

/**
 * It's Responsibilities
 * - list
 * - get
 * - getHealth
 * - getHealthyDevices
 * - stats
 * - suspend
 */
export const deviceAPI = {

  // They work in sync with our backend
  register: async (data: {
    deviceId: string;
    deviceType: 'DESKTOP' | 'ANDROID' | 'IOS';
    totalStorageBytes: number;
  }) => {
    const response = await api.post('/api/v1/devices/register', data);
    return response.data;
  },
  
  list: async (filters?: {
    status?: string;
    minReliability?: number;
    minStorage?: number;
  }) => {
    const response = await api.get('/api/v1/devices', { params: filters });
    return response.data;
  },
  
  get: async (deviceId: string) => {
    const response = await api.get(`/api/v1/devices/${deviceId}`);
    return response.data;
  },
  
  getHealth: async (deviceId: string) => {
    const response = await api.get(`/api/v1/devices/${deviceId}/health`);
    return response.data;
  },
  
  suspend: async (deviceId: string, reason?: string) => {
    const response = await api.post(`/api/v1/devices/${deviceId}/suspend`, { reason });
    return response.data;
  },

  
  updateStorage: async (deviceId: string, availableStorageBytes: number) => {
    const response = await api.patch(`/api/v1/devices/${deviceId}`, {
      availableStorageBytes
    });
    return response.data;
  },
};


// ===================================
// HEALTH CHECK
// ===================================

// We can fetch a health report
export const healthAPI = {
  check: async () => {
    const response = await api.get('/health');
    return response.data;
  },
};


// ===================================
// HELPER FUNCTIONS
// ===================================

/**
 * Get error message from API error
 */
export function getErrorMessage(error: any): string {
  if (typeof error === 'string') return error;
  // API error
  if (error?.response?.data?.error) return error.response.data.error;
  // TS error
  if (error?.message) return error.message;
  return 'An unexpected error occurred';
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return !!localStorage.getItem('accessToken');
}

/**
 * Get current user from localStorage
 */
export function getCurrentUser() {
  const userStr = localStorage.getItem('user');
  return userStr ? JSON.parse(userStr) : null;
}

export default api;