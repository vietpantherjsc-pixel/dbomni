// Gói 25 (2026-10-09): Quản lý hiển thị thực đơn theo chi nhánh (submenu của Thực đơn).
// Thực đơn bị tắt ở CN nào sẽ không hiện trên POS & Mini App của CN đó.
import React from 'react';
import VisibilityMatrix from './VisibilityMatrix';

export default function MenuVisibility() {
    return (
        <VisibilityMatrix
            title="Quản lý hiển thị thực đơn"
            desc="Gạt tắt để ẩn cả thực đơn ở chi nhánh tương ứng (POS + Zalo Mini App). Mặc định tất cả đều hiện."
            matrixUrl="/visibility/menus"
            toggleUrl="/visibility/menus/toggle"
            syncUrl="/visibility/menus/sync"
            rowsKey="menus"
            rowKey="menu_id"
            syncIdsKey="menu_ids"
            countKey="products_count"
        />
    );
}
