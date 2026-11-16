import { api } from '../api';

// Gói 50e: geocode qua backend (Zalo WebView chặn domain lạ).
// Giữ hàm geocodeAddress trực tiếp OSM làm fallback khi test trên trình duyệt.
export async function geocodeAddress(query) {
  try {
    const d = await api.geocode(query);
    if (d && d.lat && d.lng) return { lat: d.lat, lng: d.lng, label: d.label || '' };
    throw new Error('Không tìm thấy địa chỉ.');
  } catch (e) {
    // Fallback: gọi trực tiếp OSM (chỉ chạy tốt trên trình duyệt, không chạy trong Zalo)
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=vn&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      if (!data || data.length === 0) throw new Error('Không tìm thấy địa chỉ. Hãy thử ghi rõ hơn (số nhà, đường, quận).');
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name };
    } catch {
      throw e;
    }
  }
}

// Spec bỏ ghim — tra tọa độ từ địa chỉ chữ (2026-11-12): gọi backend
// geocode BẬC THANG với 3 trường cấu trúc + tọa độ chi nhánh đang chọn.
// Trả {lat, lng, label, ladder_step}; cả thang rỗng → ném lỗi mang
// code 'dropoff_geocode_failed' từ server (KHÔNG rơi về fallback gọi
// thẳng Nominatim như geocodeAddress — đường tra chốt của đơn giao phải
// tôn trọng đúng hợp đồng bậc thang + mã lỗi duy nhất của spec).
export async function geocodeLadder({ q, street, ward, province, branch }) {
  const d = await api.geocode(q, {
    street: street || '',
    ward: ward || '',
    province: province || '',
    branch_lat: branch?.latitude || '',
    branch_lng: branch?.longitude || '',
  });
  if (d && d.lat && d.lng) {
    // Gói geocode lai NDAMaps (2026-11-13 mục 3.2): đáp kèm source —
    // 'nominatim' khi trúng thang, 'ndamaps_forward' khi trúng cứu cánh
    // (ladder_step khi đó là null).
    return { lat: d.lat, lng: d.lng, label: d.label || '', ladder_step: d.ladder_step || null, source: d.source || 'ladder' };
  }
  const err = new Error('Chưa tra được vị trí từ địa chỉ này — kiểm tra lại số nhà / tên đường rồi thử lại.');
  err.code = 'dropoff_geocode_failed';
  throw err;
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function calcShipFee(km, cfg) {
  if (km <= cfg.base_km) return cfg.base_fee;
  return cfg.base_fee + Math.ceil(km - cfg.base_km) * cfg.per_km;
}
