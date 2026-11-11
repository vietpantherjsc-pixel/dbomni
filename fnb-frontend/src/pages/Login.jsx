import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../utils/api';

const Login = () => {
    // UX 2026-10-26 (🟠29): KHÔNG điền sẵn tài khoản/mật khẩu test trong code production
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    // Cây phân quyền §2.0A: tài khoản mới nhận mật khẩu tạm phải đổi ngay
    // ở lần đăng nhập đầu (must_change_password) mới được vào Admin.
    const [mustChange, setMustChange] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [newPasswordConfirm, setNewPasswordConfirm] = useState('');

    const { login } = useAuth();
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            // Gọi API Login của backend Laravel
            const response = await axios.post(API + '/login', {
                email,
                password
            });

            // Sử dụng hàm login từ AuthContext để lưu dữ liệu user và token vào localStorage
            login(response.data.user, response.data.access_token);

            // Cây phân quyền §2.0A: mật khẩu tạm → ở lại màn này để đổi mật
            // khẩu (mọi route có gác đều trả 403 MUST_CHANGE_PASSWORD).
            if (response.data.user?.must_change_password) {
                setMustChange(true);
                return;
            }

            // Chuyển hướng người dùng vào trang Admin
            navigate('/admin');
        } catch (err) {
            if (err.response && err.response.data) {
                setError(err.response.data.message || 'Đăng nhập thất bại.');
            } else {
                setError('Không thể kết nối đến máy chủ. Vui lòng kiểm tra Backend.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        setError('');
        if (newPassword !== newPasswordConfirm) {
            setError('Mật khẩu xác nhận không khớp.');
            return;
        }
        setIsLoading(true);
        try {
            await axios.post(API + '/user/password/change', {
                current_password: password,
                password: newPassword,
                password_confirmation: newPasswordConfirm,
            });
            // Đổi xong: cập nhật cờ trong session rồi vào Admin.
            const raw = localStorage.getItem('user');
            if (raw) {
                const u = JSON.parse(raw);
                u.must_change_password = false;
                localStorage.setItem('user', JSON.stringify(u));
            }
            setMustChange(false);
            navigate('/admin');
        } catch (err) {
            const data = err.response?.data;
            setError(data?.errors ? Object.values(data.errors).flat().join(' ') : (data?.message || 'Đổi mật khẩu thất bại.'));
        } finally {
            setIsLoading(false);
        }
    };

    if (mustChange) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-gray-100">
                <div className="w-full max-w-md bg-white rounded-lg shadow-md p-8">
                    <h2 className="text-2xl font-bold text-center text-gray-800 mb-2">Đổi mật khẩu lần đầu</h2>
                    <p className="text-sm text-gray-600 text-center mb-6">
                        Đây là mật khẩu tạm do quản trị viên cấp. Vui lòng đặt mật khẩu mới (tối thiểu 8 ký tự, có chữ thường, chữ IN HOA và ký tự đặc biệt) để tiếp tục.
                    </p>
                    {error && (
                        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-sm">
                            {error}
                        </div>
                    )}
                    <form onSubmit={handleChangePassword}>
                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-2">Mật khẩu mới</label>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:border-blue-500"
                                required
                            />
                        </div>
                        <div className="mb-6">
                            <label className="block text-gray-700 text-sm font-bold mb-2">Nhập lại mật khẩu mới</label>
                            <input
                                type="password"
                                value={newPasswordConfirm}
                                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:border-blue-500"
                                required
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline transition duration-150 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {isLoading ? 'Đang xử lý...' : 'Đổi mật khẩu và tiếp tục'}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen w-screen items-center justify-center bg-gray-100">
            <div className="w-full max-w-md bg-white rounded-lg shadow-md p-8">
                <h2 className="text-2xl font-bold text-center text-gray-800 mb-8">Đăng nhập Hệ thống</h2>
                
                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleLogin}>
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2">Email / Tên đăng nhập nhân viên</label>
                        <input 
                            type="text" 
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:border-blue-500"
                            required
                        />
                    </div>
                    
                    <div className="mb-6">
                        <label className="block text-gray-700 text-sm font-bold mb-2">Mật khẩu</label>
                        <input 
                            type="password" 
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:border-blue-500"
                            required
                        />
                    </div>
                    
                    <button 
                        type="submit" 
                        disabled={isLoading}
                        className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline transition duration-150 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {isLoading ? 'Đang xử lý...' : 'Đăng nhập'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Login;