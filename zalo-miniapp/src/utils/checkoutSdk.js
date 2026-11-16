// Gói Checkout SDK (spec spec-checkout-sdk-zalopay.md, Đại Vương phán
// Đ1–Đ5 2026-11-10): điểm mở trang thanh toán Zalo DUY NHẤT của Mini App.
//
// API chính thức là CheckoutSDK từ 'zmp-sdk/apis' — import từ root
// 'zmp-sdk' sẽ mất các hàm payment (đó là lỗi của bản tự xây cũ, kèm
// fallback ZaloJSBridge khiến SDK không bao giờ mở được mà app vẫn "sống"
// nhờ rơi êm về CK tay).
//
// Luồng: đăng ký nghe EventName.PaymentDone TRƯỚC khi gọi createOrder →
// chờ sự kiện (timeout 10 phút thì coi như chưa có kết quả) → có data thì
// checkTransaction lấy resultCode (1 thành công · 0 đang xử lý · −1 thất
// bại · −2 khách thoát/chưa chọn). Kết quả phía client CHỈ để hiển thị sơ
// bộ — nguồn sự thật là notify/đối soát phía server, không đổi trạng thái
// đơn theo lời client.
//
// Vá boot (2026-11-11): module 'zmp-sdk/apis' được NẠP ĐỘNG trong thân
// hàm, KHÔNG import tĩnh — import tĩnh kéo toàn bộ đồ thị apis vào đường
// khởi động (App.jsx nạp tĩnh 3 trang thanh toán) và từng gây trắng màn
// hình trong webview Zalo; cả cây Mini App theo lệ này từ 2026-11-07
// (storage.js/api.js đều nạp động). Nạp module lỗi → openCheckout ném
// lỗi ra cho caller xử lý theo spec §3 như lỗi createOrder.

// Gói vá sau vòng S — Mục 2 (chính thức hóa bản thám S-01, 2026-11-12):
// lỗi mở SDK được phơi theo CHẶNG (IMPORT/CREATE_ORDER) kèm name/message
// của lỗi gốc trong message ném lên caller, để các màn gọi (Checkout,
// WaitingPayment, GroupOrder) nối thẳng chi tiết thật vào thông báo cho
// khách thay vì nuốt êm thành trạng thái rỗng. Lỗi gốc giữ ở .cause.
function sdkStageError(stage, err) {
  const e = new Error(`[SDK] chặng=${stage} · name=${err?.name || '?'} · message=${err?.message || String(err || '?')}`);
  e.cause = err;
  return e;
}

export async function openCheckout(sdkParams) {
  let apis;
  try {
    apis = await import('zmp-sdk/apis');
  } catch (err) {
    throw sdkStageError('IMPORT', err);
  }
  const { CheckoutSDK, events, EventName } = apis;

  let onDone;
  const donePromise = new Promise((resolve) => { onDone = resolve; });
  events.once(EventName.PaymentDone, (resp) => onDone(resp || {}));

  // createOrder lỗi → NÉM lỗi nguyên gốc cho caller xử lý theo spec §3
  // (báo rõ + đơn giữ pending_payment chờ "Thanh toán tiếp"), không nuốt.
  let orderId;
  try {
    ({ orderId } = await CheckoutSDK.createOrder(sdkParams));
  } catch (err) {
    throw sdkStageError('CREATE_ORDER', err);
  }

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 10 * 60 * 1000));
  const ev = await Promise.race([donePromise, timeout]);

  let resultCode = null;
  const data = ev?.data;
  if (data) {
    try {
      const tx = await CheckoutSDK.checkTransaction({ data });
      resultCode = tx?.resultCode ?? null;
    } catch {
      resultCode = null; // lỗi check phía client → chưa rõ kết quả, server là nguồn sự thật
    }
  }
  return { orderId, resultCode };
}
