import axios from 'axios';

// In dev, requests go through Vite's /api proxy so the app works both locally
// and inside hosted previews where the browser cannot reach localhost:8000.
export const API_BASE_URL = import.meta.env.DEV
  ? '/api'
  : (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
});

let onUnauthorizedCallback = null;

export function setOnUnauthorizedCallback(cb) {
  onUnauthorizedCallback = cb;
}

// Request interceptor: automatically attaches Bearer token from localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: automatically logs out on 401 (token expired/invalid)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response && error.response.status === 401) {
      if (onUnauthorizedCallback) {
        onUnauthorizedCallback();
      }
    }

    // A sleeping backend often answers the first request with a network error or 502/503/504.
    // Retry GETs a couple of times so the page fills in once the server is awake.
    const config = error.config;
    const status = error.response?.status;
    const retriable = !error.response || [502, 503, 504].includes(status);
    if (config && config.method === 'get' && retriable && (config.__retryCount || 0) < 2) {
      config.__retryCount = (config.__retryCount || 0) + 1;
      await new Promise((resolve) => setTimeout(resolve, 2000 * config.__retryCount));
      return api(config);
    }
    return Promise.reject(error);
  }
);

export default api;
