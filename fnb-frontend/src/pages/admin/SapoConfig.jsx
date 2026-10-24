import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { API } from '../../utils/api';

// Cầu nối Sapo — Phần B (2026-10-21): giao diện Admin.
// Tab 1: Map tên món Sapo (tên chưa map từ lần import gần nhất → chọn món DBOMNI)
// Tab 2: Map tùy chọn Sapo (text lựa chọn chưa map → chọn (nhóm, tùy chọn))
// Tab 3: Cấu hình Sapo (alias cột, map kênh, map PTTT, anchor→chi nhánh, keyword size, cửa sổ nghi ngờ, pattern mail)
const api = async (path, opts = {}) => {
  const r = await axios({ url: `${API}${path}`, ...opts });
  if (!r.data?.success) throw new Error(r.data?.message || 'Lỗi');
  return r.data.data;
};

const inputCls = 'w-full border rounded-lg px-3 py-2.5 text-sm';
const btnPrimary = 'bg-[#24305E] text-white rounded-lg px-4 py-2.5 text-sm font-medium active:opacity-90';
const btnGhost = 'border rounded-lg px-3 py-2 text-sm active:bg-gray-50';

export default function SapoConfig() {
  const [tab, setTab] = useState('products');
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setMeta(await api('/sapo/meta')); }
      catch (e) { alert('Không tải được cấu hình Sapo: ' + (e.response?.data?.message || e.message)); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <AdminLayout><div className="p-6 text-sm">Đang tải...</div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <h1 className="text-lg font-bold mb-1">Cầu nối Sapo</h1>
        <p className="text-sm text-gray-500 mb-4">Map tên món, tùy chọn và cấu hình import đơn từ file Excel Sapo.</p>

        <div className="flex gap-2 mb-4 overflow-x-auto">
          {[
            ['products', 'Map món'],
            ['options', 'Map tùy chọn'],
            ['config', 'Cấu hình'],
            ['runs', 'Báo cáo import'],
            ['suspects', 'Nghi ngờ'],
          ].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium border ${tab === key ? 'bg-[#24305E] text-white border-[#24305E]' : 'bg-white'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'products' && <MapProducts />}
        {tab === 'options' && <MapOptions />}
        {tab === 'config' && meta && <SapoSettings meta={meta} />}
        {tab === 'runs' && <ImportReports goSuspects={() => setTab('suspects')} />}
        {tab === 'suspects' && <Suspects goTab={setTab} />}
      </div>
    </AdminLayout>
  );
}

// ---------------- dùng chung: modal chọn ----------------
function PickModal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full md:max-w-lg md:rounded-2xl rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">{title}</h3>
          <button className={btnGhost} onClick={onClose}>Đóng</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------- Tab 1: Map món ----------------
