import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';
import TimeInput, { valid24 } from '../../components/TimeInput'; // Gói 36: dùng chung (thay bản tự chế Gói 35c)

const API = 'http://localhost/api';
const EMPTY = { name: '', branch_id: '', start_time: '', end_time: '', is_active: true };


// Gói 35: CRUD ca làm việc + kéo-thả đổi thứ tự (reorder) + bật/tắt trạng thái.
export default function WorkShifts() {
    const { can } = useAuth();
    const [list, setList] = useState([]);
    const [branches, setBranches] = useState([]);
    const [branchId, setBranchId] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY);
    const [dragIdx, setDragIdx] = useState(null);

    const fetchAll = useCallback(async () => {
        const [s, b] = await Promise.all([
            axios.get(API + '/work-shifts', { params: { branch_id: branchId || undefined } }),
            axios.get(API + '/branches'),
        ]);
        setList(s.data?.data || []);
        setBranches(b.data?.data || b.data || []);
    }, [branchId]);
    useEffect(() => { fetchAll(); }, [fetchAll]);

    if (!can('staff.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Chấm công.</div></AdminLayout>);
    const editable = can('staff.edit');
    const inp = 'border border-gray-300 rounded px-3 py-2 text-[13px] w-full';
    const set = (k, v) => setForm({ ...form, [k]: v });
    const branchName = (id) => branches.find((b) => String(b.id) === String(id))?.name;

    const openAdd = () => { setEditing(null); setForm(EMPTY); setShowForm(true); };
    const openEdit = (s) => {
        setEditing(s);
        setForm({
            name: s.name || '', branch_id: s.branch_id ? String(s.branch_id) : '',
            start_time: (s.start_time || '').slice(0, 5), end_time: (s.end_time || '').slice(0, 5),
            is_active: !!s.is_active,
        });
        setShowForm(true);
    };
    const save = async () => {
        if (!form.name.trim() || !valid24(form.start_time) || !valid24(form.end_time)) return alert('Nhập tên ca, giờ vào và giờ ra đúng định dạng 24h (VD: 07:00)');
        try {
            const payload = {
                name: form.name.trim(),
                branch_id: form.branch_id || null,
                start_time: String(form.start_time || '').slice(0, 5),
                end_time: String(form.end_time || '').slice(0, 5),
                is_active: form.is_active,
            };
            if (editing) await axios.put(API + '/work-shifts/' + editing.id, payload);
            else await axios.post(API + '/work-shifts', payload);
            setShowForm(false); fetchAll();
        } catch (e) { alert(e.response?.data?.message || JSON.stringify(e.response?.data?.errors) || 'Lưu thất bại'); }
    };
    const remove = async (id) => { if (!window.confirm('Xóa ca làm việc này?')) return; try { await axios.delete(API + '/work-shifts/' + id); fetchAll(); } catch (e) { alert('Xóa thất bại'); } };
    const toggleActive = async (s) => {
        try { await axios.put(API + '/work-shifts/' + s.id, { is_active: !s.is_active }); fetchAll(); }
        catch (e) { alert('Đổi trạng thái thất bại'); }
    };
    // Kéo-thả đổi thứ tự: thả -> gọi reorder với danh sách id theo thứ tự mới
    const onDrop = async (toIdx) => {
        if (dragIdx === null || dragIdx === toIdx) { setDragIdx(null); return; }
        const nl = [...list];
        const [moved] = nl.splice(dragIdx, 1);
        nl.splice(toIdx, 0, moved);
        setDragIdx(null);
        setList(nl);
        try { await axios.post(API + '/work-shifts/reorder', { ids: nl.map((x) => x.id) }); }
        catch (e) { alert('Lưu thứ tự thất bại'); fetchAll(); }
    };

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h1 className="text-xl font-bold">Ca làm việc</h1>
                    <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-[13px]">
                        <option value="">Tất cả chi nhánh</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    {editable && <button onClick={openAdd} className="ml-auto px-4 py-2 rounded bg-[#24305E] text-white text-[13px] font-medium">+ Thêm ca</button>}
                </div>
                <p className="text-[12px] text-gray-400 mb-2">Kéo-thả hàng để đổi thứ tự hiển thị ca (chỉ khi lọc theo 1 chi nhánh hoặc xem tất cả).</p>
                <div className="m-card overflow-x-auto">
                    <table className="w-full text-[13px] min-w-[640px]">
                        <thead><tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50">
                            <th className="px-3 py-3 font-medium w-10"></th>
                            <th className="px-3 py-3 font-medium">Tên ca</th>
                            <th className="px-3 py-3 font-medium">Giờ vào – ra</th>
                            <th className="px-3 py-3 font-medium">Chi nhánh</th>
                            <th className="px-3 py-3 font-medium text-center">Trạng thái</th>
                            {editable && <th className="px-4 py-3 font-medium text-right">Thao tác</th>}
                        </tr></thead>
                        <tbody>
                            {list.map((s, i) => (
                                <tr key={s.id}
                                    draggable={editable}
                                    onDragStart={() => setDragIdx(i)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={() => onDrop(i)}
                                    className={'border-b border-gray-50 ' + (editable ? 'cursor-move ' : '') + (dragIdx === i ? 'opacity-40' : '')}>
                                    <td className="px-3 py-3 text-gray-400 text-center select-none">⠿</td>
                                    <td className="px-3 py-3 font-medium">{s.name}</td>
                                    <td className="px-3 py-3 font-mono">{String(s.start_time || '').slice(0, 5)} – {String(s.end_time || '').slice(0, 5)}</td>
                                    <td className="px-3 py-3">{s.branch_id ? branchName(s.branch_id) : <span className="text-gray-400">Chung (tất cả CN)</span>}</td>
                                    <td className="px-3 py-3 text-center">
                                        <button disabled={!editable} onClick={() => toggleActive(s)} title={editable ? 'Bấm để bật/tắt' : ''}
                                            className={'text-[11px] px-2.5 py-1 rounded-full font-medium ' + (s.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500')}>
                                            {s.is_active ? 'Đang hoạt động' : 'Đã tắt'}
                                        </button>
                                    </td>
                                    {editable && <td className="px-4 py-3 text-right whitespace-nowrap">
                                        <button onClick={() => openEdit(s)} className="text-[#0d6efd] mr-3">Sửa</button>
                                        <button onClick={() => remove(s.id)} className="text-red-500">Xóa</button>
                                    </td>}
                                </tr>
                            ))}
                            {list.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Chưa có ca làm việc nào.</td></tr>}
                        </tbody>
                    </table>
                </div>

                {showForm && (
                    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
                        <div className="bg-white rounded-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                            <h2 className="font-bold text-[16px] mb-4">{editing ? 'Sửa ca làm việc' : 'Thêm ca làm việc'}</h2>
                            <div className="grid grid-cols-1 gap-3">
                                <div><label className="text-[12px] text-gray-500">Tên ca *</label><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="VD: Ca sáng, Ca tối" className={inp} /></div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div><label className="text-[12px] text-gray-500">Giờ vào *</label><TimeInput value={form.start_time} onChange={(v) => set('start_time', v)} className={inp} /></div>
                                    <div><label className="text-[12px] text-gray-500">Giờ ra *</label><TimeInput value={form.end_time} onChange={(v) => set('end_time', v)} className={inp} /></div>
                                </div>
                                <div><label className="text-[12px] text-gray-500">Chi nhánh (trống = dùng chung tất cả CN)</label>
                                    <select value={form.branch_id} onChange={(e) => set('branch_id', e.target.value)} className={inp}>
                                        <option value="">— Chung —</option>
                                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                    </select></div>
                                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="accent-[#24305E]" /> Đang hoạt động</label>
                            </div>
                            <div className="flex justify-end gap-2 mt-5">
                                <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded border border-gray-300 text-[13px]">Hủy</button>
                                <button onClick={save} className="px-4 py-2 rounded bg-[#24305E] text-white text-[13px] font-medium">Lưu</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </AdminLayout>
    );
}
