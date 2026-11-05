// Gói phiên Hub (2026-11-05): PHIÊN NHÂN VIÊN CHUNG duy nhất của hệ.
// Đại Vương phán 05/11: NV đăng nhập 1 lần duy nhất tại Hub (/nhan-vien),
// chọn chi nhánh ngay lúc đăng nhập; mọi trang con (Kiểm kê · Chế biến ·
// Nhập/Xuất/Chuyển kho · Chờ duyệt · Đăng ký ca · Xin nghỉ · Lỗi 3 Chuyên ·
// Chấm công phần hiển thị) đọc chung 3 khóa này — không còn đăng nhập
// riêng từng trang, không còn khóa phiên đảo riêng (kiemke_*, emp_token…).
// Đổi chi nhánh = đăng xuất rồi đăng nhập lại. Xử lý hết phiên tập trung
// tại Hub (clearStaffSession + về /nhan-vien).

export function getStaffSession() {
  try {
    const token = localStorage.getItem('staff_token') || '';
    const emp = JSON.parse(localStorage.getItem('staff_emp') || 'null');
    const branchId = parseInt(localStorage.getItem('staff_branch_id') || '0', 10) || 0;
    if (!token || !emp) return null;
    return { token, emp, branchId };
  } catch (e) {
    return null;
  }
}

// Điểm bổ sung từ bộ nghiệm thu TESTER (2026-11-05): thiết bị tại quầy
// dùng chung nhiều NV — mỗi lần đăng nhập/đăng xuất tại Hub phải dọn sạch
// toàn bộ khóa phiên trang con của người trước, dù không còn trang nào
// đọc chúng. (emp_token/emp_info là khóa luồng QR của trang Chấm công:
// khi đã có phiên Hub thì trang đó đi theo phiên Hub, không dùng emp_*;
// dọn ở đây không phá luồng QR thuần vì luồng đó chỉ đăng nhập khi máy
// không còn phiên nào.)
const LEGACY_STAFF_KEYS = [
  'kiemke_token', 'kiemke_emp',
  'chebien_token', 'chebien_emp',
  'nhapkho_token', 'nhapkho_emp',
  'xuatkho_token', 'xuatkho_emp',
  'chuyenkho_token', 'chuyenkho_emp',
  'xinnghi_token', 'xinnghi_emp',
  'viol_token', 'viol_emp',
  'emp_token', 'emp_info',
  'staff_hub_t', // khóa cổng QR cũ — hết vai trò
];

export function wipeLegacyStaffKeys() {
  try {
    LEGACY_STAFF_KEYS.forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

export function saveStaffSession(token, emp, branchId) {
  try {
    wipeLegacyStaffKeys(); // phiên mới không để sót khóa của người trước
    localStorage.setItem('staff_token', token);
    localStorage.setItem('staff_emp', JSON.stringify(emp || {}));
    if (branchId) localStorage.setItem('staff_branch_id', String(branchId));
  } catch (e) { /* ignore */ }
}

export function clearStaffSession() {
  try {
    localStorage.removeItem('staff_token');
    localStorage.removeItem('staff_emp');
    localStorage.removeItem('staff_branch_id');
    wipeLegacyStaffKeys();
  } catch (e) { /* ignore */ }
}

// Hết phiên tập trung: xóa phiên chung rồi về màn đăng nhập Hub.
export function staffSessionExpired() {
  clearStaffSession();
  window.location.href = '/nhan-vien';
}

// Tên CN của phiên: tra trong danh sách phân công của NV, rơi về CN chính.
export function staffBranchName(session) {
  if (!session) return '';
  const list = (session.emp && session.emp.branches) || [];
  const b = list.find((x) => (x.id || x) === session.branchId);
  return (b && b.name) || (session.emp && session.emp.branch_name) || '';
}
