import React from 'react';
// Bộ icon 4 hạng thành viên V2 (Đại Vương chốt 2026-11-14; asset gốc:
// dbomni-promotion/icons-hang-daybreak/) — bản Admin/POS, cùng quy ước
// với bản Mini App (zalo-miniapp/src/components/TierIcon.jsx): chỉ nạp
// bản -512, biến thể thường cho bề mặt sáng, -navy cho bề mặt đậm/tối.
// Đây là icon HẠNG — logo quán dùng nguyên bản riêng, không liên quan.
import banMai from '../assets/tier-ban-mai-v2-512.png';
import nangMai from '../assets/tier-nang-mai-v2-512.png';
import binhMinh from '../assets/tier-binh-minh-v2-512.png';
import rangDong from '../assets/tier-rang-dong-v2-512.png';
import banMaiNavy from '../assets/tier-ban-mai-v2-navy-512.png';
import nangMaiNavy from '../assets/tier-nang-mai-v2-navy-512.png';
import binhMinhNavy from '../assets/tier-binh-minh-v2-navy-512.png';
import rangDongNavy from '../assets/tier-rang-dong-v2-navy-512.png';

const ICONS = {
  ban_mai: { light: banMai, navy: banMaiNavy },
  nang_mai: { light: nangMai, navy: nangMaiNavy },
  binh_minh: { light: binhMinh, navy: binhMinhNavy },
  rang_dong: { light: rangDong, navy: rangDongNavy },
};

// Ánh xạ linh hoạt: mã hạng (ban_mai / ban-mai) hoặc tên hiển thị
// ("Ban Mai") đều khớp. Không khớp → null (không hiện icon).
export function tierIconSrc(tier, navy = false) {
  if (!tier) return null;
  const key = String(tier).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[\s-]+/g, '_');
  const pair = ICONS[key];
  return pair ? (navy ? pair.navy : pair.light) : null;
}

export default function TierIcon({ tier, navy = false, size = 18, style, className }) {
  const src = tierIconSrc(tier, navy);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
    />
  );
}
