import React, { useState, useEffect } from 'react';
import { rdGet } from './rdApi';
import AdminLayout from '../../components/layout/AdminLayout';
import RdDrafts from './RdDrafts';
import RdFixedCosts from './RdFixedCosts';
import RdBreakEven from './RdBreakEven';

// SPEC R&D (2026-10-21, Đại Vương chốt): trang R&D 3 tab — menu cấp 1 riêng
// (ngoại lệ UI-MAP đã được duyệt). Tab 1 Món nháp · Tab 2 Chi phí cố định · Tab 3 Hòa vốn.
export default function Rd() {
  const [tab, setTab] = useState('drafts');
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    rdGet(`/rd/meta`)
      .then((r) => setMeta(r.data?.data || null))
      .catch((e) => setErr(e.response?.data?.message || 'Không tải được dữ liệu R&D.'));
  }, []);

  const tabBtn = (key, label) => (
    <button onClick={() => setTab(key)}
      className="px-4 py-2 text-sm font-semibold whitespace-nowrap"
      style={{
        color: tab === key ? 'var(--m-primary)' : 'var(--m-ink-soft)',
        borderBottom: tab === key ? '2px solid var(--m-primary)' : '2px solid transparent',
        marginBottom: -2,
      }}>
      {label}
    </button>
  );

  return (
    <AdminLayout>
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="mb-4">
          <h1 className="text-xl font-bold" style={{ color: 'var(--m-ink)' }}>R&D & Hòa vốn</h1>
          <p className="text-sm" style={{ color: 'var(--m-ink-soft)' }}>
            Nghiên cứu món mới ở dạng nháp (không ảnh hưởng món đang bán), quản lý chi phí cố định và tính điểm hòa vốn từ số bán thật.
          </p>
        </div>

        <div className="flex gap-1 mb-4 overflow-x-auto no-scrollbar" style={{ borderBottom: '2px solid var(--m-line)' }}>
          {tabBtn('drafts', 'Món nháp')}
          {tabBtn('fixed', 'Chi phí cố định')}
          {tabBtn('breakeven', 'Hòa vốn')}
        </div>

        {err && <div className="m-card p-4 text-sm" style={{ color: 'var(--m-danger)' }}>{err}</div>}
        {!meta && !err && <div className="p-8 text-center text-sm" style={{ color: 'var(--m-ink-faint)' }}>Đang tải...</div>}
        {meta && tab === 'drafts' && <RdDrafts meta={meta} />}
        {meta && tab === 'fixed' && <RdFixedCosts meta={meta} />}
        {meta && tab === 'breakeven' && <RdBreakEven meta={meta} />}
      </div>
    </AdminLayout>
  );
}
