import axios, { InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { authStorage } from '@/contexts/AuthContext';

const api = axios.create({
  baseURL: '/', // Assuming the Flask backend serves API at the root
  withCredentials: true, // Important for getting cookies
});

// Add a request interceptor to add a token for each request
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = authStorage.getToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// Add a response interceptor to handle potential authentication errors
api.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    if (error.response && error.response.status === 401) {
      // Unauthorized, clear the authentication status
      authStorage.clearAuth(); // Use authStorage to clear the authentication status
 // Redirect to the login page
      window.location.href = '/login';
      
// Return a more descriptive error
      return Promise.reject(new Error('Authentication failed, please log in again'));
    }
    // For other errors, just pass them through
    return Promise.reject(error);
  }
);

export default api;
