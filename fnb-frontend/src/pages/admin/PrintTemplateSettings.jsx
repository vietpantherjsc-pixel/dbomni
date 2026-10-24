import React, { useEffect, useState } from 'react';
import axios from 'axios';

import { API } from '../../utils/api'; // Gói SEC

// Gói 52: thiết lập mẫu in bill (K80) + tem (50x30) — bật/tắt dòng + sửa nội dung
const BILL_LINES = [
  { k: 'show_logo', label: 'Logo / tên quán' },
  { k: 'show_address', label: 'Địa chỉ quán' },
  { k: 'show_hotline', label: 'Hotline' },
  { k: 'show_qr', label: 'Mã QR tích điểm' },
  { k: 'show_thankyou', label: 'Lời cảm ơn' },
];
const LABEL_LINES = [
  { k: 'label_show_code', label: 'Dòng mã đơn (mã + stt/tổng)' },
  { k: 'label_show_name', label: 'Tên món' },
  { k: 'label_show_opts', label: 'Tùy chọn' },
];

export default function PrintTemplateSettings({ onDirty, onSaved } = {}) {
  const [cfg, setCfg] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get(`${API}/settings`).then((r) => {
      const s = r.data || {}; // Gói SEC: API /settings trả object trần
      const c = {};
      [...BILL_LINES, ...LABEL_LINES].forEach((l) => { c[l.k] = s[l.k] !== '0'; });
      c.thankyou_text = s.thankyou_text || 'Cảm ơn quý khách! Hẹn gặp lại!';
      setCfg(c);
    }).catch(() => {});
  }, []);

  // Audit toàn diện 2026-10-21 🟠5: báo thẻ cha (Settings) mỗi lần đổi để gắn badge "● Chưa lưu"
  const toggle = (k) => { onDirty?.(); setCfg((c) => ({ ...c, [k]: !c[k] })); };

  const save = async () => {
    setSaving(true);
    try {
      const settings = {};
      [...BILL_LINES, ...LABEL_LINES].forEach((l) => { settings[l.k] = cfg[l.k] ? '1' : '0'; });
      settings.thankyou_text = cfg.thankyou_text || '';
      await axios.post(`${API}/settings`, { settings });
      onSaved?.(); // 🟠5: tắt badge "Chưa lưu" ở thẻ cha sau khi lưu thành công
      alert('Đã lưu mẫu in.');
    } catch (e) { alert('Lỗi'); }
    finally { setSaving(false); }
  };

  const Line = ({ l }) => (
    <label className="flex items-center justify-between py-2 border-b border-dashed" style={{ borderColor: 'var(--m-line)' }}>
      <span className="text-[13px]">{l.label}</span>
      <button type="button" onClick={() => toggle(l.k)}
        className="w-10 h-[22px] rounded-full relative transition"
        style={{ background: cfg[l.k] ? '#16a34a' : '#cbd5e1' }}>
        <span className="absolute w-[18px] h-[18px] rounded-full bg-white top-[2px] transition-all"
          style={cfg[l.k] ? { right: 2 } : { left: 2 }} />
      </button>
    </label>
  );

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <h3 className="font-bold text-[13px] mb-2">🧾 Bill (K80)</h3>
        {BILL_LINES.map((l) => <Line key={l.k} l={l} />)}
        <div className="mt-3">
          <label className="text-[12px] text-gray-500">Nội dung lời cảm ơn</label>
          <input value={cfg.thankyou_text || ''} onChange={(e) => { onDirty?.(); setCfg({ ...cfg, thankyou_text: e.target.value }); }}
            className="m-input w-full mt-1" />
        </div>
      </div>
      <div>
        <h3 className="font-bold text-[13px] mb-2">🏷 Tem (50×30)</h3>
        {LABEL_LINES.map((l) => <Line key={l.k} l={l} />)}
      </div>
      <div className="md:col-span-2">
        <button onClick={save} disabled={saving} className="m-btn m-btn-primary text-[13px]">
          {saving ? 'Đang lưu...' : 'Lưu mẫu in'}
        </button>
      </div>
    </div>
  );
}
