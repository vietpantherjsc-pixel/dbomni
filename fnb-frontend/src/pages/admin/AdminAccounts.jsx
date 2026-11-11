// Cây phân quyền chi tiết §2.0/§2.0A (khóa 10/11/2026) — trang quản lý tài
// khoản quản trị (2 tầng: Chủ Sở Hữu · Chủ Chi Nhánh). CHỈ Chủ Sở Hữu vào
// được trang này (backend kiểm lại ở controller + route staff.roles.edit).
// - Tạo: mật khẩu tạm sinh ngẫu nhiên, hiện đúng 1 lần, buộc đổi ở lần đăng
//   nhập đầu; xác nhận bằng mật khẩu của Owner hiện tại.
// - Thu hồi: xóa tài khoản + thu hồi toàn bộ token ngay; lý do bắt buộc;
//   chặn thu hồi Chủ Sở Hữu cuối cùng (backend 422).
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import AdminLayout from '../../components/layout/AdminLayout';

const ACTION_LABELS = {
    owner_created: 'Tạo Chủ Sở Hữu',
    branch_owner_created: 'Tạo Chủ Chi Nhánh',
    owner_revoked: 'Thu hồi Chủ Sở Hữu',
    branch_owner_revoked: 'Thu hồi Chủ Chi Nhánh',
};

