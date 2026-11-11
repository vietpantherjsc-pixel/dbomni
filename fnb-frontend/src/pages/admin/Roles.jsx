import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';
import { API } from '../../utils/api';

const ACTION_LABELS = { view: 'Xem', create: 'Thêm', edit: 'Sửa', delete: 'Xóa', approve: 'Duyệt', pay: 'Ghi thanh toán', adjust: 'Điều chỉnh', export: 'Xuất', bulk: 'Hàng loạt', discount: 'Giảm giá', points: 'Điểm', money: 'Tiền', config: 'Cấu hình', lock: 'Chốt khóa' };

// Cây phân quyền chi tiết (spec đã khóa 10/11/2026 §2/§2.0): ma trận vẽ theo
// cây backend cấp (GET /roles/matrix — 11 module · 47 mục con · lá
// module.muccon.hanhdong). Cụm lương (staff.salary.*) + settings.secrets là
// tier_only — CHỈ 2 tầng tài khoản, không có ô tick cho chức vụ. Khóa '*'
// bị cấm trong role (lưu sẽ 422).
export default function Roles() {
    const { can, isOwner } = useAuth();
    const [roles, setRoles] = useState([]);
    const [matrix, setMatrix] = useState([]);
    const [owners, setOwners] = useState(null);
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState('');
    const [perms, setPerms] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [loading, setLoading] = useState(true); // S10: lần mở đầu chưa tải xong phải hiện trạng thái tải, không hiện bảng rỗng
    const [collapsed, setCollapsed] = useState({});
    const [stripNote, setStripNote] = useState('');

    const fetchAll = async () => {
        try {
            setLoadError('');
            const [r, m] = await Promise.all([axios.get(API + '/roles'), axios.get(API + '/roles/matrix')]);
            setRoles(r.data?.data || []); setMatrix(m.data?.data || []);
        } catch (e) {
            setLoadError(e.response?.data?.message || 'Không tải được danh sách chức vụ. Kiểm tra backend/migrate.');
        } finally { setLoading(false); }
    };

    // Dải Chủ Sở Hữu ở đỉnh trang (§2.0): chỉ Chủ Sở Hữu xem được danh sách
    // tài khoản Owner — vai khác chỉ thấy dòng giải thích (không thao tác).
    useEffect(() => {
        if (!isOwner) return;
        axios.get(API + '/admin-accounts')
            .then((r) => setOwners((r.data?.data || []).filter((u) => u.account_tier === 'owner')))
            .catch(() => setOwners([]));
    }, [isOwner]);

    // Mọi lá trong cây (để đếm + nở wildcard).
    const allLeaves = () => matrix.flatMap((m) => (m.children || []).flatMap((c) => c.leaves || []));
    // Lá có được phủ bởi perms không (lá đúng / wildcard tiền tố / '*').
    const isCovered = (p, leaf) => {
        if (p.includes('*') || p.includes(leaf)) return true;
        return p.some((x) => x.endsWith('.*') && leaf.startsWith(x.slice(0, -1)));
    };
    // S10: đếm quyền theo DỮ LIỆU THẬT của ma trận — số lá mà vai này thực có.
    const countRealPerms = (r) => {
        const p = r.permissions || [];
        if (p.includes('*')) return allLeaves().length;
        return allLeaves().filter((leaf) => isCovered(p, leaf)).length;
    };
    useEffect(() => { fetchAll(); }, []);

    if (!can('staff.roles.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Nhân viên.</div></AdminLayout>);
    const editable = can('staff.roles.edit');

    // Nở wildcard đang phủ lá này thành từng lá (để bỏ tick 1 lá khi vai
    // đang mang wildcard module.* / muccon.*).
    const expandCovering = (leaf) => {
        let next = [...perms];
        next.filter((x) => x.endsWith('.*')).forEach((w) => {
            if (leaf.startsWith(w.slice(0, -1))) {
                next = next.filter((x) => x !== w);
                allLeaves().filter((l) => l.startsWith(w.slice(0, -1))).forEach((l) => { if (!next.includes(l)) next.push(l); });
            }
        });
        return next;
    };
    const togglePerm = (leaf) => {
        let next = expandCovering(leaf);
        setPerms(next.includes(leaf) ? next.filter((p) => p !== leaf) : [...next, leaf]);
    };
    const toggleChild = (child) => {
        const leaves = child.leaves || [];
        const allOn = leaves.length > 0 && leaves.every((l) => isCovered(perms, l));
        let next = [...perms];
        leaves.forEach((l) => { next = next.filter((x) => x !== l); });
        // Bỏ wildcard đang phủ các lá này để tick gộp không bị hiểu nhầm.
        next = next.filter((x) => !x.endsWith('.*') || !leaves.some((l) => l.startsWith(x.slice(0, -1))));
        if (!allOn) next = [...next, ...leaves.filter((l) => !next.includes(l))];
        setPerms(next);
    };
    const openAdd = () => { setEditing(null); setName(''); setPerms([]); setStripNote(''); setShowForm(true); };
    const openEdit = (r) => {
        setEditing(r); setName(r.name);
        // Lọc khóa không còn cấp qua chức vụ (lương/bí mật/'*') — backend sẽ
        // 422 nếu gửi kèm; hiện ghi chú để người sửa biết.
        const raw = r.permissions || [];
        const tierOnly = new Set(allLeaves().filter((l) => l.startsWith('staff.salary.') || l.startsWith('settings.secrets.')));
        const kept = raw.filter((p) => p !== '*' && !tierOnly.has(p) && !p.startsWith('staff.salary.') && !p.startsWith('settings.secrets'));
        setStripNote(raw.length !== kept.length ? 'Đã bỏ ' + (raw.length - kept.length) + ' khóa không còn cấp qua chức vụ (lương/bí mật/full quyền) — lưu để áp dụng.' : '');
        setPerms(kept); setShowForm(true);
    };
    const closeForm = () => { setEditing(null); setName(''); setPerms([]); setStripNote(''); setShowForm(false); };
    const save = async () => {
        if (!name.trim()) return alert('Nhập tên chức vụ');
        try {
            if (editing) await axios.patch(API + '/roles/' + editing.id, { name: name.trim(), permissions: perms });
            else await axios.post(API + '/roles', { name: name.trim(), permissions: perms });
            closeForm(); fetchAll();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };
    const remove = async (id) => { if (!window.confirm('Xóa chức vụ này?')) return; try { await axios.delete(API + '/roles/' + id); fetchAll(); } catch (e) { alert(e.response?.data?.message || 'Xóa thất bại'); } };

    const scopeLabel = (s) => s === 'branch' ? 'Theo CN' : 'Toàn hệ thống';

    return (
        <AdminLayout>
            <div className="p-5">
                <h1 className="text-xl font-bold mb-4">Chức vụ & phân quyền</h1>
                {/* Dải tầng Chủ Sở Hữu khóa ở đỉnh (§2.0): tài khoản quản trị viên
                    toàn quyền (kể cả lương mọi CN + tầng bí mật). Quản lý tài
                    khoản ở mục Tài khoản quản trị — không thao tác từ tầng chức vụ. */}
                <div className="m-card p-4 mb-4 border-l-4 border-l-[#24305E]">
                    <div className="font-bold text-[14px]">Tầng Chủ Sở Hữu — tài khoản quản trị viên (toàn quyền)</div>
                    <p className="text-[12px] text-gray-500 mt-1">Chủ Sở Hữu thấy + thao tác toàn bộ hệ thống, kể cả lương mọi chi nhánh và tầng bí mật. Chức vụ nhân viên không bao giờ chạm được lương/bí mật.</p>
                    {isOwner && owners !== null && owners.length > 0 && (
                        <div className="text-[12px] mt-2">{owners.map((o) => <span key={o.id} className="inline-block bg-gray-100 rounded px-2 py-1 mr-2 mb-1">{o.name} · {o.email}</span>)}</div>
                    )}
                    {isOwner && <a href="/admin/admin-accounts" className="inline-block mt-2 text-[13px] text-[#24305E] font-medium underline">Quản lý tài khoản quản trị →</a>}
                </div>
                <div className="grid lg:grid-cols-[280px_1fr] gap-4">
                    <div className="m-card p-4 h-fit">
                        <h3 className="font-bold mb-3 text-[14px]">Danh sách chức vụ</h3>
                        {loadError && <p className="text-red-500 text-[12px] mb-2">{loadError}</p>}
                        {loading && roles.length === 0 && <p className="text-gray-400 text-[12px] mb-2">Đang tải danh sách chức vụ…</p>}
                        {/* Đại Vương chốt 10/11/2026: danh sách xếp theo số quyền thật giảm dần, bằng điểm thì theo tên A→Z (bản sao đã sắp — không mutate state gốc). */}
                        {[...roles].sort((a, b) => (countRealPerms(b) - countRealPerms(a)) || a.name.localeCompare(b.name, 'vi')).map((r) => (
                            <div key={r.id} className={'flex items-center justify-between px-3 py-2.5 rounded-lg mb-1 ' + (editing?.id === r.id ? 'bg-[#24305E] text-white' : 'bg-gray-50')}>
                                <button onClick={() => openEdit(r)} className="text-left flex-1">
                                    <div className="font-medium text-[13px]">{r.name}</div>
                                    <div className={'text-[11px] ' + (editing?.id === r.id ? 'text-gray-300' : 'text-gray-400')}>{r.employees_count} nhân viên · {r.permissions?.includes('*') ? 'full quyền (khóa cũ)' : countRealPerms(r) + ' quyền'}</div>
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
                            {stripNote && <p className="text-amber-600 text-[12px] mb-3">{stripNote}</p>}
                            <div className="space-y-3">
                                {matrix.map((m) => (
                                    <div key={m.key} className="border border-gray-100 rounded-lg overflow-hidden">
                                        <button type="button" onClick={() => setCollapsed({ ...collapsed, [m.key]: !collapsed[m.key] })}
                                            className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 text-left">
                                            <span className="text-gray-400 text-[12px]">{collapsed[m.key] ? '▸' : '▾'}</span>
                                            <span className="font-bold text-[13px]">{m.label}</span>
                                            <span className="text-[11px] text-gray-400 ml-auto">{scopeLabel(m.scope)}</span>
                                        </button>
                                        {!collapsed[m.key] && (m.children || []).map((c) => (
                                            <div key={c.key} className="px-3 py-2.5 border-t border-gray-50">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-medium text-[13px]">{c.group ? c.group + ' — ' : ''}{c.label}</span>
                                                    <span className="text-[11px] text-gray-400">{scopeLabel(c.scope || m.scope)}</span>
                                                    {!c.tier_only && editable && (c.leaves || []).length > 1 && (
                                                        <button type="button" onClick={() => toggleChild(c)} className="text-[11px] text-[#24305E] underline ml-auto">
                                                            {(c.leaves || []).every((l) => isCovered(perms, l)) ? 'Bỏ hết' : 'Chọn hết'}
                                                        </button>
                                                    )}
                                                </div>
                                                {c.tier_only ? (
                                                    <p className="text-[12px] text-amber-600 mt-1">Chỉ 2 tầng tài khoản (Chủ Sở Hữu · Chủ Chi Nhánh) — không cấp qua chức vụ.</p>
                                                ) : (
                                                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                                                        {(c.leaves || []).map((leaf) => {
                                                            const act = leaf.split('.').pop();
                                                            return (
                                                                <label key={leaf} className="flex items-center gap-1.5 text-[12px] cursor-pointer min-h-[36px]" title={leaf}>
                                                                    <input type="checkbox" disabled={!editable} className="w-4 h-4 accent-[#24305E]"
                                                                        checked={isCovered(perms, leaf)}
                                                                        onChange={() => togglePerm(leaf)} />
                                                                    {ACTION_LABELS[act] || act}
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </>) : <p className="text-gray-400 text-[13px]">Chọn một chức vụ để xem/sửa phân quyền.</p>}
                    </div>
                </div>
            </div>
        </AdminLayout>
    );
}
