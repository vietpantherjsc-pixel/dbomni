import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const Login = () => {
    // Điền sẵn thông tin tài khoản test để tiện phát triển
    const [email, setEmail] = useState('admin@cafe.com');
    const [password, setPassword] = useState('123456');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            // Gọi API Login của backend Laravel
            const response = await axios.post('http://localhost/api/login', {
                email,
                password
            });

            // Sử dụng hàm login từ AuthContext để lưu dữ liệu user và token vào localStorage
            login(response.data.user, response.data.access_token);

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