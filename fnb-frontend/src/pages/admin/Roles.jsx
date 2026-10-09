import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';

const API = 'http://localhost/api';
const ACTION_LABELS = { view: 'Xem', create: 'Thêm', edit: 'Sửa', delete: 'Xóa' };

// Gói 26: Chức vụ & ma trận phân quyền chi tiết.
export default function Roles() {
    const { can } = useAuth();
    const [roles, setRoles] = useState([]);
    const [matrix, setMatrix] = useState([]);
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState('');
    const [perms, setPerms] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [loadError, setLoadError] = useState('');

    const fetchAll = async () => {
        try {
            setLoadError('');
            const [r, m] = await Promise.all([axios.get(API + '/roles'), axios.get(API + '/roles/matrix')]);
            setRoles(r.data?.data || []); setMatrix(m.data?.data || []);
        } catch (e) {
            setLoadError(e.response?.data?.message || 'Không tải được danh sách chức vụ. Kiểm tra backend/migrate.');
        }
    };
    useEffect(() => { fetchAll(); }, []);

    if (!can('staff.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Nhân viên.</div></AdminLayout>);
    const editable = can('staff.edit');

    const togglePerm = (key) => setPerms(perms.includes(key) ? perms.filter((p) => p !== key) : [...perms, key]);
    const openAdd = () => { setEditing(null); setName(''); setPerms([]); setShowForm(true); };
    const openEdit = (r) => { setEditing(r); setName(r.name); setPerms(r.permissions || []); setShowForm(true); };
    const closeForm = () => { setEditing(null); setName(''); setPerms([]); setShowForm(false); };
    const save = async () => {
        if (!name.trim()) return alert('Nhập tên chức vụ');
        try {
            if (editing) await axios.patch(API + '/roles/' + editing.id, { name: name.trim(), permissions: perms });
            else await axios.post(API + '/roles', { name: name.trim(), permissions: perms });
            closeForm(); fetchAll();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };
    const remove = async (id) => { if (!window.confirm('Xóa chức vụ này?')) return; try { await axios.delete(API + '/roles/' + id); fetchAll(); } catch (e) { alert(e.response?.data?.message || 'Xóa thất bại'); } };

    return (
        <AdminLayout>
            <div className="p-5">
                <h1 className="text-xl font-bold mb-4">Chức vụ & phân quyền</h1>
                <div className="grid lg:grid-cols-[280px_1fr] gap-4">
                    <div className="m-card p-4 h-fit">
                        <h3 className="font-bold mb-3 text-[14px]">Danh sách chức vụ</h3>
                        {loadError && <p className="text-red-500 text-[12px] mb-2">{loadError}</p>}
                        {roles.map((r) => (
                            <div key={r.id} className={'flex items-center justify-between px-3 py-2.5 rounded-lg mb-1 ' + (editing?.id === r.id ? 'bg-[#24305E] text-white' : 'bg-gray-50')}>
                                <button onClick={() => openEdit(r)} className="text-left flex-1">
                                    <div className="font-medium text-[13px]">{r.name}</div>
                                    <div className={'text-[11px] ' + (editing?.id === r.id ? 'text-gray-300' : 'text-gray-400')}>{r.employees_count} nhân viên · {r.permissions?.includes('*') ? 'full quyền' : (r.permissions?.length || 0) + ' quyền'}</div>
                                </button>
                                {editable && <button onClick={() => remove(r.id)} className={'text-[12px] ml-2 ' + (editing?.id === r.id ? 'text-red-300' : 'text-red-500')}>Xóa</button>}
                            </div>
                        ))}
                        {editable && <button onClick={openAdd} className="w-full mt-2 px-3 py-2 rounded border border-dashed border-gray-300 text-[13px] text-gray-500">+ Thêm chức vụ</button>}
                    </div>

                    <div className="m-card p-4">
                        {showForm ? (<>
                            <div className="flex flex-wrap items-center gap-3 mb-4">
                                <h3 className="font-bold text-[14px]">{editing ? 'Sửa: ' + editing.name : 'Chức vụ mới'}</h3>
                                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên chức vụ *" disabled={!editable}
                                    className="border border-gray-300 rounded px-3 py-2 text-[13px] w-56" />
                                {editable && <button onClick={save} className="px-4 py-2 rounded bg-[#24305E] text-white text-[13px] font-medium ml-auto">Lưu phân quyền</button>}
                                <button onClick={closeForm} className="px-3 py-2 rounded border border-gray-300 text-[13px] text-gray-500">Hủy</button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-[13px] min-w-[520px]">
                                    <thead><tr className="text-left text-gray-500 border-b border-gray-100">
                                        <th className="py-2 font-medium">Module</th>
                                        {['view', 'create', 'edit', 'delete'].map((a) => <th key={a} className="py-2 font-medium text-center w-20">{ACTION_LABELS[a]}</th>)}
                                    </tr></thead>
                                    <tbody>
                                        {matrix.map((m) => (
                                            <tr key={m.key} className="border-b border-gray-50">
                                                <td className="py-2.5 font-medium">{m.label}</td>
                                                {['view', 'create', 'edit', 'delete'].map((a) => (
                                                    <td key={a} className="py-2.5 text-center">
                                                        {m.actions.includes(a)
                                                            ? <input type="checkbox" disabled={!editable} className="w-4 h-4 accent-[#24305E]"
                                                                checked={perms.includes('*') || perms.includes(m.key + '.' + a)}
                                                                onChange={() => togglePerm(m.key + '.' + a)} />
                                                            : <span className="text-gray-200">—</span>}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <label className="flex items-center gap-2 mt-3 text-[13px] font-medium">
                                <input type="checkbox" disabled={!editable} className="w-4 h-4 accent-[#24305E]"
                                    checked={perms.includes('*')} onChange={() => togglePerm('*')} />
                                Full quyền (quản lý)
                            </label>
                        </>) : <p className="text-gray-400 text-[13px]">Chọn một chức vụ để xem/sửa phân quyền.</p>}
                    </div>
                </div>
            </div>
        </AdminLayout>
    );
}
