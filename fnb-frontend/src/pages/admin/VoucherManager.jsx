import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';
import { fmtDateTime } from '../../utils/format';
import DateTimeInput from '../../components/DateTimeInput';

// Spec 5 — UI quản lý voucher (2026-10-21, lệnh Đại Vương qua PM).
// Tab "Mã voucher" trong trang Khuyến mại (/admin/promotions?tab=voucher), layout L1.
// Bậc thầy: danh sách + form modal + tạo hàng loạt + xem lượt dùng.
const BADGE = {
  active: ['Đang chạy', 'm-badge-green'],
  inactive: ['Đã tắt', 'm-badge-gray'],
  upcoming: ['Chưa bắt đầu', 'm-badge-blue'],
  expiring: ['Sắp hết hạn', 'm-badge-yellow'],
  expired: ['Hết hạn', 'm-badge-red'],
  exhausted: ['Hết lượt', 'm-badge-red'],
};

const emptyForm = () => ({
  name: '', code: '', prefix: 'DB-', quantity: 1,
  type: 'fixed', value: '', max_discount_amount: '', min_order_amount: '',
  usage_limit: '', per_customer_limit: '',
  starts_at: '', expires_at: '',
  stack_with_promotion: false,
  is_active: true,
});

// Sinh mã 8 ký tự preview ở client (giống quy tắc backend; unique do server đảm bảo)
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = (prefix) => {
  let body = '';
  for (let i = 0; i < 8; i++) body += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return (prefix || '') + body;
};

const toInputDT = (v) => (v ? String(v).slice(0, 16).replace(' ', 'T') : '');
const fmtMoney = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;