function AdminAccounts() {
    const { can } = useAuth();
    const [accounts, setAccounts] = useState([]);
    const [branches, setBranches] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [logs, setLogs] = useState([]);
    const [denied, setDenied] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [form, setForm] = useState({ name: '', email: '', account_tier: 'branch_owner', owner_branch_id: '', employee_id: '', current_password: '' });
    const [creating, setCreating] = useState(false);
    const [tempPassword, setTempPassword] = useState(null);
    const [createdAccount, setCreatedAccount] = useState(null);
    const [revokeId, setRevokeId] = useState(null);
    const [revokeForm, setRevokeForm] = useState({ reason: '', current_password: '' });
    const [revoking, setRevoking] = useState(false);

    const loadAll = () => {
        setLoading(true);
        setError('');
        Promise.all([
            axios.get(API + '/admin-accounts'),
            axios.get(API + '/branches'),
            axios.get(API + '/employees?is_active=1'),
            axios.get(API + '/account-audit-logs?per_page=50'),
        ]).then(([a, b, e, l]) => {
            setAccounts(a.data?.data || []);
            setBranches(b.data?.data || []);
            const list = e.data?.data;
            setEmployees(Array.isArray(list) ? list : (list?.data || []));
            const logsPage = l.data?.data;
            setLogs(Array.isArray(logsPage) ? logsPage : (logsPage?.data || []));
        }).catch((err) => {
            if (err.response?.status === 403) setDenied(true);
            else setError(err.response?.data?.message || 'Không tải được danh sách tài khoản.');
        }).finally(() => setLoading(false));
    };

    useEffect(() => { loadAll(); }, []);

    const handleCreate = async (e) => {
        e.preventDefault();
        setError('');
        setTempPassword(null);
        setCreatedAccount(null);
        setCreating(true);
        try {
            const payload = {
                name: form.name.trim(),
                email: form.email.trim(),
                account_tier: form.account_tier,
                owner_branch_id: form.account_tier === 'branch_owner' ? Number(form.owner_branch_id) : null,
                employee_id: form.employee_id ? Number(form.employee_id) : null,
                current_password: form.current_password,
            };
            const r = await axios.post(API + '/admin-accounts', payload);
            setCreatedAccount(r.data?.data || null);
            setTempPassword(r.data?.password_plain || null);
            setForm({ name: '', email: '', account_tier: 'branch_owner', owner_branch_id: '', employee_id: '', current_password: '' });
            loadAll();
        } catch (err) {
            const data = err.response?.data;
            setError(data?.errors ? Object.values(data.errors).flat().join(' ') : (data?.message || 'Tạo tài khoản thất bại.'));
        } finally {
            setCreating(false);
        }
    };

    const handleRevoke = async (e) => {
        e.preventDefault();
        if (!revokeId) return;
        setError('');
        setRevoking(true);
        try {
            await axios.delete(API + '/admin-accounts/' + revokeId, { data: revokeForm });
            setRevokeId(null);
            setRevokeForm({ reason: '', current_password: '' });
            loadAll();
        } catch (err) {
            const data = err.response?.data;
            setError(data?.errors ? Object.values(data.errors).flat().join(' ') : (data?.message || 'Thu hồi thất bại.'));
        } finally {
            setRevoking(false);
        }
    };

    if (!can('staff.roles.edit')) {
        return (
            <AdminLayout>
            <div className="p-6">
                <h1 className="text-xl font-bold mb-2">Tài khoản quản trị</h1>
                <p className="text-gray-600 text-sm">Bạn không có quyền quản lý tài khoản quản trị.</p>
            </div>
            </AdminLayout>
        );
    }

    if (denied) {
        return (
            <AdminLayout>
            <div className="p-6">
                <h1 className="text-xl font-bold mb-2">Tài khoản quản trị</h1>
                <p className="text-gray-600 text-sm">Chỉ Chủ Sở Hữu quản lý được tài khoản quản trị. Tài khoản của bạn không thuộc tầng Chủ Sở Hữu.</p>
            </div>
            </AdminLayout>
        );
    }

    return (
        <AdminLayout>
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-xl font-bold">Tài khoản quản trị</h1>
                <p className="text-sm text-gray-600 mt-1">
                    Hai tầng tài khoản: <b>Chủ Sở Hữu</b> (toàn quyền, mọi chi nhánh) và <b>Chủ Chi Nhánh</b> (chỉ lương của đúng 1 chi nhánh).
                    Tài khoản quản trị không nằm trong ma trận chức vụ — chỉ Chủ Sở Hữu tạo/thu hồi tại đây.
                </p>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{error}</div>
            )}

            {tempPassword && createdAccount && (
                <div className="bg-amber-50 border border-amber-300 px-4 py-3 rounded text-sm">
                    <div className="font-bold text-amber-800">Đã tạo tài khoản {createdAccount.email} — mật khẩu tạm chỉ hiện 1 lần:</div>
                    <div className="mt-1 text-2xl font-mono font-bold tracking-widest select-all">{tempPassword}</div>
                    <div className="text-amber-700 mt-1">Hãy trao mật khẩu này cho người dùng ngay. Người dùng phải đổi mật khẩu ở lần đăng nhập đầu tiên.</div>
                    <button
                        type="button"
                        onClick={() => { setTempPassword(null); setCreatedAccount(null); }}
                        className="mt-2 text-xs underline text-amber-800"
                    >
                        Đã ghi lại, ẩn đi
                    </button>
                </div>
            )}

            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b font-semibold">Danh sách tài khoản quản trị ({accounts.length})</div>
                {loading ? (
                    <div className="p-4 text-sm text-gray-500">Đang tải...</div>
                ) : accounts.length === 0 ? (
                    <div className="p-4 text-sm text-gray-500">Chưa có tài khoản quản trị nào.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left border-b bg-gray-50">
                                    <th className="px-4 py-2">Tên</th>
                                    <th className="px-4 py-2">Email</th>
                                    <th className="px-4 py-2">Tầng</th>
                                    <th className="px-4 py-2">Chi nhánh</th>
                                    <th className="px-4 py-2">NV liên kết</th>
                                    <th className="px-4 py-2">Mật khẩu tạm</th>
                                    <th className="px-4 py-2 text-right">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {accounts.map((a) => (
                                    <tr key={a.id} className="border-b last:border-0">
                                        <td className="px-4 py-2 font-medium">{a.name}</td>
                                        <td className="px-4 py-2">{a.email}</td>
                                        <td className="px-4 py-2">
                                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${a.account_tier === 'owner' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>
                                                {a.tier_label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2">{a.owner_branch_name || '—'}</td>
                                        <td className="px-4 py-2">{a.employee_name || '—'}</td>
                                        <td className="px-4 py-2">{a.must_change_password ? 'Chưa đổi' : 'Đã đổi'}</td>
                                        <td className="px-4 py-2 text-right">
                                            <button
                                                type="button"
                                                onClick={() => { setRevokeId(a.id); setRevokeForm({ reason: '', current_password: '' }); }}
                                                className="text-red-600 hover:underline text-xs font-semibold"
                                            >
                                                Thu hồi
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {revokeId && (
                <form onSubmit={handleRevoke} className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
                    <div className="font-semibold text-red-800 text-sm">
                        Thu hồi tài khoản {accounts.find((a) => a.id === revokeId)?.email} — tài khoản mất quyền ngay cả khi đang đăng nhập.
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Lý do thu hồi (bắt buộc)</label>
                        <input
                            type="text"
                            value={revokeForm.reason}
                            onChange={(e) => setRevokeForm({ ...revokeForm, reason: e.target.value })}
                            className="w-full border rounded px-3 py-2 text-sm"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Mật khẩu của bạn (xác nhận)</label>
                        <input
                            type="password"
                            value={revokeForm.current_password}
                            onChange={(e) => setRevokeForm({ ...revokeForm, current_password: e.target.value })}
                            className="w-full border rounded px-3 py-2 text-sm"
                            required
                        />
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="submit"
                            disabled={revoking}
                            className="bg-red-600 hover:bg-red-700 text-white text-sm font-bold px-4 py-2 rounded disabled:opacity-50"
                        >
                            {revoking ? 'Đang thu hồi...' : 'Xác nhận thu hồi'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setRevokeId(null)}
                            className="border text-sm font-bold px-4 py-2 rounded bg-white"
                        >
                            Hủy
                        </button>
                    </div>
                </form>
            )}

            <form onSubmit={handleCreate} className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
                <div className="font-semibold">Tạo tài khoản mới</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Tên hiển thị</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            className="w-full border rounded px-3 py-2 text-sm"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Email đăng nhập</label>
                        <input
                            type="email"
                            value={form.email}
                            onChange={(e) => setForm({ ...form, email: e.target.value })}
                            className="w-full border rounded px-3 py-2 text-sm"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Tầng tài khoản</label>
                        <select
                            value={form.account_tier}
                            onChange={(e) => setForm({ ...form, account_tier: e.target.value, owner_branch_id: '' })}
                            className="w-full border rounded px-3 py-2 text-sm"
                        >
                            <option value="branch_owner">Chủ Chi Nhánh — chỉ lương của 1 chi nhánh</option>
                            <option value="owner">Chủ Sở Hữu — toàn quyền mọi chi nhánh</option>
                        </select>
                    </div>
                    {form.account_tier === 'branch_owner' && (
                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1">Chi nhánh (đúng 1)</label>
                            <select
                                value={form.owner_branch_id}
                                onChange={(e) => setForm({ ...form, owner_branch_id: e.target.value })}
                                className="w-full border rounded px-3 py-2 text-sm"
                                required
                            >
                                <option value="">— Chọn chi nhánh —</option>
                                {branches.map((b) => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Nhân viên liên kết (tùy chọn — hồ sơ NV giữ nguyên)</label>
                        <select
                            value={form.employee_id}
                            onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                            className="w-full border rounded px-3 py-2 text-sm"
                        >
                            <option value="">— Không liên kết —</option>
                            {employees.map((e) => (
                                <option key={e.id} value={e.id}>{e.full_name || e.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Mật khẩu của bạn (xác nhận bước lên)</label>
                        <input
                            type="password"
                            value={form.current_password}
                            onChange={(e) => setForm({ ...form, current_password: e.target.value })}
                            className="w-full border rounded px-3 py-2 text-sm"
                            required
                        />
                    </div>
                </div>
                <button
                    type="submit"
                    disabled={creating}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded disabled:opacity-50"
                >
                    {creating ? 'Đang tạo...' : 'Tạo tài khoản + cấp mật khẩu tạm'}
                </button>
            </form>

            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b font-semibold">Nhật ký thêm / thu hồi tài khoản</div>
                {logs.length === 0 ? (
                    <div className="p-4 text-sm text-gray-500">Chưa có ghi nhận nào.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left border-b bg-gray-50">
                                    <th className="px-4 py-2">Thời gian</th>
                                    <th className="px-4 py-2">Người thực hiện</th>
                                    <th className="px-4 py-2">Hành động</th>
                                    <th className="px-4 py-2">Tài khoản bị tác động</th>
                                    <th className="px-4 py-2">Chi tiết</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((l) => (
                                    <tr key={l.id} className="border-b last:border-0">
                                        <td className="px-4 py-2 whitespace-nowrap">{l.created_at}</td>
                                        <td className="px-4 py-2">{l.actor_user?.name || ('#' + l.actor_user_id)}</td>
                                        <td className="px-4 py-2">{ACTION_LABELS[l.action] || l.action}</td>
                                        <td className="px-4 py-2">{l.target_user?.email || l.target_email || '—'}</td>
                                        <td className="px-4 py-2">{l.detail || ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
        </AdminLayout>
    );
}

export default AdminAccounts;
