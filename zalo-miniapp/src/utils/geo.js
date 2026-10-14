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
