// Gói 7p (2026-10-05): Màu chủ đạo giao diện do Đại Vương tự pick.
// Áp màu vào CSS variables của design system (matcha.css -> theme xanh dương).

const STORAGE_KEY = 'theme_primary';
export const DEFAULT_PRIMARY = '#24305E';

function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

// Trộn 2 màu: weight = tỉ lệ màu 1
function mix(hex1, hex2, weight) {
    const a = hexToRgb(hex1);
    const b = hexToRgb(hex2);
    return toHex(a.r * weight + b.r * (1 - weight), a.g * weight + b.g * (1 - weight), a.b * weight + b.b * (1 - weight));
}

export function applyThemeColor(hex) {
    if (!hex || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) return;
    if (hex.length === 4) hex = '#' + hex.slice(1).split('').map((c) => c + c).join('');
    const root = document.documentElement.style;
    root.setProperty('--m-primary', hex.toUpperCase());
    root.setProperty('--m-primary-deep', mix('#000000', hex, 0.22));   // hover: tối hơn
    root.setProperty('--m-accent', mix('#FFFFFF', hex, 0.55));          // xanh nhạt
    root.setProperty('--m-accent-soft', mix('#FFFFFF', hex, 0.88));     // nền highlight
    root.setProperty('--m-sidebar', hex.toUpperCase());
    root.setProperty('--m-sidebar-active', mix('#FFFFFF', hex, 0.6));
    try { localStorage.setItem(STORAGE_KEY, hex.toUpperCase()); } catch (e) { /* ignore */ }
}

export function getStoredTheme() {
    try { return localStorage.getItem(STORAGE_KEY) || null; } catch (e) { return null; }
}

// Gọi lúc app khởi động: áp màu đã lưu ngay, rồi đồng bộ từ server
export async function loadTheme(api) {
    const stored = getStoredTheme();
    if (stored) applyThemeColor(stored);
    else applyThemeColor(DEFAULT_PRIMARY);
    try {
        const res = await api.get('http://localhost/api/settings/theme');
        const primary = res.data && res.data.primary;
        if (primary && primary.toUpperCase() !== (stored || '').toUpperCase()) {
            applyThemeColor(primary);
        }
    } catch (e) { /* giữ màu local */ }
}

export const THEME_PRESETS = [
    { name: 'Xanh dương (logo)', value: '#24305E' },
    { name: 'Xanh matcha', value: '#2F3E2E' },
    { name: 'Xanh lá', value: '#00B14F' },
    { name: 'Cam', value: '#E8830C' },
    { name: 'Đỏ', value: '#C0392B' },
    { name: 'Tím', value: '#6C3FA3' },
    { name: 'Hồng', value: '#D6336C' },
    { name: 'Xám đen', value: '#1F2937' },
];
