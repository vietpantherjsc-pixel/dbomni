import React, { useState, useEffect } from 'react';
import DateInput from './DateInput';
import TimeInput, { valid24 } from './TimeInput';

// Gói 36: ô nhập ngày-giờ dùng chung — thay <input type="datetime-local">
// vì trình duyệt hiển thị theo locale Windows, không ép được.
// value/onChange: chuỗi "yyyy-mm-ddTHH:MM" (giữ nguyên để gửi API).
// Rỗng → ''. Có ngày mà chưa có giờ (hoặc giờ gõ dở) → mặc định '00:00'.
// className được gắn cho ô ngày (input); ô giờ có chiều rộng cố định.
const split = (v) => {
  const s = String(v || '');
  const i = s.indexOf('T');
  if (i < 0) return { d: s, t: '' };
  return { d: s.slice(0, i), t: s.slice(i + 1) };
};

export default function DateTimeInput({ value, onChange, className, disabled, ...rest }) {
  const [datePart, setDatePart] = useState(() => split(value).d);
  const [timePart, setTimePart] = useState(() => split(value).t);

  useEffect(() => {
    const p = split(value);
    setDatePart(p.d);
    setTimePart(p.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (d, t) => {
    if (!d) {
      onChange('');
      return;
    }
    onChange(d + 'T' + (valid24(t) ? t : '00:00'));
  };

  const onDate = (d) => {
    setDatePart(d);
    emit(d, timePart);
  };

  const onTime = (t) => {
    setTimePart(t);
    emit(datePart, t);
  };

  return (
    <div className="flex gap-2">
      <DateInput
        value={datePart}
        onChange={onDate}
        disabled={disabled}
        className={`${className || ''} flex-1 min-w-0`}
        {...rest}
      />
      <TimeInput
        value={timePart}
        onChange={onTime}
        disabled={disabled}
        className="m-input w-[76px] shrink-0"
      />
    </div>
  );
}
