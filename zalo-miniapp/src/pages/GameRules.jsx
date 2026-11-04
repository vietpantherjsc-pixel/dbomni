import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmt, getProfile, profileIdentity } from '../api';

// Thể lệ minigame "Hứng Trân Châu" (2026-11-01, mục 11 của spec) — số liệu
// mốc/trần đọc từ API state để Admin đổi cấu hình là thể lệ đổi theo.
export default function GameRules() {
  const nav = useNavigate();
  const [state, setState] = useState(null);
  useEffect(() => {
    api.minigameState(profileIdentity(getProfile())).then(setState).catch(() => setState(null));
  }, []);

  const tiers = state?.tiers || [];
  const mission = state?.mission;
  const playsTxt = state?.daily_plays ? fmt(state.daily_plays) : '3';

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 16px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' }}>
        <button onClick={() => nav(-1)} style={{ background: 'none', border: 0, color: '#24305E', fontWeight: 700, minHeight: 44, fontSize: 15 }}>‹ Quay lại</button>
        <div style={{ fontWeight: 800, fontSize: 16, color: '#24305E' }}>📜 Thể lệ — Hứng Trân Châu</div>
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.65, color: '#333A4D' }}>
        <p><b>1. Điều kiện chơi.</b> Mọi tài khoản thành viên Daybreak đều được chơi miễn phí, không cần mua hàng. Game chạy thường trú trên Mini App Daybreak (mục Tài khoản), quán có thể tạm dừng để bảo trì bằng cách tắt chương trình.</p>
        <p><b>2. Lượt chơi có thưởng.</b> Mỗi tài khoản được cấp {playsTxt} lượt chơi có thưởng mỗi ngày. Lượt được tính ngay khi phiên chơi bắt đầu — thoát giữa chừng (kể cả ẩn app) phiên sẽ hủy, không tính thưởng và lượt không được hoàn lại.</p>
        <p><b>3. Cách chơi.</b> Kéo ly hứng các nguyên liệu rơi trong {state?.game?.duration_seconds || 45} giây: trân châu, lá trà, hạt cà phê và mặt trời Daybreak cộng điểm; hứng hạt cháy bị trừ điểm; hụt {state?.game?.max_misses || 3} nguyên liệu tốt thì phiên kết thúc sớm.</p>
        <p><b>4. Mốc thưởng.</b> Mỗi phiên chỉ nhận mốc cao nhất đạt được:</p>
        <ul style={{ margin: '4px 0 8px', paddingLeft: 20 }}>
          {tiers.map((t, i) => <li key={i}>Đạt {fmt(t.score)} điểm → +{fmt(t.points)} điểm thành viên</li>)}
          {mission && <li>Nhiệm vụ ngày: có 1 phiên đạt {fmt(mission.score)} điểm → +{fmt(mission.points)} điểm (1 lần/ngày)</li>}
        </ul>
        <p>Tổng điểm game mỗi tài khoản tối đa {state ? fmt(state.daily_cap_points) : 15} điểm/ngày. Kết quả được hệ thống xác nhận lại trước khi cộng điểm.</p>
        <p><b>5. Về điểm thưởng.</b> Điểm game là điểm thành viên Daybreak như điểm tích từ mua hàng: dùng đổi coupon tại Cửa hàng điểm trong trang Tài khoản theo điều lệ Loyalty. Điểm <b>không quy đổi thành tiền mặt, không chuyển nhượng, không mua bán</b>. Điểm từ game không tính vào chi tiêu xét hạng thành viên.</p>
        <p><b>6. Chế độ giải trí.</b> Ngoài lượt có thưởng, bạn có thể chơi giải trí không giới hạn — chế độ này không cộng điểm thành viên, chỉ lưu kỷ lục cá nhân của chính bạn.</p>
        <p><b>7. Gian lận.</b> Khi phát hiện hành vi gian lận (can thiệp kết quả, dùng công cụ tự động…), quán có quyền không cộng điểm hoặc thu hồi điểm của phiên gian lận và khóa quyền chơi có thưởng của tài khoản đó.</p>
      </div>
    </div>
  );
}
