// Khớp tên tỉnh/thành + phường/xã CÓ CHUẨN HÓA (2026-11-04, sổ #69).
// Địa chỉ đã lưu trong sổ có thể khác danh mục ở dạng viết tắt ("TP. Hồ Chí
// Minh" vs "Thành phố Hồ Chí Minh"), dấu tiếng Việt hoặc hoa/thường — khớp
// chính xác sẽ trượt, và trượt tỉnh thì phường cũng không nạp được theo.
// findPlaceByName: ưu tiên khớp CHÍNH XÁC trước (giữ nguyên hành vi cũ cho
// dữ liệu đã khớp), chỉ khi trượt mới so trên dạng đã chuẩn hóa của cả 2 phía:
// bỏ dấu · thường hóa · bỏ dấu câu · gấp "thành phố"→"tp", "hcm"→"ho chi
// minh" · bỏ tiền tố loại hành chính (tp/tỉnh/phường/xã/quận/huyện…) để so
// phần lõi. Không đổi dữ liệu đã lưu, không lưu mã tỉnh/phường.

const stripAccents = (s) => String(s || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd')
  .replace(/Đ/g, 'D');
// (dải trên là U+0300–U+036F — dấu tổ hợp sau khi tách NFD)

export function normPlaceName(name) {
  let s = stripAccents(name).toLowerCase();
  s = s.replace(/[.,]/g, ' ');
  s = s.replace(/\btphcm\b/g, 'tp ho chi minh');
  s = s.replace(/\bhcm\b/g, 'ho chi minh');
  s = s.replace(/\bthanh pho\b/g, 'tp');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^(tp|tinh|phuong|xa|quan|huyen|thi xa|thi tran)\s+/, '');
  return s;
}

export function findPlaceByName(list, name) {
  if (!name) return undefined;
  const items = list || [];
  const exact = items.find((it) => it?.name === name);
  if (exact) return exact;
  const target = normPlaceName(name);
  if (!target) return undefined;
  return items.find((it) => normPlaceName(it?.name) === target);
}
