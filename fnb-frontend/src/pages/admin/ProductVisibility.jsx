// Gói 25 (2026-10-09): Quản lý hiển thị mặt hàng theo chi nhánh (submenu của Mặt hàng).
import React from 'react';
import VisibilityMatrix from './VisibilityMatrix';

export default function ProductVisibility() {
    return (
        <VisibilityMatrix
            title="Quản lý hiển thị mặt hàng"
            desc="Gạt tắt để ẩn món ở chi nhánh tương ứng (POS + Zalo Mini App). Mặc định tất cả đều bật."
            matrixUrl="/visibility/products"
            toggleUrl="/visibility/products/toggle"
            syncUrl="/visibility/products/sync"
            rowsKey="products"
            rowKey="product_id"
            syncIdsKey="product_ids"
        />
    );
}
