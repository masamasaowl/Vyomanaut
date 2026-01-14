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
    const response = await api.post('/api/v1/auth/register/company', data);
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
// FILE APIs
// ===================================

/**
 * All the file related operations can now be performed simply using following methods
 * - upload
 * - download
 * - list
 * - get
 * - getChunks
 * - delete
 * - stats
 */
export const fileAPI = {
  
  /**
   * Upload FIle 
   * @param file - File is a browser type for all files 
   * @param onProgress - param to report upload progress
   * @returns - Response containing all info about the file
   */
  upload: async (file: File, onProgress?: (progress: number) => void) => {

    // Files cannot be sent as JSON so we convert them to a Form Data to add our own field through which we send our file
    const formData = new FormData();

    // We send the uploaded file inside the file field
    // Multer would read it inside req.file
    formData.append('file', file);
    
    // Send it to our server
    const response = await api.post('/api/v1/files/upload', formData, {

      // Define that it is a file using the MIME type
      headers: {
        'Content-Type': 'multipart/form-data',
      },

      // Axios gives us live upload Progress
      // This would help us create our loading bar
      // Loaded -> How many bytes have been sent till now
      // Total -> the complete file size
      onUploadProgress: (progressEvent) => {

        // If progress count is allowed
        if (progressEvent.total && onProgress) {

          // Convert progress bytes to percentage
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);

          // Calls the UI function to update the progress
          onProgress(progress);
        }
      },
    });
    
    // Return the response we got from backend
    return response.data;
  },
  
  
  // Download file
  // Uses the file name and ID
  download: async (fileId: string, fileName: string) => {

    // Begin to download the file using file ID
    const response = await api.get(`/api/v1/files/${fileId}/download`, {

      // Tell the backend that we expect Binary data
      // Else file corrupts as Axios tries parsing it like JSON
      responseType: 'blob',
    });
    

    // We fool the browser making it think that the user has clicked a download link on the page


    // The response we get is a Buffer (binary)
    // We Create a temporary URL inside the memory out of this binary response
    // Browser treats it as a link
    // eg: blob:http://localhost/abc-123
    const url = window.URL.createObjectURL(new Blob([response.data]));

    
    // We create an invisible anchor tag
    const link = document.createElement('a');
    // We set the this anchor tag value to our created file URL
    link.href = url;

    // Here we begin the download of the anchor tag and give it the name of the file
    link.setAttribute('download', fileName);

    // We attach this anchor tag to our DOM
    document.body.appendChild(link);

    // Immediately click it 
    link.click();
    // Then remove it 
    link.remove();
    // Browser thinks the user clicked on the link
    

    // We return the response to frontend to showcase downloaded file info
    return response.data;
  },
  

  // List all files
  // Use filters to list specific files
  list: async (filters?: { status?: string }) => {
    const response = await api.get('/api/v1/files', { params: filters });
    return response.data;
  },


  // Get file details using it's ID
  get: async (fileId: string) => {
    const response = await api.get(`/api/v1/files/${fileId}`);
    return response.data;
  },


  // Fetch the chunks of the file from it's fileID
  getChunks: async (fileId: string) => {
    const response = await api.get(`/api/v1/files/${fileId}/chunks`);
    return response.data;
  },


  // Delete file
  delete: async (fileId: string) => {
    const response = await api.delete(`/api/v1/files/${fileId}`);
    return response.data;
  },
  
  
  // Get file stats
  stats: async () => {
    const response = await api.get('/api/v1/files/stats');
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
  // 
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
  
  getHealthyDevices: async (params?: {
    minStorage?: number;
    minReliability?: number;
    limit?: number;
  }) => {
    const response = await api.get('/api/v1/devices/healthy', { params });
    return response.data;
  },
  
  stats: async () => {
    const response = await api.get('/api/v1/devices/stats');
    return response.data;
  },
  
  suspend: async (deviceId: string, reason?: string) => {
    const response = await api.post(`/api/v1/devices/${deviceId}/suspend`, { reason });
    return response.data;
  },
};


// ===================================
// PAYMENT APIs (NEW)
// ===================================

/**
 * It's responsibilities 
 * ( These are not functional for now )
 * - getDeviceEarnings
 * - getSystemStats
 */
export const paymentAPI = {
  getDeviceEarnings: async (deviceId: string) => {
    const response = await api.get(`/api/v1/payments/device/${deviceId}`);
    return response.data;
  },
  
  getSystemStats: async () => {
    const response = await api.get('/api/v1/payments/stats');
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

export default api;