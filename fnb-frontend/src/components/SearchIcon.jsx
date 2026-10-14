import React from 'react';

// Gói 55 p11x: icon tìm kiếm SVG hiện đại (kiểu Lucide), thay thế emoji 🔍 trên toàn hệ thống
export default function SearchIcon({ size = 16, color = 'currentColor', style }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, ...style }}
            aria-hidden="true"
        >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
        </svg>
    );
}
