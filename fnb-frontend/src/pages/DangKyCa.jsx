import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API } from '../utils/api'; // Gói 37e: API tương đối — chạy được trên điện thoại (IP LAN)

// Trang đăng ký ca làm việc nhân viên (public, KHÔNG cần đăng nhập admin)
// Bám sát demo đã duyệt: ~/workspace/your_files/demo-dang-ky-ca-nhan-vien.html
// API: /api/employee/*, token NV ở localStorage['emp_token'], header Authorization: Bearer

const NAVY = '#24305E';
const ORANGE = '#F5A623';
const DAY_NAMES = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
const MAX_WEEK_OFFSET = 3;

const CSS = `
.dk-wrap{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;min-height:100vh;background:#f4f5f7;color:#1a1d26;padding-bottom:calc(148px + env(safe-area-inset-bottom));}
.dk-wrap button{font-family:inherit;}
.dk-hd{background:${NAVY};color:#fff;padding:14px 16px;position:sticky;top:0;z-index:20;border-radius:0 0 18px 18px;box-shadow:0 2px 12px rgba(36,48,94,.25);}
.dk-hd-user{display:flex;align-items:center;gap:10px;}
.dk-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;background:${ORANGE};color:${NAVY};font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;}
.dk-name{font-size:15px;font-weight:700;line-height:1.25;}
.dk-branch{font-size:12px;opacity:.75;margin-top:1px;}
.dk-title{font-size:20px;font-weight:800;margin-top:12px;letter-spacing:-.2px;}
.dk-weekbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px 4px;}
.dk-wkbtn{width:44px;height:44px;border-radius:12px;flex-shrink:0;background:#fff;border:1px solid #e8e9ee;font-size:20px;font-weight:700;color:${NAVY};display:flex;align-items:center;justify-content:center;}
.dk-wkbtn:active{transform:scale(.94);}
.dk-wkbtn:disabled{opacity:.3;}
.dk-wklabel{flex:1;text-align:center;background:#fff;border:1px solid #e8e9ee;border-radius:12px;padding:11px 8px;}
.dk-wklabel b{display:block;font-size:15px;color:${NAVY};}
.dk-wklabel span{font-size:11px;color:#6b7280;}
.dk-deadline{margin:10px 16px 0;padding:10px 12px;background:#fff8ec;border:1px solid #f5dfae;border-radius:12px;font-size:13px;color:#8a5a00;font-weight:600;display:flex;align-items:center;gap:8px;}
.dk-privacy{margin:8px 16px 0;padding:10px 12px;background:#eef4ee;border:1px solid #cfe3cf;border-radius:12px;font-size:12.5px;color:#2c5f2d;font-weight:500;display:flex;align-items:center;gap:8px;line-height:1.45;}
.dk-day{background:#fff;border-radius:12px;margin:12px 16px 0;padding:6px 12px 12px;box-shadow:0 1px 3px rgba(16,24,40,.06);}
.dk-dayhead{display:flex;align-items:center;justify-content:space-between;padding:10px 2px 8px;}
.dk-dayname{font-size:15px;font-weight:700;color:${NAVY};}
.dk-dayname small{font-weight:500;color:#6b7280;font-size:13px;margin-left:6px;}
.dk-daycount{font-size:12px;font-weight:700;color:${ORANGE};}
.dk-daycount.zero{color:#6b7280;font-weight:500;}
.dk-shift{display:flex;align-items:center;gap:12px;width:100%;text-align:left;min-height:60px;padding:10px 12px;margin-top:8px;background:#fbfbfc;border:1.5px solid #e8e9ee;border-radius:12px;transition:border-color .15s,background .15s;}
.dk-shift:active{transform:scale(.985);}
.dk-tick{width:26px;height:26px;border-radius:50%;flex-shrink:0;border:2px solid #c9ccd6;background:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#fff;transition:all .15s;}
.dk-sinfo{flex:1;min-width:0;}
.dk-sname{font-size:14.5px;font-weight:700;display:block;}
.dk-stime{font-size:12.5px;color:#6b7280;margin-top:2px;display:block;}
.dk-shift.on{border-color:${ORANGE};background:rgba(36,48,94,.07);}
.dk-shift.on .dk-tick{background:${NAVY};border-color:${NAVY};}
.dk-bottom{position:fixed;left:0;right:0;bottom:0;z-index:30;background:#fff;border-top:1px solid #e8e9ee;padding:12px 16px calc(12px + env(safe-area-inset-bottom));max-width:480px;margin:0 auto;box-shadow:0 -4px 16px rgba(16,24,40,.08);}
.dk-selcount{font-size:14px;font-weight:700;color:${NAVY};margin-bottom:10px;text-align:center;}
.dk-selcount b{color:${ORANGE};font-size:17px;}
.dk-btnrow{display:flex;gap:10px;}
.dk-btn{min-height:50px;border-radius:12px;font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;transition:transform .1s,opacity .15s;}
.dk-btn:active{transform:scale(.97);}
.dk-draft{background:#fff;border:1.5px solid #e8e9ee;color:${NAVY};flex:0 0 38%;}
.dk-send{background:${NAVY};color:#fff;flex:1;}
.dk-send:disabled{opacity:.4;}
.dk-overlay{position:fixed;inset:0;z-index:50;background:#fff;display:flex;align-items:center;justify-content:center;padding:24px;animation:dkfade .25s ease;}
@keyframes dkfade{from{opacity:0;}to{opacity:1;}}
.dk-okbox{text-align:center;max-width:340px;}
.dk-okcircle{width:96px;height:96px;border-radius:50%;margin:0 auto 20px;background:${NAVY};color:#fff;font-size:44px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(36,48,94,.35);animation:dkpop .35s cubic-bezier(.2,1.4,.4,1);}
@keyframes dkpop{from{transform:scale(.5);opacity:0;}to{transform:scale(1);opacity:1;}}
.dk-oktitle{font-size:21px;font-weight:800;color:${NAVY};margin-bottom:8px;}
.dk-okweek{font-size:15px;font-weight:700;color:${ORANGE};margin-bottom:10px;}
.dk-okdesc{font-size:14px;color:#6b7280;line-height:1.55;margin-bottom:24px;}
.dk-done{background:${NAVY};color:#fff;width:100%;min-height:50px;border-radius:12px;font-size:15px;font-weight:700;}
.dk-toast{position:fixed;left:50%;bottom:170px;transform:translateX(-50%) translateY(10px);background:rgba(26,29,38,.92);color:#fff;font-size:13.5px;font-weight:600;padding:11px 18px;border-radius:999px;z-index:60;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;white-space:nowrap;}
.dk-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
.dk-msg{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:14px;font-weight:600;background:#fdeeee;border:1px solid #f5c9c9;color:#a12b2b;}
.dk-loading{padding:30px 16px;text-align:center;color:#6b7280;font-size:14px;}
.dk-login{padding:40px 24px;}
.dk-field{width:100%;min-height:50px;border:1.5px solid #e8e9ee;border-radius:12px;padding:10px 12px;font-size:16px;font-family:inherit;background:#fbfbfc;margin-top:10px;}
.dk-label{font-size:13px;font-weight:700;color:#6b7280;margin-top:14px;display:block;}
.dk-pin{font-size:30px;font-weight:800;letter-spacing:12px;text-align:center;}
`;

