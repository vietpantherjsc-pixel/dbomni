// Spec P4-P5 (khắc phục kiểm duyệt Zalo): 1 module bọc storage duy nhất.
// - Trong Zalo Mini App: dùng zmp-sdk nativeStorage (bất đồng bộ).
// - Khi dev web: dùng localStorage.
// - Cache trong bộ nhớ cho các chỗ đọc đồng bộ; hydrate() nạp 1 lần khi app khởi động.
// CẤM dùng localStorage/document.cookie trực tiếp ở file khác — qua module này.
// Gói vá khởi tạo Mini App (2026-11-07, V3): nạp zmp-sdk/apis bằng import
// ĐỘNG có .catch như mọi chỗ khác trong app (api.js) — trước đây đây là
// import TĨNH duy nhất của SDK; SDK lỗi/không sẵn sàng thì storage rơi về
// cache bộ nhớ, tuyệt đối không giết đồ thị module của entry.
let sdkApisPromise = null;
const loadApis = () => {
    if (!sdkApisPromise) {
        sdkApisPromise = import('zmp-sdk/apis').catch(() => null);
    }
    return sdkApisPromise;
};

// V2: 'zm_session' (token phiên khách) phải có trong danh sách hydrate —
// thiếu nó thì phiên không bao giờ được nạp lại sau reload.
// 'zm_cover_diag' (2026-11-09): châm chẩn đoán của riêng khóa cover —
// ghi kết quả persist gần nhất {ok, size, at} để vòng máy thật đối chiếu.
export const KEYS = ['zm_branch', 'zm_profile', 'zm_zalo_profile', 'zm_account_cover', 'zm_cart', 'zm_ref', 'zm_groups', 'zm_last_order', 'zm_oa_followed', 'zm_session', 'zm_cover_diag'];

const hasBridge = () => {
    try { return typeof window !== 'undefined' && (!!window.ZaloJSBridge || !!window.ZaloJavaScriptInterface); } catch { return false; }
};

// ── Chốt tầng lưu (vá gốc 2026-11-09) ─────────────────────────────────────
// Tầng lưu ('native' = kho MPDS của Zalo qua SDK · 'local' = localStorage
// của webview) được quyết MỘT LẦN cho cả phiên bằng một lần DÒ THẬT
// (getStorage qua SDK), thay vì đoán cầu nối ở từng lần đọc/ghi như trước:
// cách đoán cũ có thể rẽ hydrate sang "kho bóng" localStorage trong khi
// lần ghi sau lại xuống native → ghi một nơi, đọc một nơi, mở lạnh mất hết.
// Dò thành công = native sống → chốt native vĩnh viễn trong phiên. Dò
// thất bại khi CÓ dấu hiệu cầu nối (đang ở trong Zalo, cầu có thể chưa ấm
// lúc mở lạnh qua QR) thì thử lại vài nhịp ngắn trước khi chốt local;
// không có cầu nối (trình duyệt dev thường) → chốt local ngay.
let layerPromise = null;
let pinnedLayer = null; // 'native' | 'local' sau khi đã chốt
let probeData = null;   // kết quả getStorage của lần dò — hydrate dùng lại

async function probeNative(apis) {
    const attempts = hasBridge() ? 3 : 1;
    for (let i = 0; i < attempts; i++) {
        try {
            const data = await apis.getStorage({ keys: KEYS });
            probeData = (data && typeof data === 'object') ? data : {};
            return true;
        } catch {
            if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400));
        }
    }
    return false;
}

function ensureLayer() {
    if (layerPromise) return layerPromise;
    layerPromise = (async () => {
        const apis = await loadApis();
        pinnedLayer = (apis?.getStorage && apis?.setStorage && await probeNative(apis)) ? 'native' : 'local';
        return pinnedLayer;
    })();
    return layerPromise;
}

const cache = {};
// Vá cover B (2026-11-09): hydrate giữ promise đang chạy để nơi khác chờ
// được mốc "nạp xong" (storage.ready()) — trước đây chỉ có cờ true đặt
// TRƯỚC khi nạp thật, không ai biết khi nào dữ liệu đã về cache.
let hydratePromise = null;
let hydrateSettled = false;
// Khóa bị ghi TRONG LÚC hydrate chưa xong: hydrate về sau không được đè
// lên giá trị vừa ghi mới (đua hydrate — bản vá dirty-guard 2026-11-09).
const dirtyDuringHydrate = new Set();
const markDirty = (key) => { if (!hydrateSettled) dirtyDuringHydrate.add(key); };

