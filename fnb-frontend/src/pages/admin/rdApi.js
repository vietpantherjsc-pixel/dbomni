import axios from 'axios';
import { API } from '../../utils/api';

// SPEC R&D — hotfix 2026-10-21: gắn header Authorization TƯỜNG MINH từng request
// (đúng tiền lệ AdminDashboard/PosScreen) thay vì trông chờ axios.defaults của
// AuthContext — tránh banner "Unauthenticated." khi trang con bắn request trước
// lúc header mặc định kịp gắn / đúng lúc backend restart.
const withAuth = (config = {}) => ({
  ...config,
  headers: {
    ...(config.headers || {}),
    Authorization: `Bearer ${localStorage.getItem('access_token') || ''}`,
  },
});

export const rdGet = (path, config) => axios.get(`${API}${path}`, withAuth(config));
export const rdPost = (path, data, config) => axios.post(`${API}${path}`, data, withAuth(config));
export const rdPut = (path, data, config) => axios.put(`${API}${path}`, data, withAuth(config));
export const rdDelete = (path, config) => axios.delete(`${API}${path}`, withAuth(config));
