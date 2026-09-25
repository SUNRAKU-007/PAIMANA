import axios from 'axios';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');

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
  (error) => {
    if (error.response && error.response.status === 401) {
      if (onUnauthorizedCallback) {
        onUnauthorizedCallback();
      }
    }
    return Promise.reject(error);
  }
);

export default api;
