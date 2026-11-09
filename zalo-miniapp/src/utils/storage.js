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

// Nhận diện môi trường Zalo (2026-11-07): ngoài dấu hiệu cũ ZaloJSBridge
// phải nhận thêm ZaloJavaScriptInterface — cầu nối hiện hành mà chính
// zmp-sdk v2 dùng để gọi native (bản cũ chỉ chờ ZaloJSBridge nên trong
// Zalo thật hàm này trả false vĩnh viễn: đăng nhập Zalo bị chặn ở cổng
// not_zalo và storage lặng lẽ rơi về nhánh localStorage dự phòng).
const isZalo = () => {
    try { return typeof window !== 'undefined' && (!!window.ZaloJSBridge || !!window.ZaloJavaScriptInterface); } catch { return false; }
};

const cache = {};
// Vá cover B (2026-11-09): hydrate giữ promise đang chạy để nơi khác chờ
// được mốc "nạp xong" (storage.ready()) — trước đây chỉ có cờ true đặt
// TRƯỚC khi nạp thật, không ai biết khi nào dữ liệu đã về cache.
let hydratePromise = null;

export function hydrateStorage() {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
        if (isZalo()) {
            try {
                const apis = await loadApis();
                if (apis?.getStorage) {
                    const { data } = await apis.getStorage({ keys: KEYS });
                    for (const k of KEYS) cache[k] = data?.[k] ?? null;
                }
            } catch { /* giữ null */ }
        } else {
            for (const k of KEYS) {
                try { cache[k] = localStorage.getItem(k); } catch { cache[k] = null; }
            }
        }
    })();
    return hydratePromise;
}

// Vá cover C (2026-11-09): persist TRẢ kết quả true/false thay vì nuốt
// lỗi lặng lẽ — nơi gọi cần biết ghi thật thành công hay không thì dùng
// storage.setTracked(); các nơi gọi cũ (set/remove) giữ nguyên hành vi.
const persist = async (key, value) => {
    if (isZalo()) {
        try {
            const apis = await loadApis();
            if (apis?.setStorage) {
                await apis.setStorage({ data: { [key]: value } });
                return true;
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
        persist(key, v);
    },
    // Như set() nhưng TRẢ promise kết quả ghi thật (true/false) — dùng cho
    // dữ liệu lớn/quan trọng cần báo người dùng khi ghi thất bại (cover).
    setTracked(key, value) {
        const v = value === null || value === undefined ? null
            : (typeof value === 'string' ? value : JSON.stringify(value));
        cache[key] = v;
        return persist(key, v);
    },
    // Promise resolved khi hydrate (nạp dữ liệu lưu vào cache) đã xong —
    // nơi đọc-1-lần lúc mount dùng để đọc lại nếu hydrate về trễ.
    ready() { return hydratePromise ?? Promise.resolve(); },
    remove(key) {
        cache[key] = null;
        persist(key, null);
    },
    hydrate: hydrateStorage,
    isZalo,
};

export default storage;
