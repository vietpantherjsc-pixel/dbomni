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
export const KEYS = ['zm_branch', 'zm_profile', 'zm_zalo_profile', 'zm_account_cover', 'zm_cart', 'zm_ref', 'zm_groups', 'zm_last_order', 'zm_oa_followed', 'zm_session'];

// Nhận diện môi trường Zalo (2026-11-07): ngoài dấu hiệu cũ ZaloJSBridge
// phải nhận thêm ZaloJavaScriptInterface — cầu nối hiện hành mà chính
// zmp-sdk v2 dùng để gọi native (bản cũ chỉ chờ ZaloJSBridge nên trong
// Zalo thật hàm này trả false vĩnh viễn: đăng nhập Zalo bị chặn ở cổng
// not_zalo và storage lặng lẽ rơi về nhánh localStorage dự phòng).
const isZalo = () => {
    try { return typeof window !== 'undefined' && (!!window.ZaloJSBridge || !!window.ZaloJavaScriptInterface); } catch { return false; }
};

const cache = {};
let hydrated = false;

export async function hydrateStorage() {
    if (hydrated) return;
    hydrated = true;
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
}

const persist = async (key, value) => {
    if (isZalo()) {
        const apis = await loadApis();
        if (apis?.setStorage) {
            try { await apis.setStorage({ data: { [key]: value } }); } catch {}
        }
    } else {
        try {
            if (value === null || value === undefined) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
        } catch {}
    }
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
    remove(key) {
        cache[key] = null;
        persist(key, null);
    },
    hydrate: hydrateStorage,
    isZalo,
};

export default storage;