function MapProducts() {
  const [unmapped, setUnmapped] = useState([]);
  const [mapped, setMapped] = useState([]);
  const [q1, setQ1] = useState('');
  const [q2, setQ2] = useState('');
  const [picking, setPicking] = useState(null); // {sapoName, id?} hoặc null
  const [candidates, setCandidates] = useState([]);
  const [cq, setCq] = useState('');

  const load = async () => {
    try {
      const u = await api('/sapo/unmapped');
      setUnmapped(u.products || []);
      setMapped(await api('/sapo/maps/products'));
    } catch (e) { alert(e.response?.data?.message || e.message); }
  };
  useEffect(() => { load(); }, []);

  const searchCandidates = async (v) => {
    setCq(v);
    try { setCandidates(await api('/sapo/products-catalog?q=' + encodeURIComponent(v))); }
    catch (e) { /* bỏ qua */ }
  };
  useEffect(() => { if (picking) searchCandidates(''); }, [picking]);

  const save = async (productId) => {
    try {
      await api('/sapo/maps/products', { method: 'post', data: { sapo_name: picking.sapoName, product_id: productId } });
      setPicking(null);
      load();
    } catch (e) { alert(e.response?.data?.message || e.message); }
  };
  const remove = async (id) => {
    if (!confirm('Xóa map này?')) return;
    await api(`/sapo/maps/products/${id}`, { method: 'delete' });
    load();
  };

  const f1 = useMemo(() => unmapped.filter((x) => !q1 || x.name.toLowerCase().includes(q1.toLowerCase())), [unmapped, q1]);
  const f2 = useMemo(() => mapped.filter((x) => !q2 || x.sapo_name.toLowerCase().includes(q2.toLowerCase())), [mapped, q2]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-4">
        <h2 className="font-bold mb-1">Tên chưa map <span className="text-sm font-normal text-gray-500">(từ lần import gần nhất)</span></h2>
        <p className="text-xs text-gray-500 mb-3">Map 1 lần, các lần import sau tự khớp. Tên món so khớp chính xác tuyệt đối, không tự đoán.</p>
        <input className={inputCls + ' mb-3'} placeholder="Tìm tên Sapo..." value={q1} onChange={(e) => setQ1(e.target.value)} />
        {f1.length === 0 && <p className="text-sm text-gray-400">Không còn tên nào chưa map.</p>}
        <div className="divide-y">
          {f1.map((x) => (
            <div key={x.name} className="py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium break-words">{x.name}</div>
                <div className="text-xs text-gray-500">{x.invoices} hóa đơn</div>
              </div>
              <button className={btnGhost} onClick={() => setPicking({ sapoName: x.name })}>Map</button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border p-4">
        <h2 className="font-bold mb-3">Đã map ({mapped.length})</h2>
        <input className={inputCls + ' mb-3'} placeholder="Tìm trong danh sách đã map..." value={q2} onChange={(e) => setQ2(e.target.value)} />
        <div className="divide-y">
          {f2.map((m) => (
            <div key={m.id} className="py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium break-words">{m.sapo_name}</div>
                <div className="text-xs text-gray-500">→ {m.product?.name || '(món đã bị xóa)'}</div>
              </div>
              <button className={btnGhost} onClick={() => setPicking({ sapoName: m.sapo_name })}>Sửa</button>
              <button className={btnGhost + ' text-red-600'} onClick={() => remove(m.id)}>Xóa</button>
            </div>
          ))}
        </div>
      </div>

      {picking && (
        <PickModal title={'Map món: ' + picking.sapoName} onClose={() => setPicking(null)}>
          <input className={inputCls + ' mb-3'} placeholder="Tìm món DBOMNI theo tên hoặc SKU..." value={cq} onChange={(e) => searchCandidates(e.target.value)} autoFocus />
          <div className="divide-y max-h-80 overflow-y-auto">
            {candidates.map((c) => (
              <button key={c.id} className="w-full text-left py-2.5 px-1 hover:bg-gray-50 flex items-center gap-2" onClick={() => save(c.id)}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{c.name}</div>
                  {c.sku && <div className="text-xs text-gray-500">SKU: {c.sku}</div>}
                </div>
                <span className="text-xs text-[#24305E] font-medium">Chọn</span>
              </button>
            ))}
            {candidates.length === 0 && <p className="text-sm text-gray-400 py-3">Không tìm thấy món nào.</p>}
          </div>
        </PickModal>
      )}
    </div>
  );
}

// ---------------- Tab 2: Map tùy chọn ----------------
function MapOptions() {
  const [unmapped, setUnmapped] = useState([]);
  const [mapped, setMapped] = useState([]);
  const [q1, setQ1] = useState('');
  const [q2, setQ2] = useState('');
  const [picking, setPicking] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [cq, setCq] = useState('');

  const load = async () => {
    try {
      const u = await api('/sapo/unmapped');
      setUnmapped(u.options || []);
      setMapped(await api('/sapo/maps/options'));
    } catch (e) { alert(e.response?.data?.message || e.message); }
  };
  useEffect(() => { load(); }, []);

  const searchCandidates = async (v) => {
    setCq(v);
    try { setCandidates(await api('/sapo/options-catalog?q=' + encodeURIComponent(v))); }
    catch (e) { /* bỏ qua */ }
  };
  useEffect(() => { if (picking) searchCandidates(''); }, [picking]);

  const save = async (optionId) => {
    try {
      await api('/sapo/maps/options', { method: 'post', data: { sapo_option_text: picking.sapoText, option_id: optionId } });
      setPicking(null);
      load();
    } catch (e) { alert(e.response?.data?.message || e.message); }
  };
  const remove = async (id) => {
    if (!confirm('Xóa map này?')) return;
    await api(`/sapo/maps/options/${id}`, { method: 'delete' });
    load();
  };

  const f1 = useMemo(() => unmapped.filter((x) => !q1 || x.name.toLowerCase().includes(q1.toLowerCase())), [unmapped, q1]);
  const f2 = useMemo(() => mapped.filter((x) => !q2 || x.sapo_option_text.toLowerCase().includes(q2.toLowerCase())), [mapped, q2]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-4">
        <h2 className="font-bold mb-1">Text lựa chọn chưa map <span className="text-sm font-normal text-gray-500">(từng đoạn trong cột "Tên lựa chọn")</span></h2>
        <p className="text-xs text-gray-500 mb-3">Mỗi đoạn text map vào đúng 1 tùy chọn thuộc nhóm của nó (gồm size). Kho trừ theo định mức của tùy chọn đã map.</p>
        <input className={inputCls + ' mb-3'} placeholder="Tìm text lựa chọn..." value={q1} onChange={(e) => setQ1(e.target.value)} />
        {f1.length === 0 && <p className="text-sm text-gray-400">Không còn text nào chưa map.</p>}
        <div className="divide-y">
          {f1.map((x) => (
            <div key={x.name} className="py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium break-words">"{x.name}"</div>
                <div className="text-xs text-gray-500">{x.invoices} hóa đơn</div>
              </div>
              <button className={btnGhost} onClick={() => setPicking({ sapoText: x.name })}>Map</button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border p-4">
        <h2 className="font-bold mb-3">Đã map ({mapped.length})</h2>
        <input className={inputCls + ' mb-3'} placeholder="Tìm trong danh sách đã map..." value={q2} onChange={(e) => setQ2(e.target.value)} />
        <div className="divide-y">
          {f2.map((m) => (
            <div key={m.id} className="py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium break-words">"{m.sapo_option_text}"</div>
                <div className="text-xs text-gray-500">→ {m.option ? `${m.option.name}${m.option.group ? ` — ${m.option.group.name}` : ''}` : '(đã bị xóa)'}</div>
              </div>
              <button className={btnGhost} onClick={() => setPicking({ sapoText: m.sapo_option_text })}>Sửa</button>
              <button className={btnGhost + ' text-red-600'} onClick={() => remove(m.id)}>Xóa</button>
            </div>
          ))}
        </div>
      </div>

      {picking && (
        <PickModal title={'Map tùy chọn: "' + picking.sapoText + '"'} onClose={() => setPicking(null)}>
          <input className={inputCls + ' mb-3'} placeholder="Tìm tùy chọn theo tên hoặc tên nhóm..." value={cq} onChange={(e) => searchCandidates(e.target.value)} autoFocus />
          <div className="divide-y max-h-80 overflow-y-auto">
            {candidates.map((c) => (
              <button key={c.id} className="w-full text-left py-2.5 px-1 hover:bg-gray-50 flex items-center gap-2" onClick={() => save(c.id)}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-gray-500">Nhóm: {c.group_name}</div>
                </div>
                <span className="text-xs text-[#24305E] font-medium">Chọn</span>
              </button>
            ))}
            {candidates.length === 0 && <p className="text-sm text-gray-400 py-3">Không tìm thấy tùy chọn nào.</p>}
          </div>
        </PickModal>
      )}
    </div>
  );
}

// ---------------- Tab 3: Cấu hình ----------------
function SapoSettings({ meta }) {
  const [cfg, setCfg] = useState({ suspect_window_minutes: 15, mail_sender_pattern: 'sapo', mail_subject_pattern: 'xuất file' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [mailRefresh, setMailRefresh] = useState(0);

  useEffect(() => {
    (async () => {
      try { setCfg(await api('/sapo/config')); }
      catch (e) { /* giữ mặc định */ }
    })();
  }, []);

  const saveCfg = async () => {
    setSaving(true); setMsg('');
    try {
      await api('/sapo/config', { method: 'put', data: { ...cfg, suspect_window_minutes: Number(cfg.suspect_window_minutes) } });
      setMsg('Đã lưu.');
    } catch (e) { setMsg(e.response?.data?.message || e.message); }
    finally { setSaving(false); }
  };

  const channelOpts = useMemo(() => [{ code: 'dbomni', name: 'DBOMNI (kênh DBOMNI trên Sapo — bỏ qua khi import)' },
    ...meta.channels.map((c) => ({ code: c.code, name: `${c.name} (${c.code})` }))], [meta]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-4">
        <h2 className="font-bold mb-3">Tổng quát</h2>
        <label className="block text-sm mb-1">Cửa sổ "nghi ngờ" trùng đơn DBOMNI (phút)</label>
        <input type="number" min="0" max="180" className={inputCls + ' mb-3'} value={cfg.suspect_window_minutes}
          onChange={(e) => setCfg({ ...cfg, suspect_window_minutes: e.target.value })} />
        <label className="block text-sm mb-1">Pattern nhận diện người gửi mail Sapo</label>
        <input className={inputCls + ' mb-3'} value={cfg.mail_sender_pattern}
          onChange={(e) => setCfg({ ...cfg, mail_sender_pattern: e.target.value })} />
        <label className="block text-sm mb-1">Pattern nhận diện tiêu đề mail xuất file</label>
        <input className={inputCls + ' mb-3'} value={cfg.mail_subject_pattern}
          onChange={(e) => setCfg({ ...cfg, mail_subject_pattern: e.target.value })} />
        <div className="flex items-center gap-2">
          <button className={btnPrimary} onClick={saveCfg} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu cấu hình'}</button>
          {msg && <span className="text-sm text-gray-600">{msg}</span>}
        </div>
      </div>

      <ImapCard onChecked={() => setMailRefresh((n) => n + 1)} />
      <MailLogs refreshKey={mailRefresh} />

      <MapRows table="aliases" title="Alias cột Excel" hint="Mỗi trường nội bộ chấp nhận các tên cột (đã chuẩn hóa) sau. Import map cột theo tên — Sapo thêm/dời cột không làm lệch dữ liệu."
        keyLabel="Trường" keyType="select" keyOptions={meta.fields.map((f) => ({ value: f.field, label: `${f.label}${f.required ? ' (bắt buộc)' : ''}` }))}
        valueLabel="Tên cột (tự chuẩn hóa)" />

      <MapRows table="channels" title="Map kênh bán" hint="Text ở cột Nguồn đơn / Đối tác giao hàng → kênh DBOMNI. Ưu tiên Đối tác giao hàng khi có."
        keyLabel="Text trong file Sapo" valueLabel="Kênh DBOMNI" valueType="select" valueOptions={channelOpts.map((c) => ({ value: c.code, label: c.name }))} />

      <MapRows table="payments" title="Map phương thức thanh toán" hint="Text PTTT trong file → phương thức của DBOMNI. Khớp chính xác trước, sau đó khớp 'chứa'."
        keyLabel="Text trong file Sapo" valueLabel="Phương thức" valueType="select" valueOptions={meta.payment_methods.map((p) => ({ value: p, label: p }))} />

      <MapRows table="anchors" title="Anchor text → Chi nhánh" hint="Anchor text của link tải file trong email Sapo → chi nhánh trừ kho. Nhập đúng chữ trong email, hệ thống tự chuẩn hóa. Không khớp → dừng file + cảnh báo."
        keyLabel="Anchor text trong email" valueLabel="Chi nhánh" valueType="select" valueOptions={meta.branches.map((b) => ({ value: b.id, label: b.name }))} hideValue />

      <MapRows table="sizes" title="Keyword nhận diện size" hint="Fallback khi đoạn text lựa chọn chứa size nhưng chưa có trong bảng map tùy chọn (VD text 'Size M (500ml...)' → size M của đúng món đó)."
        keyLabel="Keyword (tự chuẩn hóa)" valueLabel="Nhãn size" />
    </div>
  );
}

// ---------------- Phần D: báo cáo import ----------------
const fmtMoney = (v) => new Intl.NumberFormat('vi-VN').format(Number(v) || 0) + 'đ';
const fmtTime = (v) => (v ? new Date(v).toLocaleString('vi-VN') : '');

function CountChip({ label, value, cls }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs ${cls}`}>
      {label}: <b>{value}</b>
    </span>
  );
}

function ImportReports({ goSuspects }) {
  const [runs, setRuns] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    (async () => {
      try { setRuns(await api('/sapo/import-runs?limit=30')); }
      catch (e) { alert(e.response?.data?.message || e.message); }
    })();
  }, []);

  const toggle = async (id) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id); setDetail(null);
    try { setDetail(await api(`/sapo/import-runs/${id}`)); }
    catch (e) { /* bỏ qua */ }
  };

  return (
    <div className="space-y-3">
      {runs.length === 0 && <p className="text-sm text-gray-400">Chưa có lần import nào.</p>}
      {runs.map((r) => (
        <div key={r.id} className="bg-white rounded-xl border p-4">
          <button className="w-full text-left" onClick={() => toggle(r.id)}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm break-all">{r.filename || '(không tên file)'}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.source === 'imap' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                {r.source === 'imap' ? 'Qua mail (IMAP)' : 'Upload tay'}
              </span>
              {r.status === 'error'
                ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Lỗi</span>
                : <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Hoàn tất</span>}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {r.branch ? `CN: ${r.branch.name} · ` : ''}{fmtTime(r.created_at)} · {r.invoice_count} hóa đơn / {r.total_rows} dòng
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <CountChip label="Tạo mới" value={r.created_count} cls="bg-green-50 text-green-700" />
              <CountChip label="Bỏ qua (trùng)" value={r.duplicate_count} cls="bg-gray-100 text-gray-600" />
              <CountChip label="Bỏ qua (kênh DBOMNI)" value={r.dbomni_skipped_count} cls="bg-gray-100 text-gray-600" />
              <CountChip label="Đã hủy bỏ qua" value={r.cancelled_count} cls="bg-gray-100 text-gray-600" />
              <CountChip label="Nghi ngờ" value={r.suspect_count} cls="bg-amber-100 text-amber-700" />
            </div>
          </button>
          {openId === r.id && detail && (
            <div className="mt-3 pt-3 border-t text-sm space-y-2">
              {detail.error && <p className="text-red-600 break-words">{detail.error}</p>}
              {(detail.warnings || []).map((w, i) => <p key={i} className="text-amber-700 break-words">{w}</p>)}
              {detail.suspects?.length > 0 && (
                <button className={btnGhost} onClick={goSuspects}>
                  Xem {detail.suspects.length} hóa đơn nghi ngờ của lần import này
                </button>
              )}
              {!detail.error && !(detail.warnings || []).length && <p className="text-gray-500">Không có cảnh báo.</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------- Phần D: hàng đợi nghi ngờ ----------------
const REASON_LABEL = {
  unknown_product: 'Chưa map món',
  unknown_option: 'Chưa map tùy chọn',
  missing_required_option: 'Thiếu tùy chọn bắt buộc',
  unknown_channel: 'Chưa map kênh',
  unknown_payment: 'Chưa map PTTT',
  missing_payment: 'Thiếu cột PTTT',
  total_mismatch: 'Lệch tổng tiền',
  unknown_status: 'Trạng thái lạ',
  possible_duplicate: 'Nghi trùng đơn DBOMNI',
  insufficient_stock: 'Không đủ tồn kho',
  processing_error: 'Lỗi xử lý',
};

function Suspects({ goTab }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('pending');
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');
  const [discarding, setDiscarding] = useState(null);
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const params = new URLSearchParams({ status, reason, q });
      setRows(await api('/sapo/suspects?' + params.toString()));
    } catch (e) { alert(e.response?.data?.message || e.message); }
  };
  useEffect(() => { load(); }, [status, reason]);

  const act = async (id, action, body) => {
    setBusyId(id);
    try {
      const r = await axios({ url: `${API}/sapo/suspects/${id}/${action}`, method: 'post', data: body || {} });
      alert(r.data?.message || 'Đã xử lý.');
      setDiscarding(null); setNote('');
      load();
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setBusyId(null); }
  };

  const payloadSummary = (s) => {
    const rowsP = s.payload?.rows || [];
    const first = rowsP[0] || {};
    const names = [...new Set(rowsP.map((r) => r.product_name).filter(Boolean))];
    return { total: first.total_payment, count: rowsP.length, names: names.slice(0, 3), more: names.length > 3 };
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {[['pending', 'Chờ xử lý'], ['resolved', 'Đã xử lý'], ['discarded', 'Đã bỏ qua'], ['all', 'Tất cả']].map(([k, label]) => (
            <button key={k} onClick={() => setStatus(k)}
              className={`rounded-lg px-3 py-2 text-sm border ${status === k ? 'bg-[#24305E] text-white border-[#24305E]' : 'bg-white'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-col md:flex-row gap-2">
          <select className={inputCls + ' md:w-64'} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">— Mọi lý do —</option>
            {Object.entries(REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className={inputCls + ' md:flex-1'} placeholder="Tìm theo mã hóa đơn Sapo..." value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
          <button className={btnGhost + ' py-2.5'} onClick={load}>Tìm</button>
        </div>
      </div>

      {rows.length === 0 && <p className="text-sm text-gray-400">Không có mục nào.</p>}
      <div className="space-y-3">
        {rows.map((s) => {
          const sum = payloadSummary(s);
          return (
            <div key={s.id} className="bg-white rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-sm">HĐ {s.sapo_invoice_code}</span>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                  {REASON_LABEL[s.reason] || s.reason}
                </span>
                <span className="text-xs text-gray-500">
                  {sum.count} dòng · Tổng {fmtMoney(sum.total)}{s.branch ? ` · CN: ${s.branch.name}` : ''} · {fmtTime(s.created_at)}
                </span>
              </div>
              {sum.names.length > 0 && (
                <p className="text-xs text-gray-600 mt-1.5 break-words">
                  Món: {sum.names.join(', ')}{sum.more ? ', ...' : ''}
                </p>
              )}
              {s.detail && <p className="text-sm text-gray-700 mt-1.5 break-words">{s.detail}</p>}

              {s.status === 'pending' && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {s.reason === 'unknown_product' && (
                    <button className={btnGhost} onClick={() => goTab('products')}>Đi map món</button>
                  )}
                  {(s.reason === 'unknown_option' || s.reason === 'missing_required_option') && (
                    <button className={btnGhost} onClick={() => goTab('options')}>Đi map tùy chọn</button>
                  )}
                  {s.reason === 'possible_duplicate' && (
                    <button className={btnPrimary} disabled={busyId === s.id}
                      onClick={() => { if (confirm('Xác nhận đây là đơn mới thật (không phải đơn DBOMNI bị quên chọn kênh)? Hệ thống sẽ tạo đơn và trừ kho.')) act(s.id, 'force-create'); }}>
                      Xác nhận đơn mới — tạo đơn
                    </button>
                  )}
                  <button className={btnGhost + ' py-2.5'} disabled={busyId === s.id} onClick={() => act(s.id, 'rerun')}>
                    {busyId === s.id ? 'Đang chạy...' : 'Chạy lại'}
                  </button>
                  <button className={btnGhost + ' py-2.5 text-red-600'} onClick={() => { setDiscarding(s); setNote(''); }}>
                    Bỏ qua
                  </button>
                </div>
              )}

              {s.status !== 'pending' && (
                <p className="text-xs text-gray-500 mt-2">
                  {s.status === 'resolved' ? 'Đã xử lý' : 'Đã bỏ qua'}
                  {s.resolved_by ? ` bởi ${s.resolved_by.name}` : ''} · {fmtTime(s.resolved_at)}
                  {s.resolution ? ` — ${s.resolution}` : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {discarding && (
        <PickModal title={'Bỏ qua hóa đơn ' + discarding.sapo_invoice_code} onClose={() => setDiscarding(null)}>
          <p className="text-sm text-gray-600 mb-3">Hóa đơn này sẽ không được import. Ghi lý do để đối soát sau này.</p>
          <input className={inputCls + ' mb-3'} placeholder="Lý do bỏ qua (VD: đúng là đơn trùng)..." value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <button className={btnPrimary + ' flex-1'} disabled={busyId === discarding.id}
              onClick={() => act(discarding.id, 'discard', { resolution: note || undefined })}>
              Xác nhận bỏ qua
            </button>
            <button className={btnGhost + ' py-2.5'} onClick={() => setDiscarding(null)}>Hủy</button>
          </div>
        </PickModal>
      )}
    </div>
  );
}

// ---------------- Phần C: hộp thư IMAP ----------------
function ImapCard({ onChecked }) {
  const [im, setIm] = useState({ host: '', port: 993, encryption: 'ssl', user: '', folder: 'INBOX', password_set: false });
  const [pw, setPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      try { setIm(await api('/sapo/mail/config')); }
      catch (e) { /* giữ rỗng */ }
    })();
  }, []);

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      await api('/sapo/mail/config', { method: 'put', data: { ...im, port: Number(im.port), password: pw || null } });
      setPw('');
      setIm({ ...im, password_set: true });
      setMsg('Đã lưu.');
    } catch (e) { setMsg(e.response?.data?.message || e.message); }
    finally { setSaving(false); }
  };

  const checkNow = async () => {
    setChecking(true); setMsg('');
    try {
      const r = await axios.post(API + '/sapo/mail/check-now');
      setMsg(r.data?.message || 'Đã kiểm tra.');
    } catch (e) { setMsg(e.response?.data?.message || e.message); }
    finally { setChecking(false); if (onChecked) onChecked(); }
  };

  return (
    <div className="bg-white rounded-xl border p-4">
      <h2 className="font-bold mb-1">Hộp thư IMAP (tự import qua mail)</h2>
      <p className="text-xs text-gray-500 mb-3">1 hộp mail chung cho mọi chi nhánh. Hệ thống tự quét lúc 13:00 / 21:30 / 23:00, nhận diện chi nhánh qua anchor text của link tải trong mail. Mật khẩu được mã hóa khi lưu, không hiển thị lại.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm mb-1">IMAP host</label>
          <input className={inputCls} placeholder="imap.gmail.com" value={im.host} onChange={(e) => setIm({ ...im, host: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">Port</label>
            <input type="number" className={inputCls} value={im.port} onChange={(e) => setIm({ ...im, port: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm mb-1">Mã hóa</label>
            <select className={inputCls} value={im.encryption} onChange={(e) => setIm({ ...im, encryption: e.target.value })}>
              <option value="ssl">SSL (993)</option>
              <option value="starttls">STARTTLS (143)</option>
              <option value="none">Không (143)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm mb-1">Tài khoản (email)</label>
          <input className={inputCls} autoComplete="off" value={im.user} onChange={(e) => setIm({ ...im, user: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm mb-1">Mật khẩu {im.password_set && <span className="text-gray-400">(đã lưu — để trống nếu giữ nguyên)</span>}</label>
          <input type="password" className={inputCls} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={im.password_set ? '••••••••' : ''} />
        </div>
        <div>
          <label className="block text-sm mb-1">Thư mục hộp thư</label>
          <input className={inputCls} value={im.folder} onChange={(e) => setIm({ ...im, folder: e.target.value })} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button className={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu hộp thư'}</button>
        <button className={btnGhost + ' py-2.5'} onClick={checkNow} disabled={checking}>{checking ? 'Đang quét mail...' : 'Kiểm tra mail ngay'}</button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </div>
  );
}

const MAIL_STATUS_LABEL = {
  imported: 'Đã import',
  anchor_unmatched: 'Anchor không khớp',
  expired: 'Link hết hạn',
  no_link: 'Không có link tải',
  no_mail: 'Chưa thấy mail',
  error: 'Lỗi',
};

function MailLogs({ refreshKey }) {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    (async () => {
      try { setLogs(await api('/sapo/mail/logs')); }
      catch (e) { /* bỏ qua */ }
    })();
  }, [refreshKey]);

  return (
    <div className="bg-white rounded-xl border p-4">
      <h2 className="font-bold mb-3">Nhật ký mail & cảnh báo</h2>
      {logs.length === 0 && <p className="text-sm text-gray-400">Chưa có bản ghi nào.</p>}
      <div className="divide-y max-h-80 overflow-y-auto">
        {logs.map((l) => (
          <div key={l.id} className="py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${l.status === 'imported' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {MAIL_STATUS_LABEL[l.status] || l.status}
              </span>
              <span className="font-medium break-words">{l.subject || '(cảnh báo hệ thống)'}</span>
              {l.branch && <span className="text-xs text-gray-500">CN: {l.branch.name}</span>}
              <span className="text-xs text-gray-400">{l.created_at ? new Date(l.created_at).toLocaleString('vi-VN') : ''}</span>
            </div>
            {l.detail && <p className="text-xs text-gray-600 mt-1 break-words">{l.detail}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Bảng map dùng chung (thêm/xóa) ----------------
function MapRows({ table, title, hint, keyLabel, valueLabel, keyType = 'text', keyOptions = [], valueType = 'text', valueOptions = [], hideValue = false }) {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [nk, setNk] = useState('');
  const [nv, setNv] = useState(valueType === 'select' ? String(valueOptions[0]?.value ?? '') : '');

  const load = async () => {
    try { setRows(await api(`/sapo/maps/${table}?q=` + encodeURIComponent(q))); }
    catch (e) { /* bỏ qua */ }
  };
  useEffect(() => { load(); }, [table]);

  const add = async () => {
    if (!nk.trim() || String(nv).trim() === '') { alert('Nhập đủ 2 ô.'); return; }
    const keyField = { aliases: 'field', channels: 'sapo_text', payments: 'sapo_text', anchors: 'anchor_text', sizes: 'keyword' }[table];
    const valField = { aliases: 'alias', channels: 'channel_code', payments: 'payment_method', anchors: 'branch_id', sizes: 'size_label' }[table];
    try {
      await api(`/sapo/maps/${table}`, { method: 'post', data: { [keyField]: nk.trim(), [valField]: nv } });
      setNk(''); setNv(valueType === 'select' ? String(valueOptions[0]?.value ?? '') : '');
      load();
    } catch (e) { alert(e.response?.data?.message || e.message); }
  };
  const remove = async (id) => {
    if (!confirm('Xóa dòng này?')) return;
    await api(`/sapo/maps/${table}/${id}`, { method: 'delete' });
    load();
  };

  const valLabel = (r) => {
    if (valueType === 'select') return (valueOptions.find((o) => String(o.value) === String(r[{ aliases: 'alias', channels: 'channel_code', payments: 'payment_method', anchors: 'branch_id', sizes: 'size_label' }[table]]))?.label) || r[{ aliases: 'alias', channels: 'channel_code', payments: 'payment_method', anchors: 'branch_id', sizes: 'size_label' }[table]];
    return r[{ aliases: 'alias', channels: 'channel_code', payments: 'payment_method', anchors: 'branch_id', sizes: 'size_label' }[table]];
  };
  const keyLabelOf = (r) => {
    const kf = { aliases: 'field', channels: 'sapo_text', payments: 'sapo_text', anchors: 'anchor_text', sizes: 'keyword' }[table];
    if (table === 'aliases') return r.field;
    if (table === 'anchors') return r.anchor_text + (r.branch ? ` → ${r.branch.name}` : '');
    return r[kf];
  };

  return (
    <div className="bg-white rounded-xl border p-4">
      <h2 className="font-bold mb-1">{title} <span className="text-sm font-normal text-gray-500">({rows.length})</span></h2>
      {hint && <p className="text-xs text-gray-500 mb-3">{hint}</p>}
      <div className="flex flex-col md:flex-row gap-2 mb-3">
        {keyType === 'select' ? (
          <select className={inputCls + ' md:w-1/3'} value={nk} onChange={(e) => setNk(e.target.value)}>
            <option value="">— {keyLabel} —</option>
            {keyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input className={inputCls + ' md:w-1/3'} placeholder={keyLabel} value={nk} onChange={(e) => setNk(e.target.value)} />
        )}
        {valueType === 'select' ? (
          <select className={inputCls + ' md:flex-1'} value={nv} onChange={(e) => setNv(e.target.value)}>
            {valueOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input className={inputCls + ' md:flex-1'} placeholder={valueLabel} value={nv} onChange={(e) => setNv(e.target.value)} />
        )}
        <button className={btnPrimary + ' md:w-auto w-full'} onClick={add}>Thêm</button>
      </div>
      <input className={inputCls + ' mb-2'} placeholder="Tìm..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
      <div className="divide-y max-h-72 overflow-y-auto">
        {rows.map((r) => (
          <div key={r.id} className="py-2 flex items-center gap-2">
            <div className="flex-1 min-w-0 text-sm">
              <span className="font-medium break-words">{keyLabelOf(r)}</span>
              {!hideValue && (<><span className="text-gray-400"> → </span><span className="break-words">{valLabel(r)}</span></>)}
            </div>
            <button className={btnGhost + ' text-red-600'} onClick={() => remove(r.id)}>Xóa</button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-gray-400 py-2">Chưa có dữ liệu.</p>}
      </div>
    </div>
  );
}
