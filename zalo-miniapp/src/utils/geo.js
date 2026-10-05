// Gói 6: Geocode địa chỉ bằng OpenStreetMap (miễn phí, không cần key)
// + Haversine tính khoảng cách + phí ship theo cấu hình quán.
export async function geocodeAddress(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=vn&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const data = await res.json();
  if (!data || data.length === 0) throw new Error('Không tìm thấy địa chỉ. Hãy thử ghi rõ hơn (số nhà, đường, quận).');
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name };
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
