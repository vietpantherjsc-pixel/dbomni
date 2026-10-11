// Gói 47: Font chữ giao diện — Đại Vương tự chọn trong Thiết lập.
// Tất cả font trong danh sách đều đã verify có subset "vietnamese" qua Google Fonts.

const STORAGE_KEY = 'app_font_family';
export const DEFAULT_FONT = 'Inter';

export const FONT_PRESETS = [
    { name: 'Inter', family: 'Inter', desc: 'Mặc định — trung tính, dễ đọc' },
    { name: 'Be Vietnam Pro', family: "'Be Vietnam Pro'", desc: 'Thiết kế riêng cho tiếng Việt' },
    { name: 'Nunito', family: 'Nunito', desc: 'Bo tròn, thân thiện (phong cách Grab)' },
    { name: 'Quicksand', family: 'Quicksand', desc: 'Bo tròn hình học (phong cách Grab)' },
    { name: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans'", desc: 'Hiện đại, gọn gàng' },
    { name: 'Manrope', family: 'Manrope', desc: 'Hiện đại, hình học' },
    { name: 'Lexend', family: 'Lexend', desc: 'Tối ưu khả năng đọc' },
];

const loadedFonts = new Set(['Inter']); // Inter đã preload trong index.html

function googleUrl(family) {
    const name = family.replace(/'/g, '');
    return 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name) + ':wght@400;500;600;700;800&display=swap';
}

export function applyFont(family) {
    const preset = FONT_PRESETS.find((f) => f.family === family) || FONT_PRESETS[0];
    if (!loadedFonts.has(preset.family)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = googleUrl(preset.family);
        document.head.appendChild(link);
        loadedFonts.add(preset.family);
    }
    document.body.style.fontFamily = preset.family + ", system-ui, -apple-system, 'Segoe UI', sans-serif";
    try { localStorage.setItem(STORAGE_KEY, preset.family); } catch (e) { /* ignore */ }
}

export function getStoredFont() {
    try { return localStorage.getItem(STORAGE_KEY) || null; } catch (e) { return null; }
}

// Gọi lúc app khởi động: áp font đã lưu ngay, rồi đồng bộ từ server
export async function loadFont(api) {
    const stored = getStoredFont();
    applyFont(stored || DEFAULT_FONT);
    try {
        const res = await api.get('http://localhost/api/settings');
        const family = res.data && res.data.font_family;
        if (family && family !== stored) applyFont(family);
    } catch (e) { /* giữ font local */ }
}
