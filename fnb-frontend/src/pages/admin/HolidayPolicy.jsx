import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';
import { fmtDate } from '../../utils/format';
import DateInput from '../../components/DateInput';
import { API } from '../../utils/api';

const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0));
const VIOL_CATS = [
    ['chuyen_can', 'Chuyên Cần'],
    ['chuyen_mon', 'Chuyên Môn'],
    ['chuyen_nghiep', 'Chuyên Nghiệp'],
];
const violCatName = (c, fallback) => (VIOL_CATS.find(([k]) => k === c)?.[1]) || fallback || c;

// Gói 30: Chính sách lương lễ/tết + lương trách nhiệm theo vi phạm (chung toàn chuỗi).
// Gói 54: đổi tên thành "Cấu hình Lương", thêm mục BHXH (chuyển từ Thiết lập sang).
export default function HolidayPolicy() {
    const { can } = useAuth();
    const [pol, setPol] = useState({ resp_base_per_hour: 2000, resp_deduction_per_violation: 500, resp_max_violations: 4, meal_price: 30000, meal_min_hours: 14.5, bhxh_emp_bhxh: 8, bhxh_emp_bhyt: 1.5, bhxh_emp_bhtn: 1, bhxh_employer_rate: 21.5 });
    const [holidays, setHolidays] = useState([]);
    const [form, setForm] = useState({ date: '', name: '', multiplier: 2 });
    const [editing, setEditing] = useState(null);
    // Gói 40: danh mục lỗi vi phạm 3 Chuyên
    const [types, setTypes] = useState([]);
    const [typeForm, setTypeForm] = useState({ category: 'chuyen_can', name: '', default_points: 1 });
    const [editingType, setEditingType] = useState(null);

    const fetchAll = async () => {
        try {
            const [p, h, t] = await Promise.all([axios.get(API + '/salary-policies'), axios.get(API + '/holidays'), axios.get(API + '/violation-types')]);
            if (p.data?.success) setPol(p.data.data);
            if (h.data?.success) setHolidays(h.data.data || []);
            if (t.data?.success) setTypes(t.data.data || []);
        } catch (e) { alert(e.response?.data?.message || 'Tải dữ liệu thất bại'); }
    };
    useEffect(() => { fetchAll(); }, []);

    if (!can('staff.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Nhân viên.</div></AdminLayout>);
    const editable = can('staff.edit');
    const canEditTypes = can('settings.edit'); // Gói 40: danh mục lỗi thuộc quyền settings.edit
    const inp = 'border border-gray-300 rounded px-2 py-1.5 text-[13px] w-full';
    const btn = 'px-3 py-1.5 rounded text-[13px] font-medium ';

    const savePol = async () => {
        try {
            await axios.put(API + '/salary-policies', {
                resp_base_per_hour: Number(pol.resp_base_per_hour) || 0,
                resp_deduction_per_violation: Number(pol.resp_deduction_per_violation) || 0,
                resp_max_violations: Number(pol.resp_max_violations) || 0,
                meal_price: Number(pol.meal_price) || 0,
                meal_min_hours: Number(pol.meal_min_hours) || 0,
                bhxh_emp_bhxh: Number(pol.bhxh_emp_bhxh) || 0,
                bhxh_emp_bhyt: Number(pol.bhxh_emp_bhyt) || 0,
                bhxh_emp_bhtn: Number(pol.bhxh_emp_bhtn) || 0,
                bhxh_employer_rate: Number(pol.bhxh_employer_rate) || 0,
            });
            alert('Đã lưu chính sách.');
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };

    const openAdd = () => { setEditing(null); setForm({ date: '', name: '', multiplier: 2 }); };
    const openEdit = (h) => { setEditing(h); setForm({ date: h.date?.slice(0, 10) || '', name: h.name || '', multiplier: h.multiplier ?? 2 }); };
    const saveHoliday = async () => {
        if (!form.date || !form.name.trim()) return alert('Nhập ngày và tên ngày lễ');
        try {
            if (editing) await axios.patch(API + '/holidays/' + editing.id, { date: form.date, name: form.name.trim(), multiplier: Number(form.multiplier) || 2 });
            else await axios.post(API + '/holidays', { date: form.date, name: form.name.trim(), multiplier: Number(form.multiplier) || 2 });
            openAdd(); fetchAll();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };
    const delHoliday = async (id) => {
        if (!window.confirm('Xóa ngày lễ này?')) return;
        try { await axios.delete(API + '/holidays/' + id); fetchAll(); }
        catch (e) { alert(e.response?.data?.message || 'Xóa thất bại'); }
    };

    // Gói 40: CRUD danh mục lỗi vi phạm
    const openAddType = () => { setEditingType(null); setTypeForm({ category: 'chuyen_can', name: '', default_points: 1 }); };
    const openEditType = (t) => { setEditingType(t); setTypeForm({ category: t.category, name: t.name || '', default_points: t.default_points ?? 1 }); };
    const saveType = async () => {
        if (!typeForm.name.trim()) return alert('Nhập tên lỗi vi phạm');
        try {
            const body = { category: typeForm.category, name: typeForm.name.trim(), default_points: Number(typeForm.default_points) || 1 };
            if (editingType) await axios.put(API + '/violation-types/' + editingType.id, body);
            else await axios.post(API + '/violation-types', body);
            openAddType(); fetchAll();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };
    const delType = async (id) => {
        if (!window.confirm('Xóa loại lỗi này? Các lỗi đã ghi nhận giữ nguyên tên.')) return;
        try { await axios.delete(API + '/violation-types/' + id); fetchAll(); }
        catch (e) { alert(e.response?.data?.message || 'Xóa thất bại'); }
    };

    const eff = Math.max(0, Number(pol.resp_base_per_hour) - Math.min(2, Number(pol.resp_max_violations)) * Number(pol.resp_deduction_per_violation));

    return (
        <AdminLayout>
            <div className="p-5">
                <h1 className="text-xl font-bold mb-4">Cấu hình Lương</h1>
                <div className="grid lg:grid-cols-2 gap-4 items-start">
                    <div className="m-card p-4">
                        <h3 className="font-bold mb-1">Chính sách lương trách nhiệm</h3>
                        <p className="text-[12px] text-gray-500 mb-3">Áp dụng chung cho toàn bộ nhân viên. Đơn giá giờ/ngày = lương cơ bản/h + lương trách nhiệm hiệu dụng.</p>
                        <div className="grid grid-cols-3 gap-2">
                            <label className="text-[12px] text-gray-500">Mức lương trách nhiệm/h (đ)
                                <input disabled={!editable} type="number" min="0" value={pol.resp_base_per_hour} onChange={(e) => setPol({ ...pol, resp_base_per_hour: e.target.value })} className={inp + ' mt-1'} /></label>
                            <label className="text-[12px] text-gray-500">Trừ mỗi lỗi (đ/h)
                                <input disabled={!editable} type="number" min="0" value={pol.resp_deduction_per_violation} onChange={(e) => setPol({ ...pol, resp_deduction_per_violation: e.target.value })} className={inp + ' mt-1'} /></label>
                            <label className="text-[12px] text-gray-500">Tối đa lỗi/tháng
                                <input disabled={!editable} type="number" min="0" value={pol.resp_max_violations} onChange={(e) => setPol({ ...pol, resp_max_violations: e.target.value })} className={inp + ' mt-1'} /></label>
                        </div>
                        <p className="text-[12.5px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mt-3">
                            VD: {fmt(pol.resp_base_per_hour)} − 2×{fmt(pol.resp_deduction_per_violation)} = <b>{fmt(eff)}đ/h</b> (NV vi phạm 2 lỗi).
                            Quá {pol.resp_max_violations} lỗi/tháng chỉ trừ tối đa {pol.resp_max_violations} lỗi.
                        </p>
                        {editable && <button onClick={savePol} className={btn + 'bg-[#24305E] text-white mt-3'}>Lưu chính sách</button>}
                    </div>
                    <div className="m-card p-4">
                        <h3 className="font-bold mb-1">Chính sách suất ăn</h3>
                        <p className="text-[12px] text-gray-500 mb-3">Ngày nào tổng giờ làm ≥ ngưỡng → hệ thống tự tính 1 suất. Có thể chỉnh tay từng ngày khi tính lương.</p>
                        <div className="grid grid-cols-2 gap-2">
                            <label className="text-[12px] text-gray-500">Mức tiền 1 suất ăn (đ)
                                <input disabled={!editable} type="number" min="0" value={pol.meal_price} onChange={(e) => setPol({ ...pol, meal_price: e.target.value })} className={inp + ' mt-1'} /></label>
                            <label className="text-[12px] text-gray-500">Ngưỡng giờ/ngày (giờ)
                                <input disabled={!editable} type="number" step="0.5" min="0" max="24" value={pol.meal_min_hours} onChange={(e) => setPol({ ...pol, meal_min_hours: e.target.value })} className={inp + ' mt-1'} /></label>
                        </div>
                        <p className="text-[12.5px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mt-3">
                            VD: {fmt(pol.meal_price)}đ/suất — ngày làm {pol.meal_min_hours}h trở lên tự cộng 1 suất vào phụ cấp tiền ăn.
                        </p>
                        {editable && <button onClick={savePol} className={btn + 'bg-[#24305E] text-white mt-3'}>Lưu chính sách</button>}
                    </div>
                    {/* Gói 54: BHXH — chuyển từ Thiết lập sang đây */}
                    <div className="m-card p-4">
                        <h3 className="font-bold mb-1">Bảo hiểm xã hội (BHXH)</h3>
                        <p className="text-[12px] text-gray-500 mb-3">Tỷ lệ đóng của người lao động và doanh nghiệp. Áp dụng khi tính bảng lương.</p>
                        <div className="grid grid-cols-2 gap-2">
                            <label className="text-[12px] text-gray-500">BHXH NLĐ đóng (%)
                                <input disabled={!editable} type="number" step="0.1" min="0" max="100" value={pol.bhxh_emp_bhxh} onChange={(e) => setPol({ ...pol, bhxh_emp_bhxh: e.target.value })} className={inp + ' mt-1'} /></label>
                            <label className="text-[12px] text-gray-500">BHYT NLĐ đóng (%)
                                <input disabled={!editable} type="number" step="0.1" min="0" max="100" value={pol.bhxh_emp_bhyt} onChange={(e) => setPol({ ...pol, bhxh_emp_bhyt: e.target.value })} className={inp + ' mt-1'} /></label>
                            <label className="text-[12px] text-gray-500">BHTN NLĐ đóng (%)
                                <input disabled={!editable} type="number" step="0.1" min="0" max="100" value={pol.bhxh_emp_bhtn} onChange={(e) => setPol({ ...pol, bhxh_emp_bhtn: e.target.value })} className={inp + ' mt-1'} /></label>
                            <label className="text-[12px] text-gray-500">DN đóng (%)
                                <input disabled={!editable} type="number" step="0.1" min="0" max="100" value={pol.bhxh_employer_rate} onChange={(e) => setPol({ ...pol, bhxh_employer_rate: e.target.value })} className={inp + ' mt-1'} /></label>
                        </div>
                        {editable && <button onClick={savePol} className={btn + 'bg-[#24305E] text-white mt-3'}>Lưu chính sách</button>}
                    </div>
                    <div className="m-card p-4">
                        <h3 className="font-bold mb-1">Ngày lễ, Tết</h3>
                        <p className="text-[12px] text-gray-500 mb-3">Ai đi làm ngày lễ được nhân hệ số. Bảng lương đánh dấu ngày áp dụng hệ số.</p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px] min-w-[420px]">
                                <thead><tr className="text-left text-gray-500 border-b border-gray-100">
                                    <th className="py-2 font-medium">Ngày</th><th className="py-2 font-medium">Tên</th>
                                    <th className="py-2 font-medium text-center">Hệ số</th>{editable && <th className="py-2"></th>}
                                </tr></thead>
                                <tbody>
                                    {holidays.map((h) => (
                                        <tr key={h.id} className="border-b border-gray-50">
                                            <td className="py-2.5">{fmtDate(h.date)}</td>
                                            <td className="py-2.5 font-medium">{h.name}</td>
                                            <td className="py-2.5 text-center"><span className="inline-block bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5 text-[11px] font-bold">x{h.multiplier}</span></td>
                                            {editable && <td className="py-2.5 text-right whitespace-nowrap">
                                                <button onClick={() => openEdit(h)} className="text-[#0d6efd] text-[12px] mr-3">Sửa</button>
                                                <button onClick={() => delHoliday(h.id)} className="text-red-500 text-[12px]">Xóa</button>
                                            </td>}
                                        </tr>
                                    ))}
                                    {holidays.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-gray-400">Chưa có ngày lễ nào.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                        {editable && (
                            <div className="mt-3">
                                <h4 className="text-[13px] font-bold mb-2">{editing ? 'Sửa ngày lễ' : 'Thêm ngày lễ'}</h4>
                                <div className="grid grid-cols-2 gap-2">
                                    <DateInput value={form.date} onChange={(v) => setForm({ ...form, date: v })} className={inp} />
                                    <input placeholder="Tên ngày lễ *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} />
                                    <input type="number" step="0.5" min="1" max="10" value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: e.target.value })} className={inp} title="Hệ số nhân lương" />
                                    <div className="flex gap-2">
                                        <button onClick={saveHoliday} className={btn + 'bg-[#24305E] text-white flex-1'}>{editing ? 'Cập nhật' : 'Thêm'}</button>
                                        {editing && <button onClick={openAdd} className={btn + 'border border-gray-300'}>Hủy</button>}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    {/* Gói 40: Danh mục lỗi vi phạm 3 Chuyên */}
                    <div className="m-card p-4 lg:col-span-2">
                        <h3 className="font-bold mb-1">Danh mục lỗi vi phạm 3 Chuyên</h3>
                        <p className="text-[12px] text-gray-500 mb-3">Số lỗi mặc định tự điền khi ghi nhận — vẫn sửa tay được từng lần. {!canEditTypes && 'Bạn không có quyền settings.edit nên chỉ xem.'}</p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px] min-w-[520px]">
                                <thead><tr className="text-left text-gray-500 border-b border-gray-100">
                                    <th className="py-2 font-medium">Nhóm</th><th className="py-2 font-medium">Tên lỗi vi phạm</th>
                                    <th className="py-2 font-medium text-center">Mặc định (lỗi)</th>{canEditTypes && <th className="py-2"></th>}
                                </tr></thead>
                                <tbody>
                                    {VIOL_CATS.map(([ck, cn]) => (
                                        <React.Fragment key={ck}>
                                            <tr><td colSpan={canEditTypes ? 4 : 3} className="py-2 font-bold text-[#24305E] bg-gray-50 px-2">{cn}</td></tr>
                                            {types.filter((t) => t.category === ck).map((t) => (
                                                <tr key={t.id} className="border-b border-gray-50">
                                                    <td className="py-2"></td>
                                                    <td className="py-2 font-medium">{t.name}{t.is_active === false && <span className="ml-2 text-[11px] text-gray-400">(đã ẩn)</span>}</td>
                                                    <td className="py-2 text-center font-bold text-[#24305E]">{t.default_points}</td>
                                                    {canEditTypes && <td className="py-2 text-right whitespace-nowrap">
                                                        <button onClick={() => openEditType(t)} className="text-[#0d6efd] text-[12px] mr-3">Sửa</button>
                                                        <button onClick={() => delType(t.id)} className="text-red-500 text-[12px]">Xóa</button>
                                                    </td>}
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                    {types.length === 0 && <tr><td colSpan={canEditTypes ? 4 : 3} className="py-6 text-center text-gray-400">Chưa có loại lỗi nào.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                        {canEditTypes && (
                            <div className="mt-3">
                                <h4 className="text-[13px] font-bold mb-2">{editingType ? 'Sửa loại lỗi' : 'Thêm loại lỗi'}</h4>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    <select value={typeForm.category} onChange={(e) => setTypeForm({ ...typeForm, category: e.target.value })} className={inp}>
                                        {VIOL_CATS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                                    </select>
                                    <input placeholder="Tên lỗi vi phạm *" value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} className={inp + ' md:col-span-2'} />
                                    <input type="number" min="1" value={typeForm.default_points} onChange={(e) => setTypeForm({ ...typeForm, default_points: e.target.value })} className={inp} title="Số lỗi mặc định" />
                                    <div className="flex gap-2 col-span-2 md:col-span-4">
                                        <button onClick={saveType} className={btn + 'bg-[#24305E] text-white'}>{editingType ? 'Cập nhật' : '＋ Thêm lỗi'}</button>
                                        {editingType && <button onClick={openAddType} className={btn + 'border border-gray-300'}>Hủy</button>}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </AdminLayout>
    );
}
