// Spec định mức chọn đơn vị quy đổi (2026-11-05) — helper dùng chung cho 4
// trình sửa định mức ở Admin (Products · OptionGroups · Inventory BTP · RdDrafts).
// SERVER là nơi quy đổi duy nhất: client chỉ gửi số HIỂN THỊ + đơn vị đã chọn
// (+ bộ ba orig_* chống trôi), không tự nhân hệ số rồi gửi số cơ sở.
//
// Nghĩa hệ số (factor): 1 đơn vị hiển thị = factor đơn vị cơ sở
// (VD Cà Phê Bột: Gram = 0,001 Kg). Payload /materials trả `conversion_rate`
// (DB factor); payload optionRecipes/RD meta trả `factor` — helper chấp cả hai.

// Hệ số của 1 đơn vị trong danh sách units (cơ sở = 1).
export function unitFactor(u) {
  if (!u) return 1;
  const f = Number(u.factor ?? u.conversion_rate ?? 1);
  return Number.isFinite(f) && f > 0 ? f : 1;
}

// Danh sách đơn vị chọn được của 1 nguyên liệu: cơ sở trước (hệ số 1) rồi
// từng đơn vị quy đổi. Trả [{name, factor}].
export function unitsFor(material) {
  if (!material) return [];
  const base = { name: material.unit || '', factor: 1 };
  const extra = (material.units || [])
    .filter((u) => u.unit_name && u.unit_name !== material.unit)
    .map((u) => ({ name: u.unit_name, factor: unitFactor(u) }));
  return [base, ...extra];
}

export function factorOf(material, unitName) {
  return unitsFor(material).find((u) => u.name === unitName)?.factor ?? 1;
}

// Làm tròn 6 số lẻ (độ mịn đọc, spec 1.3).
export function round6(n) {
  const v = Math.round(Number(n) * 1e6) / 1e6;
  return Object.is(v, -0) ? 0 : v;
}

// Cắt số 0 thừa khi trình bày (200.000000 → "200", 0.00004 → "0.00004").
export function trimNum(n) {
  if (n === '' || n === null || n === undefined) return '';
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return String(round6(v));
}

// Đổi đơn vị trong lúc nhập: giữ nguyên lượng thật, chỉ đổi cách đọc
// (số đang nhập ÷ hệ số cũ × hệ số mới).
export function convertDisplay(qty, fromFactor, toFactor) {
  return round6((Number(qty) || 0) * (fromFactor || 1) / (toFactor || 1));
}

// Số cơ sở từ số hiển thị (để tính giá vốn trực tiếp ở client, vd RdDrafts).
export function baseQtyOf(displayQty, factor) {
  return (Number(displayQty) || 0) * (factor || 1);
}

// Spec 1.4 — đơn vị hiển thị đã bị xóa khỏi danh mục (MaterialController
// update + bulk import đều xóa-hết-tạo-lại units): bản chụp rơi về hiển thị
// cơ sở (số cơ sở + đơn vị cơ sở). Trả {displayQty, displayUnitName}.
// GHI CHÚ: chỉ đổi PHẦN HIỂN THỊ — orig_* giữ nguyên ở lineFromServer để
// server nhánh (b) xóa chụp khi lưu (xem TESTER verdict tĩnh 2026-11-05).
export function snapshotDisplay(displayQty, displayUnitName, baseQty, material) {
  const baseName = material?.unit || '';
  const snapUnit = displayUnitName || '';
  const alive = snapUnit === '' || snapUnit === baseName
    || unitsFor(material).some((u) => u.name === snapUnit);
  if (alive) {
    return {
      displayQty: displayQty !== undefined && displayQty !== null ? trimNum(displayQty) : trimNum(baseQty),
      displayUnitName: snapUnit || baseName,
    };
  }
  return { displayQty: trimNum(baseQty), displayUnitName: baseName };
}

// Dựng 1 dòng định mức từ dữ liệu server trả (mở form sửa). Dòng cũ chưa có
// bản chụp → hiển thị cơ sở như hiện tại, orig_* = số cơ sở đã lưu.
export function lineFromServer(r, material) {
  const d = snapshotDisplay(r.display_qty, r.display_unit_name, r.quantity, material);
  return {
    material_id: r.material_id ? String(r.material_id) : '',
    display_qty: d.displayQty,
    display_unit_name: d.displayUnitName,
    orig_quantity: r.quantity ?? null,
    orig_display_unit_name: r.display_unit_name ?? null,
    orig_display_factor: r.display_factor ?? null,
  };
}

// Dòng mới trống (mặc định đơn vị cơ sở — spec 2.1).
export function emptyLine(extra = {}) {
  return {
    material_id: '', display_qty: '', display_unit_name: '',
    orig_quantity: null, orig_display_unit_name: null, orig_display_factor: null,
    ...extra,
  };
}

// Payload lưu 1 dòng: chỉ số hiển thị + đơn vị + bộ ba orig_* (KHÔNG gửi quantity).
export function lineToPayload(l, extra = {}) {
  return {
    ...extra,
    display_qty: Number(l.display_qty),
    display_unit_name: l.display_unit_name || null,
    orig_quantity: l.orig_quantity ?? null,
    orig_display_unit_name: l.orig_display_unit_name ?? null,
    orig_display_factor: l.orig_display_factor ?? null,
  };
}
