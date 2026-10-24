import React, { useState, useEffect, useCallback } from 'react';
import { rdGet, rdPost, rdPut, rdDelete } from './rdApi';
import { useBranch } from '../../contexts/BranchContext'; // C3: trạng thái CN dùng chung

// SPEC R&D — Tab 2: Chi phí cố định/tháng theo phạm vi (1 chi nhánh hoặc toàn hệ thống).
// 3 khoản tự động (lương TB 3 tháng · mặt bằng từ CPTT · điện nước TB 3 tháng) + dòng nhập tay.
// Sửa tay trên dòng tự động → ghi đè, ngừng tự cập nhật; có nút lấy lại số tự động.
const fmt = (n) => `${Math.round(Number(n || 0)).toLocaleString('vi-VN')}đ`;
const SRC = {
  manual: { label: 'Nhập tay', cls: 'm-badge-gray' },
  auto_salary: { label: 'Tự động — Lương', cls: 'm-badge-blue' },
  auto_rent: { label: 'Tự động — Mặt bằng', cls: 'm-badge-blue' },
  auto_utilities: { label: 'Tự động — Điện nước', cls: 'm-badge-blue' },
};

export default function RdFixedCosts({ meta }) {
  // C3 (2026-10-21): phạm vi CN = TRẠNG THÁI CHUNG BranchContext, đồng bộ 2 chiều với
  // dropdown sidebar ('' tại tab này = '0' — Toàn hệ thống — ở context).
  const { branchId: ctxBranchId, setBranchId: setCtxBranchId } = useBranch();
  const branchId = ctxBranchId === '0' ? '' : ctxBranchId;
  const setBranchId = (v) => setCtxBranchId(v === '' || v === null || v === undefined ? '0' : String(v));
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [utilCat, setUtilCat] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', amount: '' });
  const [editRow, setEditRow] = useState(null); // {id, name, amount}

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await rdGet(`/rd/fixed-costs`, { params: { branch_id: branchId || undefined } });
      setRows(res.data?.data?.rows || []);
      setTotal(res.data?.data?.total || 0);
      setUtilCat(res.data?.data?.utilities_category_id || '');
    } catch (e) { alert(e.response?.data?.message || 'Không tải được chi phí cố định.'); }
    finally { setLoading(false); }
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const addRow = async () => {
    if (!form.name.trim() || !(Number(form.amount) >= 0)) { alert('Nhập tên khoản và số tiền.'); return; }
    try {
      await rdPost(`/rd/fixed-costs`, {
        branch_id: branchId ? Number(branchId) : null,
        name: form.name.trim(), amount: Number(form.amount),
      });
      setForm({ name: '', amount: '' });
      load();
    } catch (e) { alert(e.response?.data?.message || 'Không thêm được khoản.'); }
  };

  const saveEdit = async () => {
    try {
      await rdPut(`/rd/fixed-costs/${editRow.id}`, { name: editRow.name, amount: Number(editRow.amount) });
      setEditRow(null);
      load();
    } catch (e) { alert(e.response?.data?.message || 'Không lưu được.'); }
  };

  const resetAuto = async (row) => {
    if (!confirm(`Lấy lại số tự động cho "${row.name}"? Số đã sửa tay sẽ bị thay bằng số hệ thống tính.`)) return;
    try {
      await rdPut(`/rd/fixed-costs/${row.id}`, { reset_auto: true });
      load();
    } catch (e) { alert(e.response?.data?.message || 'Không lấy lại được số tự động.'); }
  };

  const remove = async (row) => {
    if (!confirm(`Xóa khoản "${row.name}"?`)) return;
    try { await rdDelete(`/rd/fixed-costs/${row.id}`); load(); }
    catch (e) { alert(e.response?.data?.message || 'Không xóa được.'); }
  };

  const changeUtilCat = async (id) => {
    try {
      await rdPut(`/rd/utilities-category`, { category_id: Number(id) });
      setUtilCat(id);
      load();
    } catch (e) { alert(e.response?.data?.message || 'Không đổi được danh mục.'); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm font-semibold">Phạm vi:</span>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="m-input" style={{ width: 200 }}>
          <option value="">Toàn hệ thống</option>
          {meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <span className="text-xs" style={{ color: 'var(--m-ink-faint)' }}>
          Mỗi phạm vi có bộ chi phí riêng — tổng ở đây nuôi Tab Hòa vốn của đúng phạm vi đó.
        </span>
        <div className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
          <span className="text-xs" style={{ color: 'var(--m-ink-soft)' }}>Danh mục chi cho Điện nước:</span>
          <select value={utilCat} onChange={(e) => changeUtilCat(e.target.value)} className="m-input" style={{ width: 190 }}>
            <option value="">— Chưa chọn —</option>
            {meta.expense_categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className="m-card overflow-x-auto">
        <table className="m-table min-w-[760px]">
          <thead>
            <tr><th>Khoản chi</th><th>Nguồn</th><th className="text-right">Số tiền/tháng</th><th className="text-right">Thao tác</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.name}</td>
                <td>
                  <span className={`m-badge ${SRC[r.source]?.cls || 'm-badge-gray'}`}>{SRC[r.source]?.label || r.source}</span>
                  {r.is_overridden && <span className="m-badge m-badge-yellow ml-1">Đã sửa tay</span>}
                  {r.source_note && <div className="text-xs mt-1" style={{ color: 'var(--m-ink-faint)' }}>{r.source_note}</div>}
                </td>
                <td className="text-right m-num font-semibold">{fmt(r.amount)}</td>
                <td className="text-right whitespace-nowrap">
                  <button onClick={() => setEditRow({ id: r.id, name: r.name, amount: r.amount })} className="text-xs font-semibold hover:underline mr-3" style={{ color: 'var(--m-primary)' }}>Sửa</button>
                  {r.source !== 'manual' && r.is_overridden && (
                    <button onClick={() => resetAuto(r)} className="text-xs font-semibold hover:underline mr-3" style={{ color: '#059669' }}>Lấy lại số tự động</button>
                  )}
                  {r.source === 'manual' && (
                    <button onClick={() => remove(r)} className="text-xs font-semibold hover:underline" style={{ color: 'var(--m-danger)' }}>Xóa</button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && <tr><td colSpan={4} className="p-8 text-center" style={{ color: 'var(--m-ink-faint)' }}>Chưa có khoản nào.</td></tr>}
            {loading && <tr><td colSpan={4} className="p-8 text-center" style={{ color: 'var(--m-ink-faint)' }}>Đang tải...</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="font-bold">Tổng chi phí cố định/tháng</td>
              <td className="text-right m-num font-bold" style={{ color: 'var(--m-primary)' }}>{fmt(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="m-card p-4 mt-4">
        <div className="text-sm font-bold mb-2">Thêm khoản nhập tay</div>
        <div className="flex flex-wrap gap-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Tên khoản (bảo hiểm, phần mềm...)" className="m-input" style={{ width: 280 }} />
          <input type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="Số tiền/tháng" className="m-input" style={{ width: 170 }} />
          <button onClick={addRow} className="m-btn m-btn-primary m-btn-sm">+ Thêm khoản</button>
        </div>
      </div>

      {editRow && (
        <div className="m-modal-backdrop" onClick={() => setEditRow(null)}>
          <div className="m-modal m-modal--flex" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="m-modal-head">Sửa khoản chi</div>
            <div className="m-modal-body">
            <div className="space-y-3">
              <div>
                <label className="m-label">Tên khoản</label>
                <input value={editRow.name} onChange={(e) => setEditRow({ ...editRow, name: e.target.value })} className="m-input w-full" />
              </div>
              <div>
                <label className="m-label">Số tiền/tháng (đ)</label>
                <input type="number" min={0} value={editRow.amount} onChange={(e) => setEditRow({ ...editRow, amount: e.target.value })} className="m-input w-full" />
              </div>
              <p className="text-xs" style={{ color: 'var(--m-ink-faint)' }}>
                Sửa tay trên khoản tự động sẽ ghi đè và ngừng tự cập nhật (dùng nút "Lấy lại số tự động" để quay về).
              </p>
            </div>
            </div>
            <div className="m-modal-foot">
              <button onClick={() => setEditRow(null)} className="m-btn m-btn-ghost">Hủy</button>
              <button onClick={saveEdit} className="m-btn m-btn-primary">Lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
