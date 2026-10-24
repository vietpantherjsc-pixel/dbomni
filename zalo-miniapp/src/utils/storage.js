// Spec P4-P5 (khắc phục kiểm duyệt Zalo): 1 module bọc storage duy nhất.
// - Trong Zalo Mini App: dùng zmp-sdk nativeStorage (bất đồng bộ).
// - Khi dev web: dùng localStorage.
// - Cache trong bộ nhớ cho các chỗ đọc đồng bộ; hydrate() nạp 1 lần khi app khởi động.
// CẤM dùng localStorage/document.cookie trực tiếp ở file khác — qua module này.
import { getStorage, setStorage, removeStorage } from 'zmp-sdk/apis';

export const KEYS = ['zm_branch', 'zm_profile', 'zm_zalo_profile', 'zm_account_cover', 'zm_cart', 'zm_ref', 'zm_groups', 'zm_last_order', 'zm_oa_followed'];

const isZalo = () => {
    try { return typeof window !== 'undefined' && !!window.ZaloJSBridge; } catch { return false; }
};

const cache = {};
let hydrated = false;

export async function hydrateStorage() {
    if (hydrated) return;
    hydrated = true;
    if (isZalo()) {
        try {
            const { data } = await getStorage({ keys: KEYS });
            for (const k of KEYS) cache[k] = data?.[k] ?? null;
        } catch { /* giữ null */ }
    } else {
        for (const k of KEYS) {
            try { cache[k] = localStorage.getItem(k); } catch { cache[k] = null; }
        }
    }
}

const persist = async (key, value) => {
    if (isZalo()) {
        try { await setStorage({ data: { [key]: value } }); } catch {}
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
