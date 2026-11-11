import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import SearchInput from '../../components/SearchInput';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext'; // C3: trạng thái CN dùng chung
import { fmtDate, toApiDate } from '../../utils/format';
import DateInput from '../../components/DateInput';
import { API } from '../../utils/api';

const EMPTY = { full_name: '', dob: '', start_date: '', phone: '', email: '', education: '', qualification: '', username: '', password: '', pin_code: '', role_id: '', branch_id: '', branch_ids: [], is_active: true, apply_responsibility: true };

// Gói 26: Danh sách nhân viên (10 trường + PIN 6 số + chức vụ + chi nhánh).
// Gói 26c: 1 nhân viên gán được NHIỀU chi nhánh (chi nhánh chính + chi nhánh làm việc).
export default function Staff() {
    const { can } = useAuth();
    const [list, setList] = useState([]);
    const [roles, setRoles] = useState([]);
    const [branches, setBranches] = useState([]);
    const [search, setSearch] = useState('');
    // C3 (2026-10-21): bộ lọc CN = TRẠNG THÁI CHUNG BranchContext, đồng bộ 2 chiều với
    // dropdown sidebar (đổi trong trang = đổi trạng thái chung). '' tại trang này = '0' (Tất cả) ở context.
    const { branchId: ctxBranchId, setBranchId: setCtxBranchId } = useBranch();
    const branchId = ctxBranchId === '0' ? '' : ctxBranchId;
    const setBranchId = (v) => setCtxBranchId(v === '' || v === null || v === undefined ? '0' : String(v));
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY);
    const [creds, setCreds] = useState(null); // {pin, password} vừa tạo/cấp lại — chỉ hiện 1 lần (gói #102: thêm mật khẩu tạm)
    const [noPw, setNoPw] = useState(false); // Gói #102 mục 5.1: bộ lọc "Chưa có mật khẩu"
    const [savedMsg, setSavedMsg] = useState(''); // S10: thông báo thành công sau khi tạo NV (trước đây đóng form im lặng)

    const fetchAll = useCallback(async () => {
        const [e, r, b] = await Promise.all([
            axios.get(API + '/employees', { params: { search: search || undefined, branch_id: branchId || undefined, no_password: noPw ? 1 : undefined, per_page: 50 } }),
            axios.get(API + '/roles'), axios.get(API + '/branches'),
        ]);
        setList(e.data?.data?.data || e.data?.data || []);
        setRoles(r.data?.data || []);
        setBranches(b.data?.data || b.data || []);
    }, [search, branchId, noPw]);
    useEffect(() => { fetchAll(); }, [fetchAll]);

    if (!can('staff.employees.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Nhân viên.</div></AdminLayout>);
    const editable = can('staff.employees.edit');
    const inp = 'border border-gray-300 rounded px-3 py-2 text-[13px] w-full';
    const set = (k, v) => setForm({ ...form, [k]: v });

    const openAdd = () => { setEditing(null); setForm(EMPTY); setShowForm(true); };
    const openEdit = (emp) => {
        setEditing(emp);
        const bIds = emp.branches?.length ? emp.branches.map((b) => String(b.id)) : (emp.branch_id ? [String(emp.branch_id)] : []);
        setForm({
            // S10: KHÔNG slice(0,10) chuỗi thô — ngày từ API có thể kèm múi giờ (…T17:00:00Z)
            // khiến slice lệch 1 ngày so với danh sách (fmtDate đổi về giờ địa phương).
            // Chuẩn hóa qua toApiDate — cùng bộ parse với tầng hiển thị.
            full_name: emp.full_name || '', dob: toApiDate(emp.dob), start_date: toApiDate(emp.start_date),
            phone: emp.phone || '', email: emp.email || '', education: emp.education || '', qualification: emp.qualification || '',
            username: emp.username || '', password: '', pin_code: '', // PIN đã hash ở backend — không điền vào form
            role_id: emp.role_id ? String(emp.role_id) : '', branch_id: emp.branch_id ? String(emp.branch_id) : '',
            branch_ids: bIds, is_active: !!emp.is_active,
            apply_responsibility: emp.apply_responsibility !== false,
        });
        setShowForm(true);
    };
    // Gói 26c: đổi chi nhánh chính -> tự thêm vào danh sách làm việc
    const setPrimary = (id) => {
        const sid = String(id);
        const ids = sid && !form.branch_ids.includes(sid) ? [...form.branch_ids, sid] : form.branch_ids;
        setForm({ ...form, branch_id: id, branch_ids: ids });
    };
    // Gói 26c: tick/bỏ chi nhánh làm việc (chi nhánh chính luôn tick, khóa không cho bỏ)
    const toggleBranch = (id) => {
        const sid = String(id);
        if (sid === String(form.branch_id)) return;
        setForm({ ...form, branch_ids: form.branch_ids.includes(sid) ? form.branch_ids.filter((x) => x !== sid) : [...form.branch_ids, sid] });
    };
    const save = async () => {
        if (!form.full_name.trim() || !form.phone.trim() || !form.start_date || !form.branch_id) return alert('Nhập họ tên, SĐT, ngày vào làm, chi nhánh');
        try {
            const payload = { ...form, role_id: form.role_id || null, username: form.username || null, email: form.email || null, password: form.password || undefined, dob: form.dob || null, branch_ids: form.branch_ids.map((x) => parseInt(x, 10)).filter((x) => !isNaN(x)) };
            let r;
            if (editing) r = await axios.patch(API + '/employees/' + editing.id, payload);
            else r = await axios.post(API + '/employees', payload);
            const top = r?.data || {};
            setShowForm(false); fetchAll();
            // Backend trả pin_code_plain / password_plain ở cấp cao nhất khi vừa
            // đặt PIN/mật khẩu mới — hiện 1 lần duy nhất (gói #102: tạo NV luôn
            // kèm mật khẩu tạm tự sinh).
            if (top.pin_code_plain || top.password_plain) setCreds({ pin: top.pin_code_plain || null, password: top.password_plain || null });
            // S10: tạo mới mà không có thông tin đăng nhập hiện kèm → báo thành công rõ ràng (toast tại trang)
            else if (!editing) {
                setSavedMsg('Đã tạo nhân viên ' + form.full_name.trim() + '.');
                setTimeout(() => setSavedMsg(''), 4000);
            }
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại. Kiểm tra lại các ô bắt buộc rồi thử lại.'); }
    };
    const remove = async (id) => { if (!window.confirm('Xóa nhân viên này?')) return; try { await axios.delete(API + '/employees/' + id); fetchAll(); } catch (e) { alert('Xóa thất bại'); } };
    const resetPin = async (id) => {
        try {
            const r = await axios.post(API + '/employees/' + id + '/reset-pin');
            const d = r?.data?.data || r?.data || {};
            if (d.pin_code_plain) setCreds({ pin: d.pin_code_plain });
            else alert('Đã đặt lại PIN.');
            fetchAll();
        } catch (e) { alert(e.response?.data?.message || 'Đặt lại PIN thất bại'); }
    };
    // Gói #102 mục 4.3: cấp lại mật khẩu — server tự sinh mật khẩu tạm, hiện 1 lần
    const resetPassword = async (id) => {
        try {
            const r = await axios.post(API + '/employees/' + id + '/reset-password');
            const d = r?.data?.data || {};
            if (d.password_plain) setCreds({ password: d.password_plain });
            else alert('Đã cấp lại mật khẩu.');
            fetchAll();
        } catch (e) { alert(e.response?.data?.message || 'Cấp lại mật khẩu thất bại'); }
    };

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h1 className="text-xl font-bold">Nhân viên</h1>
                    <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} onSearch={(v) => setSearch(v)} placeholder="Tìm tên / SĐT / username" className="border border-gray-300 rounded px-3 py-2 text-[13px] w-56" />
                    <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-[13px]">
                        <option value="">Tất cả chi nhánh</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <label className="flex items-center gap-1.5 text-[13px] text-gray-600 cursor-pointer select-none">
                        <input type="checkbox" checked={noPw} onChange={(e) => setNoPw(e.target.checked)} className="accent-[#24305E]" />
                        Chưa có mật khẩu
                    </label>
                    {editable && <button onClick={openAdd} className="ml-auto px-4 py-2 rounded bg-[#24305E] text-white text-[13px] font-medium">+ Thêm nhân viên</button>}
                </div>
                {savedMsg && (
                    <div className="mb-3 px-4 py-2.5 rounded-lg bg-green-50 border border-green-200 text-green-700 text-[13px] font-medium">✓ {savedMsg}</div>
                )}
                <div className="m-card overflow-x-auto">
                    <table className="w-full text-[13px] min-w-[860px]">
                        <thead><tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50">
                            <th className="px-4 py-3 font-medium">Nhân viên</th><th className="px-3 py-3 font-medium">SĐT</th>
                            <th className="px-3 py-3 font-medium">Chức vụ</th><th className="px-3 py-3 font-medium">Chi nhánh</th>
                            <th className="px-3 py-3 font-medium text-center">PIN</th><th className="px-3 py-3 font-medium text-center">Trạng thái</th>
                            {editable && <th className="px-4 py-3 font-medium text-right">Thao tác</th>}
                        </tr></thead>
                        <tbody>
                            {list.map((e) => (
                                <tr key={e.id} className="border-b border-gray-50">
                                    <td className="px-4 py-3"><div className="font-medium">{e.full_name}</div><div className="text-gray-400 text-[12px]">{e.username ? '@' + e.username : 'chưa có TK đăng nhập'} · vào làm {fmtDate(e.start_date)}</div>{e.has_password === false && <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Chưa có mật khẩu</span>}{e.has_password !== false && e.must_change_password && <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">Đang giữ mật khẩu tạm</span>}</td>
                                    <td className="px-3 py-3">{e.phone}</td>
                                    <td className="px-3 py-3">{e.role?.name || '—'}</td>
                                    <td className="px-3 py-3">
                                        {(e.branches?.length ? e.branches : (e.branch ? [e.branch] : [])).map((b) => (
                                            <span key={b.id} className={`inline-block text-[11px] px-2 py-0.5 rounded-full mr-1 mb-0.5 ${String(b.id) === String(e.branch_id) ? 'bg-[#24305E] text-white font-medium' : 'bg-gray-100 text-gray-600'}`}>{b.name}</span>
                                        ))}
                                        {!(e.branches?.length || e.branch) && '—'}
                                    </td>
                                    <td className="px-3 py-3 text-center font-mono tracking-widest text-gray-400">••••••</td>
                                    <td className="px-3 py-3 text-center">{e.is_active ? <span className="text-green-600">Đang làm</span> : <span className="text-gray-400">Đã nghỉ</span>}</td>
                                    {editable && <td className="px-4 py-3 text-right whitespace-nowrap">
                                        <button onClick={() => openEdit(e)} className="text-[#24305E] mr-3">Sửa</button>
                                        <button onClick={() => resetPin(e.id)} className="text-orange-500 mr-3">Đổi PIN</button>
                                        <button onClick={() => resetPassword(e.id)} className="text-orange-500 mr-3">Cấp mật khẩu</button>
                                        <button onClick={() => remove(e.id)} className="text-red-500">Xóa</button>
                                    </td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {showForm && (
                    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
                        <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
                            <h2 className="font-bold text-[16px] mb-4">{editing ? 'Sửa nhân viên' : 'Thêm nhân viên'}</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div><label className="text-[12px] text-gray-500">Họ tên *</label><input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} className={inp} /></div>
                                <div><label className="text-[12px] text-gray-500">SĐT *</label><input value={form.phone} onChange={(e) => set('phone', e.target.value)} className={inp} /></div>
                                <div><label className="text-[12px] text-gray-500">Ngày sinh</label><DateInput value={form.dob} onChange={(v) => set('dob', v)} className={inp} /></div>
                                <div><label className="text-[12px] text-gray-500">Ngày vào làm *</label><DateInput value={form.start_date} onChange={(v) => set('start_date', v)} className={inp} /></div>
                                <div><label className="text-[12px] text-gray-500">Email</label><input value={form.email} onChange={(e) => set('email', e.target.value)} className={inp} /></div>
                                <div><label className="text-[12px] text-gray-500">Học vấn</label><input value={form.education} onChange={(e) => set('education', e.target.value)} placeholder="VD: 12/12, Cao đẳng..." className={inp} /></div>
                                <div><label className="text-[12px] text-gray-500">Trình độ</label><input value={form.qualification} onChange={(e) => set('qualification', e.target.value)} placeholder="VD: Barista, Kế toán..." className={inp} /></div>
                                <div><label className="text-[12px] text-gray-500">Chức vụ</label>
                                    <select value={form.role_id} onChange={(e) => set('role_id', e.target.value)} className={inp}><option value="">— Chưa gán —</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
                                <div><label className="text-[12px] text-gray-500">Chi nhánh chính *</label>
                                    <select value={form.branch_id} onChange={(e) => setPrimary(e.target.value)} className={inp}><option value="">— Chọn —</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
                                <div className="sm:col-span-2"><label className="text-[12px] text-gray-500">Chi nhánh làm việc (tích chọn — chi nhánh chính luôn được tick)</label>
                                    <div className="flex flex-wrap gap-2 mt-1.5">
                                        {branches.map((b) => {
                                            const sid = String(b.id);
                                            const checked = form.branch_ids.includes(sid);
                                            const isPrimary = sid === String(form.branch_id) && form.branch_id !== '';
                                            return (
                                                <label key={b.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] cursor-pointer ${checked ? 'border-[#24305E] bg-[#24305E]/5 text-[#24305E] font-medium' : 'border-gray-300 text-gray-500'}`}>
                                                    <input type="checkbox" checked={checked} disabled={isPrimary} onChange={() => toggleBranch(sid)} className="accent-[#24305E]" />
                                                    {b.name}{isPrimary && ' (chính)'}
                                                </label>
                                            );
                                        })}
                                    </div></div>
                                <div><label className="text-[12px] text-gray-500">Mã PIN 6 số (chấm công + POS/KDS)</label><input value={form.pin_code} onChange={(e) => set('pin_code', e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={editing ? 'Để trống = giữ nguyên' : 'Trống = tự sinh'} className={inp + ' font-mono tracking-widest'} /></div>
                                <div><label className="text-[12px] text-gray-500">Tên đăng nhập (admin)</label><input value={form.username} onChange={(e) => set('username', e.target.value)} className={inp} /></div>
                                {editing
                                    ? <div><label className="text-[12px] text-gray-500">Mật khẩu (trống = giữ nguyên · đặt mới tối thiểu 8 ký tự)</label><input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} className={inp} /></div>
                                    : <div><label className="text-[12px] text-gray-500">Mật khẩu đăng nhập Hub</label><div className="text-[12.5px] text-gray-500 border border-dashed border-gray-300 rounded px-3 py-2">Hệ thống tự sinh <b>mật khẩu tạm</b> và hiện 1 lần sau khi tạo — nhân viên phải đổi ở lần đăng nhập đầu.</div></div>}
                                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Đang làm việc</label>
                                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.apply_responsibility} onChange={(e) => set('apply_responsibility', e.target.checked)} /> Áp dụng lương trách nhiệm</label>
                            </div>
                            <div className="flex justify-end gap-2 mt-5">
                                <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded border border-gray-300 text-[13px]">Hủy</button>
                                <button onClick={save} className="px-4 py-2 rounded bg-[#24305E] text-white text-[13px] font-medium">Lưu</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Modal hiện thông tin đăng nhập mới — chỉ hiện 1 lần duy nhất sau khi tạo/cấp lại (gói #102: PIN + mật khẩu tạm) */}
                {creds && (
                    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setCreds(null)}>
                        <div className="bg-white rounded-xl w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="text-[15px] font-bold text-[#24305E] mb-1">Thông tin đăng nhập mới của nhân viên</div>
                            {creds.pin && (<>
                                <div className="text-[12px] text-gray-500 mt-4">PIN</div>
                                <div className="font-mono text-[34px] font-extrabold tracking-[10px] text-[#F5A623] my-1">{creds.pin}</div>
                            </>)}
                            {creds.password && (<>
                                <div className="text-[12px] text-gray-500 mt-4">Mật khẩu tạm (phải đổi ở lần đăng nhập đầu · hết hạn sau 72 giờ)</div>
                                <div className="font-mono text-[26px] font-extrabold tracking-[3px] text-[#24305E] my-1">{creds.password}</div>
                            </>)}
                            <p className="text-[13px] text-gray-500 mb-5">Hãy ghi lại cho nhân viên ngay —<br />thông tin này sẽ <b>không hiện lại</b> lần nữa.</p>
                            <button onClick={() => setCreds(null)} className="px-8 py-2.5 rounded bg-[#24305E] text-white text-[14px] font-semibold">Đã ghi lại</button>
                        </div>
                    </div>
                )}
            </div>
        </AdminLayout>
    );
}
