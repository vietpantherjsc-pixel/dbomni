import React, { useState, useEffect, useRef } from 'react';
import { fmtDate, toApiDate } from '../utils/format';

// Gói 36d: ô nhập ngày dd/mm/yyyy — viết lại để KHÔNG BAO GIỜ kẹt.
// Nguyên nhân bản cũ: state text + useEffect đồng bộ từ parent đánh nhau khi
// sửa giữa chuỗi, mask vị trí cứng (2-2-4) làm hỏng khi gõ "1/2/2026".
// Bản mới:
// - value/onChange: chuỗi "yyyy-mm-dd" (giữ nguyên để gửi API).
// - Đang focus: không ép đồng bộ từ parent → gõ/sửa tự do.
// - Tôn trọng dấu "/" người dùng tự gõ ("1/2/2026" vẫn đúng).
// - Blur: chuẩn hóa về dd/mm/yyyy; sai định dạng → hoàn về giá trị đúng gần nhất.
export default function DateInput({ value, onChange, className, placeholder, min, max, ...rest }) {
  const [text, setText] = useState(() => fmtDate(value));
  const focused = useRef(false);
  const lastGood = useRef(fmtDate(value)); // text đúng gần nhất

  // Chỉ đồng bộ từ parent khi KHÔNG focus (mở form, reset từ ngoài...)
  useEffect(() => {
    if (!focused.current) {
      const f = fmtDate(value);
      lastGood.current = f;
      setText(f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const clamp = (api) => {
    if (!api) return api;
    if (min && api < min) return min;
    if (max && api > max) return max;
    return api;
  };

  // Mask thông minh:
  // - Nếu dấu "/" trong chuỗi tạo thành cấu trúc dd/mm/yyyy hợp lệ (mỗi phần ≤ 2/2/4 số)
  //   → tôn trọng cách người dùng gõ ("1/2/2026", "01/8/2026" khi sửa giữa chuỗi).
  // - Ngược lại (VD đang gõ dở "01/022") → mask theo vị trí 2-2-4 trên dãy số.
  const mask = (raw) => {
    const clean = String(raw).replace(/[^\d/]/g, '');
    if (clean.includes('/')) {
      const parts = clean.split('/').slice(0, 3);
      const lim = [2, 2, 4];
      if (parts.every((p, i) => /^\d*$/.test(p) && p.length <= lim[i])) {
        return parts.join('/');
      }
    }
    const d = clean.replace(/\D/g, '').slice(0, 8);
    if (d.length > 4) return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
    if (d.length > 2) return d.slice(0, 2) + '/' + d.slice(2);
    return d;
  };

  const handleChange = (e) => {
    const out = mask(e.target.value);
    setText(out);
    const api = toApiDate(out);
    if (api) {
      lastGood.current = out;
      onChange(clamp(api));
    }
  };

  const handleBlur = () => {
    focused.current = false;
    const api = toApiDate(text);
    if (api) {
      const f = fmtDate(api);
      lastGood.current = f;
      setText(f);
      onChange(clamp(api));
    } else if (text.trim() === '') {
      lastGood.current = '';
      setText('');
      onChange('');
    } else {
      // Sai định dạng → hoàn về giá trị đúng gần nhất, không bao giờ kẹt
      setText(lastGood.current);
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={placeholder || 'dd/mm/yyyy'}
      maxLength={10}
      value={text}
      onChange={handleChange}
      onFocus={() => { focused.current = true; }}
      onBlur={handleBlur}
      className={className}
      {...rest}
    />
  );
}
