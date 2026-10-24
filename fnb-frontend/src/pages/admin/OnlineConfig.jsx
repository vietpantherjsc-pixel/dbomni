import React, { useEffect, useState } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { API } from '../../utils/api';

// Gói 6 (2026-10-05): Cấu hình bán online — phí ship + tọa độ chi nhánh (để Mini App tính khoảng cách).
// Gói 10: bọc AdminLayout để có sidebar (trước đây bị mất).
// Dùng axios như các trang admin khác (đã gắn sẵn token qua AuthContext).
const api = async (path, opts = {}) => {
  const r = await axios({ url: `${API}${path}`, ...opts });
  if (!r.data?.success) throw new Error(r.data?.message || 'Lỗi');
  return r.data.data;
};

// Gói 50b: backend trả URL tuyệt đối — dùng trực tiếp, fallback ghép host khi còn relative
const imgSrc = (u) => {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return window.location.origin + (u.startsWith('/') ? u : '/' + u);
};

export default function OnlineConfig() {
  const [ship, setShip] = useState({ ship_base_fee: '20000', ship_base_km: '2', ship_per_km: '6000' });
  // Gói 9: cover trang chủ Mini App + điểm thưởng giới thiệu
  const [cover, setCover] = useState('');
  const [refPoints, setRefPoints] = useState('100');
  // Dời từ Thiết lập chung (2026-10-20): banner KM + card Quan tâm OA thuộc cấu hình Mini App
  const [slideInt, setSlideInt] = useState('5');
  const [savingSlide, setSavingSlide] = useState(false);
  const [slideMsg, setSlideMsg] = useState('');
  const [oaCfg, setOaCfg] = useState({ oa_card_enabled: '1', oa_card_headline: 'Quan tâm để nhận các chương trình ưu đãi đặc quyền !' });
  const [oaMsg, setOaMsg] = useState('');
  const [savingCover, setSavingCover] = useState(false);
  const [uploading, setUploading] = useState(null); // Gói 10f: 'common' | branchId | null
  const [branches, setBranches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newB, setNewB] = useState({ code: '', name: '', phone: '', address: '', latitude: '', longitude: '' });

  const load = async () => {
    try {
      const cfg = await axios.get(API + '/online/ship-config');
      if (cfg.data?.success) setShip({ ship_base_fee: String(cfg.data.data.base_fee), ship_base_km: String(cfg.data.data.base_km), ship_per_km: String(cfg.data.data.per_km) });
    } catch (e) { /* bỏ qua */ }
    try {
      setBranches(await api('/branches'));
    } catch (e) {
      alert('Không tải được danh sách chi nhánh: ' + (e.response?.data?.message || e.message));
    }
    // Gói 9: nạp cover + điểm thưởng giới thiệu
    try {
      const s = await axios.get(API + '/settings');
      if (s.data) {
        setCover(s.data.shop_cover_url || '');
        setRefPoints(String(s.data.ref_bonus_points ?? '100'));
        if (s.data.promo_slide_interval) setSlideInt(String(s.data.promo_slide_interval));
        setOaCfg({
          oa_card_enabled: s.data.oa_card_enabled ?? '1',
          oa_card_headline: s.data.oa_card_headline ?? 'Quan tâm để nhận các chương trình ưu đãi đặc quyền !',
        });
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
      const res = await axios.post(API + '/uploads/cover', fd, {
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
      <h1 className="text-xl font-bold mb-1">Zalo Mini App</h1>
      <p className="text-sm text-gray-500 mb-6">Ảnh cover trang chủ cho từng chi nhánh. Thông tin chi nhánh quản lý trong Thiết lập → Chi nhánh.</p>

      {/* Gói SEC: khôi phục cấu hình phí ship (Gói 52 đã xóa JSX) */}
      <div className="bg-white rounded-xl border p-5 mb-6">
        <h2 className="font-bold mb-2">🚚 Phí giao hàng</h2>
        <p className="text-xs text-gray-500 mb-3">Phí cơ bản cho quãng đường trong số km đầu, sau đó tính thêm theo mỗi km.</p>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Phí cơ bản (đ)</label>
            <input type="number" min="0" value={ship.ship_base_fee}
              onChange={(e) => setShip({ ...ship, ship_base_fee: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Số km đầu (km)</label>
            <input type="number" min="0" step="0.5" value={ship.ship_base_km}
              onChange={(e) => setShip({ ...ship, ship_base_km: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Thêm mỗi km (đ)</label>
            <input type="number" min="0" value={ship.ship_per_km}
              onChange={(e) => setShip({ ...ship, ship_per_km: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
        </div>
        <button onClick={saveShip} disabled={saving} className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50">
          {saving ? 'Đang lưu...' : 'Lưu phí ship'}
        </button>
      </div>

      {/* Gói 52: gọn — chỉ tên chi nhánh + upload cover */}
      <div className="bg-white rounded-xl border p-5 mb-6">
        <h2 className="font-bold mb-2">🖼️ Ảnh cover chung</h2>
        <p className="text-xs text-gray-500 mb-3">Chi nhánh nào chưa có cover riêng sẽ dùng ảnh này. File jpg/png/webp ≤ 1MB, tự crop 1200×500.</p>
        <div className="flex gap-2 items-center">
          <label className={`shrink-0 px-4 py-2 rounded-lg text-sm font-bold cursor-pointer inline-flex items-center ${uploading === 'common' ? 'bg-gray-300 text-gray-500' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            {uploading === 'common' ? 'Đang tải...' : '📤 Tải ảnh lên'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading === 'common'}
              onChange={(e) => { uploadCover(e.target.files[0], null); e.target.value = ''; }} />
          </label>
        </div>
        {cover && <img src={imgSrc(cover)} alt="cover preview" className="mt-3 rounded-lg w-full max-h-40 object-cover" onError={(e) => { e.target.style.display = 'none'; }} />}
        <button onClick={saveCover} disabled={savingCover} className="mt-4 px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50">
          {savingCover ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>

      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-bold mb-4">🏪 Cover theo chi nhánh</h2>
        {branches.map((b) => (
          <div key={b.id} className="border rounded-lg p-4 mb-3">
            <div className="font-bold mb-3">{b.name}</div>
            <div className="flex items-center gap-3">
              {b.cover_url
                ? <img src={imgSrc(b.cover_url)} alt="cover" className="h-16 w-40 object-cover rounded-lg border" onError={(e) => { e.target.style.display = 'none'; }} />
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
        ))}
      </div>

      {/* Dời từ Thiết lập chung (2026-10-20): Banner khuyến mại Mini App */}
      <div className="bg-white rounded-xl border p-5 mt-6">
        <h2 className="font-bold mb-2">🎠 Banner khuyến mại (Zalo Mini App)</h2>
        <p className="text-xs text-gray-500 mb-3">Banner hiển thị dạng slider trong mục Thành viên trên Mini App. Tải ảnh banner tại trang Khuyến mại.</p>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm">Tự chuyển ảnh sau mỗi</label>
          <input type="number" min="2" max="30" value={slideInt} onChange={(e) => setSlideInt(e.target.value)}
            className="w-[76px] px-3 py-2 border rounded-lg text-sm text-center" />
          <span className="text-sm text-gray-500">giây</span>
          <button onClick={async () => {
            setSavingSlide(true); setSlideMsg('');
            try {
              await api('/settings', { method: 'post', data: { settings: { promo_slide_interval: slideInt } } });
              setSlideMsg('Đã lưu.');
            } catch (e) { setSlideMsg('Lưu thất bại.'); }
            finally { setSavingSlide(false); }
          }} disabled={savingSlide} className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50">
            {savingSlide ? 'Đang lưu...' : 'Lưu'}
          </button>
          {slideMsg && <span className="text-sm text-green-600">{slideMsg}</span>}
        </div>
      </div>

      {/* Dời từ Thiết lập chung (2026-10-20): Card "Quan tâm OA" trên Home Mini App */}
      <div className="bg-white rounded-xl border p-5 mt-6">
        <h2 className="font-bold mb-2">💛 Card "Quan tâm OA" (Zalo Mini App)</h2>
        <p className="text-xs text-gray-500 mb-3">Card hiện dưới thông tin quán trên trang chủ Mini App. Nút "Quan tâm" màu cam brand mở trang OA Daybreak.</p>
        <div className="flex flex-col gap-4 mb-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={oaCfg.oa_card_enabled === '1'}
              onChange={(e) => setOaCfg({ ...oaCfg, oa_card_enabled: e.target.checked ? '1' : '0' })}
              className="w-5 h-5" />
            <span className="text-sm font-medium">Hiện card "Quan tâm OA"</span>
          </label>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Dòng tiêu đề</label>
            <input type="text" value={oaCfg.oa_card_headline}
              onChange={(e) => setOaCfg({ ...oaCfg, oa_card_headline: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Quan tâm để nhận các chương trình ưu đãi đặc quyền !" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={async () => {
            setOaMsg('');
            try {
              await api('/settings', { method: 'post', data: { settings: oaCfg } });
              setOaMsg('Đã lưu.');
            } catch (e) { setOaMsg('Lưu thất bại.'); }
          }} className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700">Lưu</button>
          {oaMsg && <span className="text-sm text-green-600">{oaMsg}</span>}
        </div>
      </div>
    </div>
    </AdminLayout>
  );
}
