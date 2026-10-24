import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';

// Nhóm đơn vị (phục vụ lọc khi nhập kho & chế biến) — hằng số dùng chung 1 chỗ
export const UNIT_GROUPS = [
    { code: 'count', name: 'Đếm' },
    { code: 'mass', name: 'Khối lượng' },
    { code: 'volume', name: 'Thể tích' },
    { code: 'other', name: 'Khác' },
];
const groupName = (code) => UNIT_GROUPS.find((g) => g.code === code)?.name || 'Đếm';

// Gói 52: quản lý đơn vị tính dùng chung toàn hệ thống
// Spec cài đặt danh sách (2026-10-21): chuyển từ chip thành BẢNG có cột (L1) + form trong MODAL.
export default function UnitManager() {
    const [items, setItems] = useState([]);
    const [form, setForm] = useState({ name: '', group: 'count', is_active: true });
    const [editing, setEditing] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [dragIdx, setDragIdx] = useState(null);

    const load = () => axios.get(`${API}/units?all=1`).then((r) => setItems(r.data?.data || [])).catch(() => {});
    useEffect(() => { load(); }, []);

    const emptyForm = () => ({ name: '', group: 'count', is_active: true });
    const openAdd = () => { setEditing(null); setForm(emptyForm()); setModalOpen(true); };
    const openEdit = (u) => {
        setEditing(u.id);
        setForm({ name: u.name, group: u.group || 'count', is_active: !!u.is_active });
        setModalOpen(true);
    };
    const closeModal = () => { setModalOpen(false); setEditing(null); setForm(emptyForm()); };

    const save = async () => {
        if (!form.name.trim()) { alert('Nhập tên đơn vị'); return; }
        try {
            const payload = { name: form.name.trim(), group: form.group, is_active: !!form.is_active };
            if (editing) await axios.put(`${API}/units/${editing}`, payload);
            else await axios.post(`${API}/units`, payload);
            closeModal();
            load();
        } catch (e) { alert(e.response?.data?.message || 'Lỗi'); }
    };

    const toggleActive = async (u) => {
        await axios.put(`${API}/units/${u.id}`, { is_active: !u.is_active }).catch(() => {});
        load();
    };

    const remove = async (id) => {
        if (!confirm('Xóa đơn vị này?')) return;
        try {
            await axios.delete(`${API}/units/${id}`);
            load();
        } catch (e) { alert(e.response?.data?.message || 'Lỗi'); }
    };

    // Kéo-thả sắp xếp (cùng cơ chế PTTT)
    const onDragStart = (idx) => setDragIdx(idx);
    const onDragOver = (e, idx) => {
        e.preventDefault();
        if (dragIdx === null || dragIdx === idx) return;
        const next = [...items];
        const [moved] = next.splice(dragIdx, 1);
        next.splice(idx, 0, moved);
        setItems(next);
        setDragIdx(idx);
    };
    const onDragEnd = async () => {
        setDragIdx(null);
        for (let i = 0; i < items.length; i++) {
            await axios.put(`${API}/units/${items[i].id}`, { sort_order: i }).catch(() => {});
        }
    };

    return (
        <div>
            <div className="flex justify-end mb-3">
                <button onClick={openAdd} className="m-btn m-btn-primary text-[13px]">+ Thêm đơn vị</button>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[560px]">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-100">
                            <th className="py-2 pr-2 font-medium w-10">Thứ tự</th>
                            <th className="py-2 pr-3 font-medium">Tên</th>
                            <th className="py-2 pr-3 font-medium">Nhóm</th>
                            <th className="py-2 pr-3 font-medium">Trạng thái</th>
                            <th className="py-2 font-medium text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 && (
                            <tr><td colSpan={5} className="py-4 text-center text-gray-400">Chưa có đơn vị nào.</td></tr>
                        )}
                        {items.map((u, idx) => (
                            <tr key={u.id}
                                draggable
                                onDragStart={() => onDragStart(idx)}
                                onDragOver={(e) => onDragOver(e, idx)}
                                onDragEnd={onDragEnd}
                                className="border-b border-gray-50"
                                style={{ opacity: dragIdx === idx ? 0.5 : 1, background: dragIdx === idx ? '#f0f4ff' : 'transparent' }}>
                                <td className="py-2.5 pr-2">
                                    <span style={{ cursor: 'grab', color: '#999', fontSize: 16 }} title="Kéo để sắp xếp">⋮⋮</span>
                                </td>
                                <td className="py-2.5 pr-3 font-medium">{u.name}</td>
                                <td className="py-2.5 pr-3">
                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{groupName(u.group)}</span>
                                </td>
                                <td className="py-2.5 pr-3">
                                    <button type="button" onClick={() => toggleActive(u)} title={u.is_active ? 'Đang bật — bấm để tắt' : 'Đang tắt — bấm để bật'}
                                        className="relative inline-flex rounded-full transition-colors align-middle"
                                        style={{ background: u.is_active ? '#22c55e' : '#d1d5db', width: 40, height: 22 }}>
                                        <span className="absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all"
                                            style={{ left: u.is_active ? 20 : 2 }} />
                                    </button>
                                    <span className="ml-2 text-[12px] text-gray-500">{u.is_active ? 'Bật' : 'Tắt'}</span>
                                </td>
                                <td className="py-2.5 text-right whitespace-nowrap">
                                    <button onClick={() => openEdit(u)} className="text-blue-600 text-[12px] mr-3">Sửa</button>
                                    <button onClick={() => remove(u.id)} className="text-red-600 text-[12px]">Xóa</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="text-[12px] text-gray-400 mt-2">Đơn vị đã tắt không xuất hiện ở nơi chọn đơn vị (nhập kho, nhân viên). Đơn vị đang được dùng sẽ không xóa được — hãy tắt thay vì xóa.</div>

            {modalOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
                    <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-[15px]">{editing ? 'Sửa đơn vị tính' : 'Thêm đơn vị tính'}</h3>
                            <button onClick={closeModal} className="w-8 h-8 rounded-full bg-gray-100 text-gray-500">✕</button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="text-[12px] font-medium text-gray-500">Tên đơn vị *</label>
                                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder="VD: Phần, Cái, Kg..." className="m-input w-full mt-1" autoFocus
                                    onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
                            </div>
                            <div>
                                <label className="text-[12px] font-medium text-gray-500">Nhóm</label>
                                <select value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} className="m-input w-full mt-1">
                                    {UNIT_GROUPS.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
                                </select>
                            </div>
                            <label className="flex items-center gap-2 text-[13px]">
                                <input type="checkbox" checked={!!form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4" />
                                Đang bật (hiện ở nơi chọn đơn vị)
                            </label>
                        </div>
                        <div className="flex justify-end gap-2 mt-5">
                            <button onClick={closeModal} className="px-4 py-2 rounded-lg border border-gray-200 text-[13px]">Hủy</button>
                            <button onClick={save} className="m-btn m-btn-primary text-[13px]">{editing ? 'Lưu thay đổi' : 'Thêm mới'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