function auth(token) {
  return { headers: { Authorization: 'Bearer ' + token } };
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fmtDM(d) { return pad(d.getDate()) + '/' + pad(d.getMonth() + 1); }
function shiftTime(s) {
  const t = (v) => String(v || '').slice(0, 5);
  return t(s.start_time) + ' – ' + t(s.end_time);
}
function errMsg(err, fallback) {
  if (err && err.response && err.response.data && err.response.data.message) return err.response.data.message;
  return fallback;
}
// Gói 37: "2026-10-10 20:00" -> {time: "20:00", wd: "Thứ 7", dm: "10/10"}
function parseDeadline(dl) {
  if (!dl) return null;
  const m = String(dl).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const wds = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  return { time: m[4] + ':' + m[5], wd: wds[d.getDay()], dm: m[3] + '/' + m[2], date: d };
}
function countdownText(deadlineDate) {
  if (!deadlineDate) return '';
  const ms = deadlineDate - new Date();
  if (ms <= 0) return '';
  const h = Math.floor(ms / 3600000), mi = Math.ceil((ms % 3600000) / 60000);
  if (h >= 24) return 'Còn ' + Math.floor(h / 24) + ' ngày ' + (h % 24) + ' giờ';
  return 'Còn ' + h + ' giờ ' + mi + ' phút';
}

export default function DangKyCa() {
  const [token, setToken] = useState(() => localStorage.getItem('emp_token') || '');
  const [emp, setEmp] = useState(() => {
    try { return JSON.parse(localStorage.getItem('emp_info') || 'null'); } catch (e) { return null; }
  });
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const [shifts, setShifts] = useState([]);
  const [wkOffset, setWkOffset] = useState(0);
  const [sel, setSel] = useState({}); // {"YYYY-MM-DD_<shiftId>": true}
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastOn, setToastOn] = useState(false);
  // Gói 37: hạn chót + lượt gửi
  const [deadlineAt, setDeadlineAt] = useState('');
  const [canSubmit, setCanSubmit] = useState(true);
  const [submitsLeft, setSubmitsLeft] = useState(2);
  const [submitCount, setSubmitCount] = useState(0);
  const [pastDeadline, setPastDeadline] = useState(false);

  const weekDays = useMemo(() => {
    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // 0 = Thứ 2
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + wkOffset * 7);
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      out.push({ iso: iso(d), label: fmtDM(d) });
    }
    return out;
  }, [wkOffset]);
  const weekIso = weekDays[0].iso;
  const wkLabel = 'Tuần ' + weekDays[0].label + ' – ' + weekDays[6].label;
  const wkSub = wkOffset === 0 ? 'Tuần đăng ký hiện tại' : wkOffset === 1 ? 'Tuần kế tiếp' : wkOffset + ' tuần tới';

  const toast = (m) => {
    setToastMsg(m); setToastOn(true);
    setTimeout(() => setToastOn(false), 2200);
  };

  const loadWeek = async (tk) => {
    setLoading(true);
    try {
      const r = await axios.get(API + '/employee/shift-registrations/week', {
        ...auth(tk), params: { week: weekIso },
      });
      const data = (r.data && r.data.data) || {};
      const regs = data.registrations || {};
      const next = {};
      Object.keys(regs).forEach((date) => {
        (regs[date] || []).forEach((it) => {
          if (it.work_shift_id) next[date + '_' + it.work_shift_id] = true;
        });
      });
      setSel(next);
      // Gói 37: hạn chót + lượt gửi
      const dl = data.deadline_at || '';
      setDeadlineAt(dl);
      setCanSubmit(data.can_submit !== false);
      setSubmitsLeft(typeof data.submits_left === 'number' ? data.submits_left : 2);
      setSubmitCount(typeof data.submit_count === 'number' ? data.submit_count : 0);
      setPastDeadline(dl ? new Date(dl.replace(' ', 'T') + ':00') < new Date() : false);
    } catch (e) {
      toast(errMsg(e, 'Không tải được đăng ký tuần này.'));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await axios.get(API + '/employee/me', auth(token));
        if (r.data && r.data.data) {
          setEmp(r.data.data);
          localStorage.setItem('emp_info', JSON.stringify(r.data.data));
        }
      } catch (e) { /* giữ info cũ */ }
      try {
        const s = await axios.get(API + '/employee/work-shifts', auth(token));
        setShifts(s.data && s.data.data ? s.data.data : []);
      } catch (e) {
        toast(errMsg(e, 'Không tải được danh sách ca.'));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (token) loadWeek(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekIso, token]);

  const doLogin = async (e) => {
    e.preventDefault();
    setErr('');
    if (!phone.trim()) { setErr('Vui lòng nhập số điện thoại.'); return; }
    if (!/^\d{6}$/.test(pin)) { setErr('Vui lòng nhập đủ 6 số PIN.'); return; }
    setLoginBusy(true);
    try {
      const r = await axios.post(API + '/employee/phone-login', {
        phone: phone.trim(), pin_code: pin,
      });
      const tk = r.data.access_token;
      const info = r.data.employee || {};
      localStorage.setItem('emp_token', tk);
      localStorage.setItem('emp_info', JSON.stringify(info));
      setToken(tk); setEmp(info); setPhone(''); setPin('');
    } catch (e) {
      setErr(errMsg(e, 'Đăng nhập thất bại. Kiểm tra lại SĐT và mã PIN.'));
    } finally { setLoginBusy(false); }
  };

  const selCount = Object.keys(sel).filter((k) => sel[k]).length;

  const payload = () => ({
    week: weekIso,
    selections: Object.keys(sel)
      .filter((k) => sel[k])
      .map((k) => {
        const i = k.indexOf('_');
        return { date: k.slice(0, i), work_shift_id: parseInt(k.slice(i + 1), 10) };
      }),
  });

  const saveDraft = async () => {
    setSaving(true);
    try {
      await axios.post(API + '/employee/shift-registrations/week', {
        ...payload(), status: 'draft',
      }, auth(token));
      toast('Đã lưu nháp ✓');
    } catch (e) {
      toast(errMsg(e, 'Lưu nháp thất bại.'));
    } finally { setSaving(false); }
  };

  const submit = async () => {
    if (selCount === 0) return;
    if (!window.confirm('Gửi đăng ký ' + selCount + ' ca cho ' + wkLabel + '?')) return;
    setSaving(true);
    try {
      await axios.post(API + '/employee/shift-registrations/week', {
        ...payload(), status: 'submitted',
      }, auth(token));
      setShowSuccess(true);
      loadWeek(token); // tải lại để cập nhật lượt gửi còn lại
    } catch (e) {
      toast(errMsg(e, 'Gửi đăng ký thất bại.'));
    } finally { setSaving(false); }
  };

  const changeWeek = (d) => {
    const n = wkOffset + d;
    if (n < 0 || n > MAX_WEEK_OFFSET) return;
    setWkOffset(n);
    setShowSuccess(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!token) {
    return (
      <div className="dk-wrap">
        <style>{CSS}</style>
        <div className="dk-login">
          <div className="dk-hd" style={{ borderRadius: 18 }}>
            <div className="dk-title">Đăng ký ca làm việc</div>
            <div className="dk-branch">Đăng nhập để tiếp tục</div>
          </div>
          <form className="dk-day" style={{ marginTop: 14 }} onSubmit={doLogin}>
            <label className="dk-label" style={{ marginTop: 4 }}>Số điện thoại</label>
            <input
              className="dk-field"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))}
              placeholder="09xxxxxxxx"
              autoComplete="tel"
            />
            <label className="dk-label">Mã PIN 6 số</label>
            <input
              className="dk-field dk-pin"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              autoComplete="off"
            />
            {err && <div className="dk-msg" style={{ margin: '12px 0 0' }}>{err}</div>}
            <div style={{ marginTop: 16 }}>
              <button className="dk-btn dk-send" type="submit" disabled={loginBusy} style={{ width: '100%' }}>
                {loginBusy ? 'Đang xử lý...' : 'Đăng nhập'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const avatarLetter = ((emp && emp.full_name) || '?').trim().charAt(0).toUpperCase();

  // Gói 37: trạng thái hạn chót / lượt gửi
  const dlInfo = parseDeadline(deadlineAt);
  const locked = !canSubmit;
  const lockReason = pastDeadline
    ? 'Đã quá hạn đăng ký ca tuần này.'
    : (submitCount > 0 && submitsLeft <= 0 ? 'Đã hết lượt gửi lại đăng ký ca tuần này.' : '');
  const cdText = !locked && dlInfo ? countdownText(dlInfo.date) : '';
  const statusText = submitCount <= 0 ? 'Chưa gửi đăng ký'
    : (submitsLeft > 0 ? 'Đã gửi — còn ' + submitsLeft + ' lần gửi lại' : 'Đã khóa');

  const toggle = (key) => {
    if (locked) return;
    setSel((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="dk-wrap">
      <style>{CSS}</style>

      <header className="dk-hd">
        <div className="dk-hd-user">
          <div className="dk-avatar">{avatarLetter}</div>
          <div>
            <div className="dk-name">{(emp && emp.full_name) || 'Nhân viên'}</div>
            <div className="dk-branch">{(emp && emp.branch_name) || 'Chi nhánh'}</div>
          </div>
        </div>
        <div className="dk-title">Đăng ký ca làm việc</div>
      </header>

      <div className="dk-weekbar">
        <button className="dk-wkbtn" onClick={() => changeWeek(-1)} disabled={wkOffset === 0} aria-label="Tuần trước">‹</button>
        <div className="dk-wklabel">
          <b>{wkLabel}</b>
          <span>{wkSub}</span>
        </div>
        <button className="dk-wkbtn" onClick={() => changeWeek(1)} disabled={wkOffset === MAX_WEEK_OFFSET} aria-label="Tuần sau">›</button>
      </div>

      <div className="dk-deadline">⏰ <span>
        {dlInfo
          ? <>Hạn đăng ký: <b>{dlInfo.time} · {dlInfo.wd}, {dlInfo.dm}</b>{cdText ? ' · ' + cdText : ''}</>
          : 'Đang tải hạn đăng ký...'}
      </span></div>
      {locked && lockReason && <div className="dk-msg">🔒 {lockReason}</div>}
      {!locked && submitCount > 0 && (
        <div className="dk-privacy" style={{ background: '#eef3fb', borderColor: '#c9d6f2', color: '#24305E' }}>
          ✓ <span>{statusText}</span>
        </div>
      )}
      <div className="dk-privacy">🔒 <span>Đăng ký của bạn chỉ hiển thị với quản lý.</span></div>

      {loading ? (
        <div className="dk-loading">Đang tải dữ liệu tuần...</div>
      ) : (
        <main>
          {weekDays.map((day, di) => {
            const daySel = shifts.filter((s) => sel[day.iso + '_' + s.id]).length;
            return (
              <section className="dk-day" key={day.iso}>
                <div className="dk-dayhead">
                  <div className="dk-dayname">{DAY_NAMES[di]}<small>{day.label}</small></div>
                  <div className={'dk-daycount' + (daySel === 0 ? ' zero' : '')}>
                    {daySel > 0 ? 'Đã chọn ' + daySel + ' ca' : 'Chưa chọn'}
                  </div>
                </div>
                {shifts.map((s) => {
                  const key = day.iso + '_' + s.id;
                  const on = !!sel[key];
                  return (
                    <button
                      key={key}
                      className={'dk-shift' + (on ? ' on' : '')}
                      onClick={() => toggle(key)}
                      aria-pressed={on}
                      disabled={locked}
                      style={locked ? { opacity: 0.55 } : undefined}
                    >
                      <span className="dk-tick">{on ? '✓' : ''}</span>
                      <span className="dk-sinfo">
                        <span className="dk-sname">{s.name}</span>
                        <span className="dk-stime">{shiftTime(s)}</span>
                      </span>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </main>
      )}

      <div className="dk-bottom">
        <div className="dk-selcount">Đã chọn: <b>{selCount}</b> ca · {statusText}</div>
        <div className="dk-btnrow">
          <button className="dk-btn dk-draft" onClick={saveDraft} disabled={saving || locked}>
            {saving ? 'Đang lưu...' : 'Lưu nháp'}
          </button>
          <button className="dk-btn dk-send" onClick={submit} disabled={selCount === 0 || saving || locked}>
            Gửi đăng ký
          </button>
        </div>
      </div>

      {showSuccess && (
        <div className="dk-overlay">
          <div className="dk-okbox">
            <div className="dk-okcircle">✓</div>
            <div className="dk-oktitle">Đã gửi đăng ký!</div>
            <div className="dk-okweek">{wkLabel}</div>
            <div className="dk-okdesc">Quản lý sẽ xếp lịch và thông báo sau.<br />{submitsLeft > 0 ? 'Bạn còn ' + submitsLeft + ' lần gửi lại cho tuần này.' : 'Bạn đã hết lượt gửi lại cho tuần này.'}</div>
            <button className="dk-done" onClick={() => setShowSuccess(false)}>Xong</button>
          </div>
        </div>
      )}

      <div className={'dk-toast' + (toastOn ? ' show' : '')}>{toastMsg}</div>
    </div>
  );
}
