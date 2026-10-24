import { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from './api';

// Spec danh mục dùng chung (Đại Vương chốt 2026-10-19):
// Hook đọc 1 nhóm danh mục từ API, có fallback cứng để UI không bao giờ trắng
// khi API lỗi hoặc migration chưa chạy. Trả về [{code, name}].
export function useSharedCategories(group, fallback = []) {
  const [items, setItems] = useState(fallback);
  useEffect(() => {
    let alive = true;
    axios.get(`${API}/shared-categories`, { params: { group } })
      .then((r) => {
        const d = r.data?.data;
        if (alive && Array.isArray(d) && d.length > 0) setItems(d);
      })
      .catch(() => { /* giữ fallback */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);
  return items;
}

// Dựng map code -> name từ items, merge fallback (fallback chỉ lấp chỗ thiếu)
export function labelMap(items, fallbackObj = {}) {
  const m = { ...fallbackObj };
  for (const it of (items || [])) {
    if (it && it.code != null) m[it.code] = it.name || m[it.code] || it.code;
  }
  return m;
}
