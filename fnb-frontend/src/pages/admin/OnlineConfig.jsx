import React, { useEffect, useState } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

// Gói 6 (2026-10-05): Cấu hình bán online — phí ship + tọa độ chi nhánh (để Mini App tính khoảng cách).
// Gói 10: bọc AdminLayout để có sidebar (trước đây bị mất).
// Dùng axios như các trang admin khác (đã gắn sẵn token qua AuthContext).
const api = async (path, opts = {}) => {
  const r = await axios({ url: `http://localhost/api${path}`, ...opts });
  if (!r.data?.success) throw new Error(r.data?.message || 'Lỗi');
  return r.data.data;
};

export default function OnlineConfig() {
  const [ship, setShip] = useState({ ship_base_fee: '20000', ship_base_km: '2', ship_per_km: '6000' });
  // Gói 9: cover trang chủ Mini App + điểm thưởng giới thiệu
  const [cover, setCover] = useState('');
  const [refPoints, setRefPoints] = useState('100');
  const [savingCover, setSavingCover] = useState(false);
  const [uploading, setUploading] = useState(null); // Gói 10f: 'common' | branchId | null
  const [branches, setBranches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newB, setNewB] = useState({ code: '', name: '', phone: '', address: '', latitude: '', longitude: '' });

  const load = async () => {
    try {
      const cfg = await axios.get('http://localhost/api/online/ship-config');
      if (cfg.data?.success) setShip({ ship_base_fee: String(cfg.data.data.base_fee), ship_base_km: String(cfg.data.data.base_km), ship_per_km: String(cfg.data.data.per_km) });
    } catch (e) { /* bỏ qua */ }
    try {
      setBranches(await api('/branches'));
    } catch (e) {
      alert('Không tải được danh sách chi nhánh: ' + (e.response?.data?.message || e.message));
    }
    // Gói 9: nạp cover + điểm thưởng giới thiệu
    try {
      const s = await axios.get('http://localhost/api/settings');
      if (s.data) {
        setCover(s.data.shop_cover_url || '');
        setRefPoints(String(s.data.ref_bonus_points ?? '100'));
      }
    } catch (e) { /* bỏ qua */ }
  };
  useEffect(() => { load(); }, []);

  const saveShip = async () => {
    setSaving(true);
    try {
      await api('/settings', { method: 'post', data: { settings: ship } });
      alert('Đã lưu cấu hình phí ship.');
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const saveCover = async () => {
    setSavingCover(true);
    try {
      await api('/settings', { method: 'post', data: { settings: { shop_cover_url: cover, ref_bonus_points: refPoints } } });
      alert('Đã lưu.');
    } catch (e) { alert(e.message); }
    finally { setSavingCover(false); }
  };

  // Gói 10f: tải ảnh cover lên server (jpg/png/webp <= 1MB, tự crop 1200x500).
  // branchId null => cover chung; có branchId => cover riêng chi nhánh (lưu ngay).
  const uploadCover = async (file, branchId) => {
    if (!file) return;
    const okTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!okTypes.includes(file.type)) { alert('Chỉ nhận file jpg/png/webp.'); return; }
    if (file.size > 1024 * 1024) { alert('File tối đa 1MB.'); return; }
    setUploading(branchId || 'common');
    try {
      const fd = new FormData();
      fd.append('image', file);
      if (branchId) fd.append('branch_id', branchId);
      const res = await axios.post('http://localhost/api/uploads/cover', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = res.data?.data?.url;
      if (!url) throw new Error('Upload thất bại');
      if (branchId) {
        setB(branchId, 'cover_url', url);
        alert('Đã tải cover riêng cho chi nhánh.');
      } else {
        setCover(url);
        alert('Đã tải cover chung.');
      }
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setUploading(null); }
  };

  // Gói 10f: xóa cover riêng -> chi nhánh dùng lại cover chung
  const clearBranchCover = async (b) => {
    if (!confirm(`Xóa cover riêng của "${b.name}" để dùng cover chung?`)) return;
    try {
      await api(`/branches/${b.id}`, { method: 'patch', data: { cover_url: null } });
      setB(b.id, 'cover_url', null);
    } catch (e) { alert(e.message); }
  };

  const saveBranch = async (b) => {
    try {
      await api(`/branches/${b.id}`, {
        method: 'patch',
        data: { address: b.address || '', latitude: b.latitude || null, longitude: b.longitude || null },
      });
      alert(`Đã lưu tọa độ ${b.name}.`);
    } catch (e) { alert(e.message); }
  };

  const setB = (id, k, v) => setBranches((prev) => prev.map((b) => (b.id === id ? { ...b, [k]: v } : b)));

  const createBranch = async () => {
    if (!newB.code.trim() || !newB.name.trim() || !newB.address.trim() || !newB.latitude || !newB.longitude) {
      alert('Nhập đủ: mã, tên, địa chỉ, vĩ độ, kinh độ.');
      return;
    }
    try {
      await api('/branches', { method: 'post', data: newB });
      alert('Đã tạo chi nhánh.');
      setNewB({ code: '', name: '', phone: '', address: '', latitude: '', longitude: '' });
      setShowAdd(false);
      setBranches(await api('/branches'));
    } catch (e) { alert(e.response?.data?.message || e.message); }
  };

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500';

  return (
    <AdminLayout>
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Bán online — Cấu hình</h1>
      <p className="text-sm text-gray-500 mb-6">Phí ship cho Zalo Mini App + tọa độ chi nhánh để tính khoảng cách.</p>

      {/* Gói 9: Cover trang chủ + điểm thưởng giới thiệu */}
      {/* Gói 10f: thêm nút tải ảnh lên (jpg/png/webp <= 1MB, server tự crop 1200x500) */}
      <div className="bg-white rounded-xl border p-5 mb-6">
        <h2 className="font-bold mb-4">🖼️ Trang chủ Mini App</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-600">Ảnh cover chung (mặc định)</label>
            <div className="flex gap-2">
              <input className={inputCls} value={cover} onChange={(e) => setCover(e.target.value)} placeholder="https://.../cover.jpg" />
              <label className={`shrink-0 px-4 py-2 rounded-lg text-sm font-bold cursor-pointer inline-flex items-center ${uploading === 'common' ? 'bg-gray-300 text-gray-500' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                {uploading === 'common' ? 'Đang tải...' : '📤 Tải ảnh lên'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading === 'common'}
                  onChange={(e) => { uploadCover(e.target.files[0], null); e.target.value = ''; }} />
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-1">Chi nhánh nào chưa có cover riêng sẽ dùng ảnh này. File jpg/png/webp ≤ 1MB, tự crop 1200×500.</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600">Điểm thưởng cho người giới thiệu</label>
            <input className={inputCls} type="number" min="0" value={refPoints} onChange={(e) => setRefPoints(e.target.value)} />
            <p className="text-xs text-gray-500 mt-1">Khi người được giới thiệu đặt đơn thành công và được xác nhận, người share link nhận số điểm này.</p>
          </div>
        </div>
        {cover && <img src={cover} alt="cover preview" className="mt-3 rounded-lg w-full max-h-40 object-cover" onError={(e) => { e.target.style.display = 'none'; }} />}
        <button onClick={saveCover} disabled={savingCover} className="mt-4 px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50">
          {savingCover ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>

      <div className="bg-white rounded-xl border p-5 mb-6">
        <h2 className="font-bold mb-4">🚚 Phí giao hàng</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-600">Phí dưới {ship.ship_base_km} km (đ)</label>
            <input className={inputCls} type="number" value={ship.ship_base_fee} onChange={(e) => setShip({ ...ship, ship_base_fee: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600">Số km tính phí gốc</label>
            <input className={inputCls} type="number" step="0.5" value={ship.ship_base_km} onChange={(e) => setShip({ ...ship, ship_base_km: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600">Mỗi km thêm (đ)</label>
            <input className={inputCls} type="number" value={ship.ship_per_km} onChange={(e) => setShip({ ...ship, ship_per_km: e.target.value })} />
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Ví dụ hiện tại: dưới {ship.ship_base_km}km = {Number(ship.ship_base_fee).toLocaleString('vi-VN')}đ,
          mỗi km xa hơn +{Number(ship.ship_per_km).toLocaleString('vi-VN')}đ.
          Phí tự cộng vào món <b>"Phí dịch vụ"</b> trên đơn online.
        </p>
        <button onClick={saveShip} disabled={saving} className="mt-4 px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50">
          {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
        </button>
      </div>

      <div className="bg-white rounded-xl border p-5">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-bold">📍 Tọa độ chi nhánh</h2>
          <button onClick={() => setShowAdd(!showAdd)} className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700">
            {showAdd ? 'Đóng' : '+ Thêm chi nhánh'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Mini App dùng tọa độ này + địa chỉ khách để tính khoảng cách giao hàng.
          Lấy tọa độ: mở Google Maps → bấm vào vị trí quán → copy 2 số (vĩ độ, kinh độ), ví dụ: 10.8231, 106.6297.
        </p>
        {showAdd && (
          <div className="border-2 border-dashed border-green-300 rounded-lg p-4 mb-4 bg-green-50/50">
            <div className="font-bold mb-3 text-sm">Chi nhánh mới</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-600">Mã chi nhánh *</label>
                <input className={inputCls} value={newB.code} onChange={(e) => setNewB({ ...newB, code: e.target.value })} placeholder="VD: CN-Q2" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Tên chi nhánh *</label>
                <input className={inputCls} value={newB.name} onChange={(e) => setNewB({ ...newB, name: e.target.value })} placeholder="VD: Chi nhánh Quận 2" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-gray-600">Địa chỉ *</label>
                <input className={inputCls} value={newB.address} onChange={(e) => setNewB({ ...newB, address: e.target.value })} placeholder="Số nhà, đường, phường/quận..." />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Số điện thoại</label>
                <input className={inputCls} value={newB.phone} onChange={(e) => setNewB({ ...newB, phone: e.target.value })} placeholder="Hotline chi nhánh" />
              </div>
              <div />
              <div>
                <label className="text-xs font-semibold text-gray-600">Vĩ độ (latitude) *</label>
                <input className={inputCls} type="number" step="0.00000001" value={newB.latitude} onChange={(e) => setNewB({ ...newB, latitude: e.target.value })} placeholder="10.8231" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Kinh độ (longitude) *</label>
                <input className={inputCls} type="number" step="0.00000001" value={newB.longitude} onChange={(e) => setNewB({ ...newB, longitude: e.target.value })} placeholder="106.6297" />
              </div>
            </div>
            <button onClick={createBranch} className="mt-3 px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700">
              Tạo chi nhánh
            </button>
          </div>
        )}
        {branches.map((b) => (
          <div key={b.id} className="border rounded-lg p-4 mb-3">
            <div className="font-bold mb-3">{b.name}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-gray-600">Địa chỉ</label>
                <input className={inputCls} value={b.address || ''} onChange={(e) => setB(b.id, 'address', e.target.value)} placeholder="VD: 123 Đường Số 15, Quận..." />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Vĩ độ (latitude)</label>
                <input className={inputCls} type="number" step="0.0000001" value={b.latitude || ''} onChange={(e) => setB(b.id, 'latitude', e.target.value)} placeholder="10.8231" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Kinh độ (longitude)</label>
                <input className={inputCls} type="number" step="0.0000001" value={b.longitude || ''} onChange={(e) => setB(b.id, 'longitude', e.target.value)} placeholder="106.6297" />
              </div>
              {/* Gói 10f: cover riêng từng chi nhánh (trống = dùng cover chung) */}
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-gray-600">Ảnh cover riêng cho Mini App</label>
                <div className="flex items-center gap-3 mt-1">
                  {b.cover_url
                    ? <img src={b.cover_url} alt="cover" className="h-16 w-40 object-cover rounded-lg border" onError={(e) => { e.target.style.display = 'none'; }} />
                    : <span className="text-xs text-gray-400 italic">Đang dùng cover chung</span>}
                  <label className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer inline-flex items-center ${uploading === b.id ? 'bg-gray-300 text-gray-500' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                    {uploading === b.id ? 'Đang tải...' : '📤 Tải ảnh lên'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading === b.id}
                      onChange={(e) => { uploadCover(e.target.files[0], b.id); e.target.value = ''; }} />
                  </label>
                  {b.cover_url && (
                    <button onClick={() => clearBranchCover(b)} className="text-xs text-red-600 hover:underline">Xóa (dùng cover chung)</button>
                  )}
                </div>
              </div>
            </div>
            <button onClick={() => saveBranch(b)} className="mt-3 px-4 py-1.5 bg-slate-700 text-white rounded-lg text-xs font-bold hover:bg-slate-800">
              Lưu chi nhánh
            </button>
          </div>
        ))}
      </div>
    </div>
    </AdminLayout>
  );
}