export default function VoucherManager() {
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState('');
  const [typeF, setTypeF] = useState('');
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState(null); // {mode:'create'} | {mode:'edit', v}
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const [usageV, setUsageV] = useState(null); // voucher đang xem lượt dùng
  const [usages, setUsages] = useState([]);
  const [usagePage, setUsagePage] = useState(1);
  const [usageLast, setUsageLast] = useState(1);

  const [result, setResult] = useState(null); // danh sách mã vừa tạo hàng loạt

  const fetchList = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/vouchers`, {
        params: { page: p, per_page: 20, search: search || undefined, status: statusF || undefined, type: typeF || undefined },
      });
      const d = res.data?.data;
      setList(d?.data || []);
      setPage(d?.current_page || 1);
      setLastPage(d?.last_page || 1);
    } catch (e) { alert(e.response?.data?.message || 'Không tải được danh sách voucher.'); }
    finally { setLoading(false); }
  }, [search, statusF, typeF]);

  useEffect(() => { fetchList(1); }, [fetchList]);

  const fetchUsages = async (v, p = 1) => {
    try {
      const res = await axios.get(`${API}/vouchers/${v.id}/usages`, { params: { page: p, per_page: 20 } });
      const d = res.data?.data;
      setUsages(d?.data || []);
      setUsagePage(d?.current_page || 1);
      setUsageLast(d?.last_page || 1);
    } catch (e) { alert(e.response?.data?.message || 'Không tải được lượt dùng.'); }
  };

  const openCreate = () => { setForm(emptyForm()); setModal({ mode: 'create' }); };
  const openEdit = (v) => {
    setForm({
      name: v.name || '', code: v.code || '', prefix: 'DB-', quantity: 1,
      type: v.type, value: v.value, max_discount_amount: v.max_discount_amount ?? '',
      min_order_amount: v.min_order_amount ?? '',
      usage_limit: v.usage_limit ?? '', per_customer_limit: v.per_customer_limit ?? '',
      starts_at: toInputDT(v.starts_at), expires_at: toInputDT(v.expires_at),
      stack_with_promotion: !!v.stack_with_promotion,
      is_active: !!v.is_active,
    });
    setModal({ mode: 'edit', v });
  };

  const copy = async (text) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(String(text));
      else {
        const ta = document.createElement('textarea');
        ta.value = String(text); document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      }
    } catch { /* bỏ qua */ }
  };

  const save = async () => {
    const isEdit = modal?.mode === 'edit';
    const qty = Math.max(1, Math.min(500, Number(form.quantity) || 1));
    const payload = {
      name: form.name.trim(),
      type: form.type,
      value: Number(form.value) || 0,
      max_discount_amount: form.max_discount_amount === '' ? null : Number(form.max_discount_amount),
      min_order_amount: form.min_order_amount === '' ? null : Number(form.min_order_amount),
      usage_limit: form.usage_limit === '' ? null : Number(form.usage_limit),
      per_customer_limit: form.per_customer_limit === '' ? null : Number(form.per_customer_limit),
      starts_at: form.starts_at ? form.starts_at.replace('T', ' ') + ':00' : null,
      expires_at: form.expires_at ? form.expires_at.replace('T', ' ') + ':00' : null,
      is_active: !!form.is_active,
      stack_with_promotion: !!form.stack_with_promotion,
    };
    if (isEdit) {
      // Sửa: khóa mã khi đã có lượt dùng; gửi kèm mã để server đối chiếu (không đổi được thì backend 422)
      payload.code = form.code.trim();
    } else {
      payload.quantity = qty;
      if (qty === 1) {
        if (form.code.trim()) payload.code = form.code.trim();
      } else {
        payload.prefix = (form.prefix || '').trim();
      }
    }

    setSaving(true);
    try {
      if (isEdit) {
        await axios.put(`${API}/vouchers/${modal.v.id}`, payload);
        setModal(null);
      } else {
        const res = await axios.post(`${API}/vouchers`, payload);
        setModal(null);
        const created = res.data?.data || [];
        if (qty > 1) setResult(created);
      }
      fetchList(isEdit ? page : 1);
    } catch (e) {
      const msg = e.response?.data?.message
        || (e.response?.data?.errors ? Object.values(e.response.data.errors).flat().join('\n') : null)
        || 'Không lưu được voucher.';
      alert(msg);
    } finally { setSaving(false); }
  };

  const toggleActive = async (v) => {
    try {
      await axios.put(`${API}/vouchers/${v.id}`, { is_active: !v.is_active });
      fetchList(page);
    } catch (e) { alert(e.response?.data?.message || 'Không đổi được trạng thái.'); }
  };

  const handleDelete = async (v) => {
    if (v.used_count > 0) {
      alert('Voucher đã có lượt sử dụng, hãy tắt trạng thái thay vì xóa.');
      return;
    }
    if (!confirm(`Xóa voucher "${v.code}"?`)) return;
    try {
      await axios.delete(`${API}/vouchers/${v.id}`);
      fetchList(page);
    } catch (e) { alert(e.response?.data?.message || 'Không xóa được.'); }
  };

  const downloadCSV = () => {
    const rows = ['code,name'];
    (result || []).forEach((v) => rows.push(`${v.code},"${(v.name || '').replace(/"/g, '""')}"`));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vouchers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const multiQty = Math.max(1, Math.min(500, Number(form.quantity) || 1)) > 1;
  const codeLocked = modal?.mode === 'edit' && (modal.v?.used_count || 0) > 0;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const badgeOf = (v) => {
    const [label, cls] = BADGE[v.status_badge] || ['—', 'm-badge-gray'];
    return <span className={`m-badge ${cls}`}>{label}</span>;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchList(1)}
          placeholder="Tìm theo mã / tên..." className="m-input" style={{ width: 220 }} />
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="m-input" style={{ width: 150 }}>
          <option value="">Mọi trạng thái</option>
          <option value="active">Đang bật</option>
          <option value="inactive">Đã tắt</option>
          <option value="expired">Hết hạn</option>
          <option value="exhausted">Hết lượt</option>
        </select>
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)} className="m-input" style={{ width: 130 }}>
          <option value="">Mọi loại</option>
          <option value="percent">Theo %</option>
          <option value="fixed">Số tiền</option>
        </select>
        <button onClick={() => fetchList(1)} className="m-btn m-btn-sm m-btn-ghost">Tìm</button>
        <button onClick={openCreate} className="m-btn m-btn-primary m-btn-sm" style={{ marginLeft: 'auto' }}>+ Voucher</button>
      </div>

      <div className="m-card overflow-x-auto">
        <table className="m-table min-w-[1000px]">
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tên chương trình</th>
              <th>Giảm</th>
              <th>Đã dùng / Tổng lượt</th>
              <th>Hạn dùng</th>
              <th>Cộng dồn</th>
              <th>Trạng thái</th>
              <th className="text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id}>
                <td>
                  <span className="font-mono font-bold" style={{ color: 'var(--m-primary)' }}>{v.code}</span>
                  <button onClick={() => copy(v.code)} title="Sao chép mã" className="text-xs ml-2 hover:underline" style={{ color: 'var(--m-ink-faint)' }}>⧉</button>
                </td>
                <td className="font-medium">{v.name}</td>
                <td className="font-semibold m-num">
                  {v.type === 'percent' ? `−${v.value}%` : `−${fmtMoney(v.value)}`}
                  {v.type === 'percent' && v.max_discount_amount != null && (
                    <div className="text-xs font-normal" style={{ color: 'var(--m-ink-soft)' }}>tối đa {fmtMoney(v.max_discount_amount)}</div>
                  )}
                </td>
                <td className="m-num">
                  <b>{v.used_count}</b>{v.usage_limit != null ? ` / ${v.usage_limit}` : ' / ∞'}
                  {v.per_customer_limit != null && (
                    <div className="text-xs" style={{ color: 'var(--m-ink-soft)' }}>tối đa {v.per_customer_limit} lần/khách</div>
                  )}
                </td>
                <td className="text-xs" style={{ color: 'var(--m-ink-soft)' }}>
                  {v.starts_at ? fmtDateTime(v.starts_at) : '—'}
                  {' → '}
                  {v.expires_at ? fmtDateTime(v.expires_at) : 'không giới hạn'}
                  <div className="mt-1">{badgeOf(v)}</div>
                </td>
                <td>
                  <div className="flex flex-col gap-1">
                    {v.stack_with_promotion && <span className="m-badge m-badge-blue text-[10px]">Cộng dồn với KM</span>}
                    {!v.stack_with_promotion && <span className="text-xs" style={{ color: 'var(--m-ink-faint)' }}>—</span>}
                  </div>
                </td>
                <td>
                  <button onClick={() => toggleActive(v)} title="Bật/tắt" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                    <span className={`m-badge ${v.is_active ? 'm-badge-green' : 'm-badge-red'}`}>{v.is_active ? 'Bật' : 'Tắt'}</span>
                  </button>
                </td>
                <td className="text-right whitespace-nowrap">
                  <button onClick={() => openEdit(v)} className="text-xs font-semibold hover:underline mr-3" style={{ color: 'var(--m-primary)' }}>Sửa</button>
                  <button onClick={() => { setUsageV(v); setUsages([]); fetchUsages(v, 1); }} className="text-xs font-semibold hover:underline mr-3" style={{ color: 'var(--m-primary)' }}>Lượt dùng</button>
                  <button onClick={() => handleDelete(v)} className="text-xs font-semibold hover:underline" style={{ color: 'var(--m-danger)' }}>Xóa</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && !loading && <tr><td colSpan={8} className="p-8 text-center" style={{ color: 'var(--m-ink-faint)' }}>Chưa có voucher nào.</td></tr>}
            {loading && <tr><td colSpan={8} className="p-8 text-center" style={{ color: 'var(--m-ink-faint)' }}>Đang tải...</td></tr>}
          </tbody>
        </table>
      </div>

      {lastPage > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button disabled={page <= 1} onClick={() => fetchList(page - 1)} className="m-btn m-btn-sm m-btn-ghost">‹ Trước</button>
          <span className="text-xs py-2" style={{ color: 'var(--m-ink-soft)' }}>{page} / {lastPage}</span>
          <button disabled={page >= lastPage} onClick={() => fetchList(page + 1)} className="m-btn m-btn-sm m-btn-ghost">Sau ›</button>
        </div>
      )}

      {/* ================= MODAL TẠO/SỬA ================= */}
      {modal && (
        <div className="m-modal-backdrop" onClick={() => setModal(null)}>
          <div className="m-modal m-modal--flex" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="m-modal-head">{modal.mode === 'create' ? 'Tạo voucher mới' : `Sửa voucher ${modal.v?.code || ''}`}</div>
            <div className="m-modal-body">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="m-label">Tên chương trình *</label>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} className="m-input w-full" placeholder="VD: Giảm 20K cho đơn đầu" />
              </div>

              {modal.mode === 'create' ? (
                <>
                  <div>
                    <label className="m-label">Số lượng mã</label>
                    <input type="number" min={1} max={500} value={form.quantity} onChange={(e) => set('quantity', e.target.value)} className="m-input w-full" />
                    <div className="text-[11.5px] mt-1" style={{ color: 'var(--m-ink-faint)' }}>Tối đa 500 mã/lần — khi {'>'}1 sẽ tự sinh mã theo tiền tố.</div>
                  </div>
                  {multiQty ? (
                    <div>
                      <label className="m-label">Tiền tố mã</label>
                      <input value={form.prefix} onChange={(e) => set('prefix', e.target.value)} className="m-input w-full" placeholder="DB-" />
                    </div>
                  ) : (
                    <div>
                      <label className="m-label">Mã voucher</label>
                      <div className="flex gap-2">
                        <input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} className="m-input flex-1 min-w-0 font-mono" placeholder="Để trống = tự sinh" />
                        <button type="button" onClick={() => set('code', genCode(form.prefix))} className="m-btn m-btn-sm m-btn-ghost whitespace-nowrap shrink-0">Sinh mã</button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="md:col-span-2">
                  <label className="m-label">Mã voucher{codeLocked && ' (đã có lượt dùng — không đổi được)'}</label>
                  <input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} disabled={codeLocked}
                    className="m-input w-full font-mono" />
                </div>
              )}

              <div>
                <label className="m-label">Loại giảm</label>
                <select value={form.type} onChange={(e) => set('type', e.target.value)} className="m-input w-full">
                  <option value="fixed">Số tiền (đ)</option>
                  <option value="percent">Phần trăm (%)</option>
                </select>
              </div>
              <div>
                <label className="m-label">Giá trị * {form.type === 'percent' ? '(≤ 100)' : '(đ)'}</label>
                <input type="number" min={0} value={form.value} onChange={(e) => set('value', e.target.value)} className="m-input w-full" />
              </div>
              {form.type === 'percent' && (
                <div>
                  <label className="m-label">Giảm tối đa (đ)</label>
                  <input type="number" min={0} value={form.max_discount_amount} onChange={(e) => set('max_discount_amount', e.target.value)} className="m-input w-full" placeholder="Trống = không trần" />
                </div>
              )}
              <div>
                <label className="m-label">Đơn tối thiểu (đ)</label>
                <input type="number" min={0} value={form.min_order_amount} onChange={(e) => set('min_order_amount', e.target.value)} className="m-input w-full" placeholder="0" />
              </div>
              <div>
                <label className="m-label">Tổng lượt dùng</label>
                <input type="number" min={1} value={form.usage_limit} onChange={(e) => set('usage_limit', e.target.value)} className="m-input w-full" placeholder="Trống = không giới hạn" />
              </div>
              <div>
                <label className="m-label">Tối đa mỗi khách</label>
                <input type="number" min={1} value={form.per_customer_limit} onChange={(e) => set('per_customer_limit', e.target.value)} className="m-input w-full" placeholder="Trống = không giới hạn" />
              </div>
              {/* Ngày-giờ chiếm trọn hàng: 2 cột từ sm trở lên; mobile xếp 1 cột để ô ngày + ô giờ không chen nhau */}
              <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="m-label">Bắt đầu</label>
                  <DateTimeInput value={form.starts_at} onChange={(v) => set('starts_at', v)} className="m-input w-full" />
                </div>
                <div>
                  <label className="m-label">Kết thúc</label>
                  <DateTimeInput value={form.expires_at} onChange={(v) => set('expires_at', v)} className="m-input w-full" />
                </div>
              </div>

              {/* Mô hình cộng dồn 2026-10-21 ~22:45: phía voucher đúng 1 công tắc — cộng dồn
                  với KM. Cờ coupon+coupon đã bỏ hẳn (tối đa 1 coupon/đơn), không còn công tắc
                  toàn cục. Khối <label> bấm được: bấm vào chữ cũng tick (kiểu các trang Admin khác). */}
              <div className="md:col-span-2 m-card p-3 space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.stack_with_promotion} onChange={(e) => set('stack_with_promotion', e.target.checked)} className="w-4 h-4 mt-0.5 shrink-0 accent-[#24305E]" />
                  <span>
                    <span className="block text-sm font-medium">Cho phép cộng dồn với khuyến mãi</span>
                    <span className="block text-xs" style={{ color: 'var(--m-ink-soft)' }}>Bật: voucher này được cộng thêm với 1 khuyến mại khi KM đó cũng bật "Cho phép cộng dồn với coupon". Tắt (mặc định): mỗi đơn chỉ áp ưu đãi lớn hơn — hòa thì KM thắng, voucher không bị trừ.</span>
                  </span>
                </label>
              </div>

              <label className="md:col-span-2 flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="w-4 h-4 shrink-0 accent-[#24305E]" />
                <span className="text-sm font-medium">Đang bật</span>
              </label>
            </div>
            </div>
            <div className="m-modal-foot">
              <button onClick={() => setModal(null)} className="m-btn m-btn-ghost">Hủy</button>
              <button onClick={save} disabled={saving} className="m-btn m-btn-primary">
                {saving ? 'Đang lưu...' : (modal.mode === 'create' ? 'Tạo voucher' : 'Lưu')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL LƯỢT DÙNG ================= */}
      {usageV && (
        <div className="m-modal-backdrop" onClick={() => setUsageV(null)}>
          <div className="m-modal m-modal--flex" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="m-modal-head">Lượt dùng — <span className="font-mono">{usageV.code}</span></div>
            <div className="m-modal-body">
            <div className="m-card overflow-x-auto">
              <table className="m-table min-w-[480px]">
                <thead><tr><th>Khách hàng</th><th>SĐT</th><th>Mã đơn</th><th>Thời điểm</th></tr></thead>
                <tbody>
                  {usages.map((u) => (
                    <tr key={u.id}>
                      <td>{u.customer_name || '—'}</td>
                      <td className="font-mono">{u.customer_phone || '—'}</td>
                      <td className="font-mono">{u.order_code || '—'}</td>
                      <td className="text-xs">{u.used_at ? fmtDateTime(u.used_at) : '—'}</td>
                    </tr>
                  ))}
                  {usages.length === 0 && <tr><td colSpan={4} className="p-6 text-center" style={{ color: 'var(--m-ink-faint)' }}>Chưa có lượt dùng nào.</td></tr>}
                </tbody>
              </table>
            </div>
            {usageLast > 1 && (
              <div className="flex justify-center gap-2 mt-3">
                <button disabled={usagePage <= 1} onClick={() => fetchUsages(usageV, usagePage - 1)} className="m-btn m-btn-sm m-btn-ghost">‹ Trước</button>
                <span className="text-xs py-2">{usagePage} / {usageLast}</span>
                <button disabled={usagePage >= usageLast} onClick={() => fetchUsages(usageV, usagePage + 1)} className="m-btn m-btn-sm m-btn-ghost">Sau ›</button>
              </div>
            )}
            </div>
            <div className="m-modal-foot">
              <button onClick={() => setUsageV(null)} className="m-btn m-btn-ghost">Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL KẾT QUẢ TẠO HÀNG LOẠT ================= */}
      {result && (
        <div className="m-modal-backdrop" onClick={() => setResult(null)}>
          <div className="m-modal m-modal--flex" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="m-modal-head">Đã tạo {result.length} mã voucher</div>
            <div className="m-modal-body">
            <div className="m-card overflow-x-auto">
              <table className="m-table">
                <tbody>
                  {result.map((v) => (
                    <tr key={v.id}><td className="font-mono font-bold" style={{ color: 'var(--m-primary)' }}>{v.code}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
            <div className="m-modal-foot">
              <button onClick={() => { copy(result.map((v) => v.code).join('\n')); }} className="m-btn m-btn-ghost">Sao chép tất cả</button>
              <button onClick={downloadCSV} className="m-btn m-btn-ghost">Tải CSV</button>
              <button onClick={() => setResult(null)} className="m-btn m-btn-primary">Xong</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