export function hydrateStorage() {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
        const layer = await ensureLayer();
        if (layer === 'native') {
            let data = probeData;
            if (!data) {
                try {
                    const apis = await loadApis();
                    data = await apis?.getStorage?.({ keys: KEYS });
                } catch { data = null; }
            }
            probeData = null;
            // ⭐ GỐC LỖI MẤT PHIÊN/COVER Ở MỞ LẠNH (kết án 2026-11-09):
            // getStorage của zmp-sdk resolve ra OBJECT PHẲNG { key: value }
            // (getDataFromStorage trả thẳng, functionHandler không bọc vỏ) —
            // bản cũ đọc `const { data } = await ...` nên data luôn undefined
            // và MỌI khóa bị gán null vào cache ở mọi lần mở lạnh, dù dữ liệu
            // gốc trong máy còn nguyên. Đọc phẳng tại đây; lớp bọc { data }
            // chỉ mở khi tầng trên không chứa khóa nào của mình (phòng thủ
            // cho biến thể SDK khác), không bao giờ gán null oan nữa.
            let flat = (data && typeof data === 'object') ? data : {};
            if (!KEYS.some((k) => k in flat) && flat.data && typeof flat.data === 'object') flat = flat.data;
            for (const k of KEYS) {
                if (dirtyDuringHydrate.has(k)) continue;
                cache[k] = flat[k] ?? null;
            }
        } else {
            for (const k of KEYS) {
                if (dirtyDuringHydrate.has(k)) continue;
                try { cache[k] = localStorage.getItem(k); } catch { cache[k] = null; }
            }
        }
        dirtyDuringHydrate.clear();
        hydrateSettled = true;
    })();
    return hydratePromise;
}

// Vá cover C (2026-11-09) + vá gốc 2026-11-09: persist TRẢ kết quả
// true/false ĐÚNG SỰ THẬT —
// - Ghi: SDK resolve kèm { errorKeys } liệt kê các key bị native TỪ CHỐI
//   (vd quá giới hạn tổng 5MB của kho MPDS); key của mình nằm trong đó
//   = ghi THẤT BẠI dù promise resolve (bản cũ không xét → báo OK giả).
// - Xóa (value null): phải gọi removeStorage THẬT — đường setStorage của
//   SDK tự LOẠI giá trị null trước khi gửi xuống native nên ghi null
//   không xóa được gì (bản cũ xóa phiên/đăng xuất chỉ xóa ở cache).
const persist = async (key, value) => {
    const layer = await ensureLayer();
    if (layer === 'native') {
        try {
            const apis = await loadApis();
            if (value === null || value === undefined) {
                if (apis?.removeStorage) {
                    const res = await apis.removeStorage({ keys: [key] });
                    return !(Array.isArray(res?.errorKeys) && res.errorKeys.includes(key));
                }
                return false;
            }
            if (apis?.setStorage) {
                const res = await apis.setStorage({ data: { [key]: value } });
                return !(Array.isArray(res?.errorKeys) && res.errorKeys.includes(key));
            }
            return false;
        } catch { return false; }
    }
    try {
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
        return true;
    } catch { return false; }
};

export const storage = {
    // Đọc đồng bộ từ cache (đảm bảo đã hydrateStorage() ở main.jsx)
    get(key) { return cache[key] ?? null; },
    getJSON(key, fallback = null) {
        try {
            const v = cache[key];
            return v ? JSON.parse(v) : fallback;
        } catch { return fallback; }
    },
    set(key, value) {
        const v = value === null || value === undefined ? null
            : (typeof value === 'string' ? value : JSON.stringify(value));
        cache[key] = v;
        markDirty(key);
        persist(key, v);
    },
    // Như set() nhưng TRẢ promise kết quả ghi thật (true/false) — dùng cho
    // dữ liệu lớn/quan trọng cần báo người dùng khi ghi thất bại (cover).
    setTracked(key, value) {
        const v = value === null || value === undefined ? null
            : (typeof value === 'string' ? value : JSON.stringify(value));
        cache[key] = v;
        markDirty(key);
        return persist(key, v);
    },
    // Promise resolved khi hydrate (nạp dữ liệu lưu vào cache) đã xong —
    // nơi đọc-1-lần lúc mount dùng để đọc lại nếu hydrate về trễ.
    ready() { return hydratePromise ?? Promise.resolve(); },
    remove(key) {
        cache[key] = null;
        markDirty(key);
        persist(key, null);
    },
    hydrate: hydrateStorage,
    // Tương thích ngược cho caller cũ: đã chốt tầng thì trả theo tầng,
    // chưa chốt thì dựa vào dấu hiệu cầu nối như trước.
    isZalo() { return pinnedLayer ? pinnedLayer === 'native' : hasBridge(); },
};

export default storage;
