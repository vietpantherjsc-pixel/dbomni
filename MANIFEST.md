# MANIFEST — ZIP TỔNG TÍCH LŨY v3 (05/11/2026)

**Tên zip:** `goi-tong-tich-luy-20261105-v3.zip`
**Ngày đóng:** 2026-11-05 (tối, sau TESTER ship-check ✅ zip riêng gói định mức)
**Nội dung:** 74 file code + MANIFEST này. Gộp cơ học từ **chính 2 zip đã qua TESTER** (không lấy từ cây code), giữ nguyên cấu trúc từ repo root — giải nén đè thẳng vào `D:\WORK\VIBE`.

## ⚠️ ZIP NÀY THAY THẾ 2 ZIP — CHỈ ÁP 1 ZIP NÀY

Zip tổng v3 thay thế toàn bộ 2 zip sau (không áp lẻ lại 2 zip đó):

1. `goi-tong-tich-luy-20261105-v2.zip` — 449.684 byte · SHA-256 `9c88b3c37b225154663f47440d8bfc1e0aeb9f251a8ec5d5dfff9288ae0b67e7` · 61 file code (gộp sáng + chiến dịch + mật khẩu khách; migrations 000095→000098).
2. `goi-dinh-muc-don-vi-quy-doi-20261105.zip` — 108.189 byte · SHA-256 `8bc2791c8b4e9275c5e55777385c2dcd18622777bae40d4f671ec2545036c36c` · 14 file code (gói định mức chọn đơn vị quy đổi; migration 000099).

**Nếu ngài chưa áp v2 thì chỉ áp v3.** Nếu ngài đã áp v2 thì áp lại v3 vẫn an toàn: các file trùng nhau là cùng nội dung (chỉ lấy bản mới nhất, xem bảng dưới), migration đã chạy rồi Laravel tự bỏ qua — **chỉ migration 000099 là mới** và sẽ chạy lần này.

## Quy tắc gộp (mới nhất thắng khi trùng file)

Đúng **1 file trùng** giữa 2 zip nguồn, đã lấy bản **mới nhất** (gói định mức):

| File | v2 | Gói định mức | Lấy bản |
|---|---|---|---|
| `fnb-frontend/src/pages/admin/Inventory.jsx` | U-03 (nút "+ Tạo định mức" không méo) | + BomTab định mức BTP (dòng thô + ô mẻ chọn đơn vị, vá 1.4 snapshot chết) | **Gói định mức** (đã đối chiếu diff: chỉ thêm code định mức, U-03 giữ nguyên — kiểm `shrink-0 whitespace-nowrap` còn đủ 2 điểm) |

13 file còn lại của gói định mức chỉ có ở zip định mức; 60 file còn lại của v2 chỉ có ở v2. Tổng: 60 + 13 + 1 trùng (tính 1 lần) = **74 file code**.

## Các gói con trong zip

### A. Zip tổng v2 (61 file — xem MANIFEST của v2 để biết chi tiết từng gói)

- **Zip sáng 05/11:** #94 (TransactionController phân giải theo mã) · #95 + dedup + #92 (OnlineOrderController, bộ đếm nguyên tử mã đơn) · #97 (OutboundController) · #98 (Branch che `attendance_qr_token`) · migration 000095.
- **Zip chiến dịch 05/11:** phiên Hub (đăng nhập 1 lần + chọn CN ngay lúc đăng nhập, bỏ cổng QR Hub, PIN step-up chốt kiểm kê/sản xuất) · bịt route int `$id` · U-01 icon · U-02 portal PrivacyPolicy · U-03 nút Admin · F1–F5 (PNL kênh · biểu đồ Thu–Chi · POS "Mở ca" · phiếu từ chối → `cancelled` · đơn nghỉ bị từ chối có lý do) · migrations 000096 + 000097.
- **Gói mật khẩu khách:** đăng nhập phụ SĐT + mật khẩu (validator siết 8–72 ký tự, khóa 5 lần/15 phút) · phiên token 180 ngày · khôi phục qua Zalo · cửa sổ quầy + cấp lại mã · email tự nguyện · cổng đồng ý 422 `consent_required` · migration 000098.

### B. Gói định mức chọn đơn vị quy đổi (14 file — mới trong v3)

- Migration **000099**: 3 bảng dòng +2 cột hiển thị (`display_unit_name` + `display_factor`); `production_recipes` thêm 2 cột batch; nới `quantity` 3 bảng + `batch_output_qty` lên decimal(14,4).
- Helper mới `RecipeUnitResolver.php` (server quy đổi duy nhất + giao thức chống trôi `orig_*`) · 3 model (Recipe · ProductionRecipe · RdRecipe) · 4 controller (Product · OptionGroup · Production · RD) · helper mới `recipeUnits.js` · 4 trình Admin (Products · OptionGroups · Inventory BomTab · RdDrafts).
- Verdict TESTER: **tĩnh** T-01..T-04 + §J đạt (vá 1 điểm spec 1.4) · **sống ✅** S-01..S-06 + 1.4 + P-1/P-3 đạt (200 Gram → 0,2000 Kg · 5 Gram → 0,0050 · publish mang snapshot · chống trôi a/b · xóa Gram → hiện 0,2 Kg → Lưu → snapshot NULL). S-07 biên hệ số lớn ở lại needs_validation, không chặn.
- 2 note 🟡 ngoài phạm vi gói, để gói dọn sau (không chặn ship, KHÔNG có trong zip này): approve() nháp R&D thiếu `unit` → 500 thay vì 422 · giá vốn nhân đôi quy đổi từ Gói 55 (thổi 1000×).

## Thứ tự migrate

Chạy `php artisan migrate` **1 lần duy nhất** — các migration chạy theo đúng thứ tự: **000095 → 000096 → 000097 → 000098 → 000099**.

## Quy trình áp (chạy tại máy Đại Vương)

```powershell
# 1. Giải nén zip này đè vào D:\WORK\VIBE (giữ nguyên cấu trúc thư mục)
#    (KHÔNG áp lẻ lại 2 zip đã liệt kê ở trên — zip này đã gộp đủ)
# 2. Chạy migrate — tại D:\WORK\VIBE\dbomni
cd D:\WORK\VIBE\dbomni
docker compose exec laravel.test php artisan migrate
#    (chạy 000095 → 000096 → 000097 → 000098 → 000099 theo thứ tự;
#     migration nào đã chạy rồi Laravel tự bỏ qua — chỉ 000099 là mới
#     nếu ngài đã áp v2 trước đó)
# 3. Restart backend — tại D:\WORK\VIBE\dbomni
docker compose restart laravel.test
# 4. Rebuild web-admin (fnb-frontend) + web-mini (zalo-miniapp) rồi deploy như mọi lần
```

## Kiểm thử trước khi đóng gói (đã chạy, đều đạt)

- Gộp cơ học từ chính 2 zip đã qua TESTER (không lấy từ cây code): hợp 74 file, 1 file trùng lấy đúng bản mới nhất (đối chiếu diff từng dòng thay đổi của Inventory.jsx: chỉ thêm code định mức, U-03 giữ nguyên).
- Đối chiếu byte: từng file trong zip này **byte-identical với đúng bản trong zip nguồn của nó** (kiểm bằng giải nén đối chiếu từng file).
- Bảng SHA sinh + đối chiếu bằng script (không chép tay — bài học vụ v1).
- `routes/api.php` trong zip này có SHA `32a34229…e38b` (bản mật khẩu, 521 routes — gói định mức không đụng routes).

## SHA-256 từng file (đối chiếu byte)

```
f9f6de3cc1fed340b3111f36d0485a01bf1f147a20d7b7ada13f90459003df48   ./dbomni/app/Http/Controllers/Api/CustomerAddressController.php
07986c2b9ac6089f35a8a35866e25ebb2cca32786e1783d47a02b8ba1d4e001c   ./dbomni/app/Http/Controllers/Api/CustomerController.php
ca475539384097893b9511adac88299fcbac373c4770dc96bd754b780a8b3df5   ./dbomni/app/Http/Controllers/Api/CustomerPasswordController.php
bc54abbd1992d7ee411749d3a677f8b4f8098d6787045b6d6d9c69d1a3072de9   ./dbomni/app/Http/Controllers/Api/CustomerSessionController.php
7a0d3f7852af8306351dee2f0d00bcbb7d72b4b92695e86006d3365f52827b5b   ./dbomni/app/Http/Controllers/Api/EmployeeAuthController.php
1664352a91bdbeeaa2998356b826bcfae0a406625856960741cd1fff78fd115b   ./dbomni/app/Http/Controllers/Api/EmployeeInventoryController.php
0b6f30875bb94d10144acc889aaa4bda3c0cf14623fa965d89dfb32de87ab196   ./dbomni/app/Http/Controllers/Api/GroupOrderController.php
1562067f5c24900f9a89e443cd107e1ba932d180f3c1a7f76ec26c6dcd65829b   ./dbomni/app/Http/Controllers/Api/LeaveRequestController.php
67c9f702cd763223518e599e5a17ff2ba414e426569af03909458f0c3300c288   ./dbomni/app/Http/Controllers/Api/MembershipTierController.php
9b0a1c691685aeec4cd8a7fa6693ce36b2e0dff622542ffc59eb3bd3113a5b73   ./dbomni/app/Http/Controllers/Api/OnlineOrderController.php
66d29f1637c35977a380899b63d1948436e0d1c985c5407fbc2e878829f3c0ab   ./dbomni/app/Http/Controllers/Api/OptionGroupController.php
283520529b1f790bcda0254c8c79b3d5fc16cbd5b4da8eab35483d75c9a8ee15   ./dbomni/app/Http/Controllers/Api/OutboundController.php
2d8c70862da1544d5a3b07b45c099660156ed9165bc98c0709b823466d497c55   ./dbomni/app/Http/Controllers/Api/ProductController.php
4d7b83c0ed3f6584e0984fa6cf37b498e984dbe1579dd22f6b0998514e1493fc   ./dbomni/app/Http/Controllers/Api/ProductionController.php
b495716104a14faee20131494f129b3e661ab846668ef2518777c463d47d4ac6   ./dbomni/app/Http/Controllers/Api/RDController.php
0ebae268afaeb11b168e884fd4b49723f87c681a73cb467628487249d65b8c86   ./dbomni/app/Http/Controllers/Api/ReportController.php
f36a6d29d05f9024242cc32a8f4eb77d1274719d68234281e274e9215a91c9f9   ./dbomni/app/Http/Controllers/Api/ShiftLeaveController.php
8bed086771c5c82308188dbc4fb0c541dfcb690a03d5cd0356d138f2ef71977b   ./dbomni/app/Http/Controllers/Api/TransactionController.php
2492858e5aad6023ed915f5c6b99e78a8adb1ed0752b5fce178b593affcb65ce   ./dbomni/app/Http/Controllers/Api/ZaloAuthController.php
9e693a4ec9eda3e3d2e8a588b336476ef99908e28ebad37fe486b4ba65725367   ./dbomni/app/Models/Branch.php
ab6724dfce1a7a15f26fe441c313436f96d76e42e706cc6e1493d34c3ec944cc   ./dbomni/app/Models/Customer.php
a722fa2739d743adc9f018a4f5fe923d05096e19c3b8781564e529cb590081aa   ./dbomni/app/Models/CustomerSession.php
e4945de079166268569233ab01fe7137ff5db6e814d22c242ea37c9afc7dd3e1   ./dbomni/app/Models/Order.php
70c17abfd5ab464376f442887ed48acf19c09e3ef548e3478a0c5cd5d8aa9a08   ./dbomni/app/Models/ProductionRecipe.php
11f9ea92ff1a6e67b674d2712b1c10a05196cd3f28c1b554030ff891c257d021   ./dbomni/app/Models/RdRecipe.php
325afb44cde63cbe98e48bd5e3e3f4f2d123cd43b9890014801f255734494833   ./dbomni/app/Models/Recipe.php
b567245212648635f739fae94d7525bba17122c0eead2804d3ec04b062b01e11   ./dbomni/app/Services/CustomerIdentityService.php
d066c8c49628e89262e48a6b07e1ed719951d4505797be93ba62df93105545a3   ./dbomni/app/Services/CustomerSessionService.php
0aee06c20455a869768ff82742501a0dd856359b53d7fc2f52cb24101e978125   ./dbomni/app/Services/LoyaltyService.php
5860c468a0786b05e83c956ec2e3ca25fc0ff5b011e00900c847fc4d99efd12b   ./dbomni/app/Services/ZaloAuthService.php
417b43d91c183c3729cdfdfa45e2590a9064fc334479fc8efcb5f9affb61d3fe   ./dbomni/app/Support/CustomerPasswordValidator.php
6eea6dcb0287a5c1c76870f037cf7e570ddf8e43dd8a0910c5d503959c0ac577   ./dbomni/app/Support/RecipeUnitResolver.php
855219ea6671476f719f43679411b5f1be7fc6ce752eee50d2192e18e1be74fe   ./dbomni/database/migrations/2026_11_05_000095_create_order_code_counters.php
9a731d134565b018144ceca226ce3b1853640a2210722eaa661b92768d0bfa29   ./dbomni/database/migrations/2026_11_05_000096_add_reject_reason_to_leave_requests.php
5866c6ed656a7cd514a5601704cf9f2977e1a9cb7e6eee3ef95d4e6be71c6966   ./dbomni/database/migrations/2026_11_05_000097_widen_transactions_status_enum.php
2dbeea4f117b4a780c818602df87484b69176d92087383e902aeea78e505340d   ./dbomni/database/migrations/2026_11_05_000098_customer_password_sessions.php
7a01df422c0a5d661b3d71704ffd79840de00cce128c346758f698b5b106e747   ./dbomni/database/migrations/2026_11_05_000099_recipe_display_units.php
32a3422933d4279da9abda98570b836e35e5250cf3a3affa3cb5fa3315ffe38b   ./dbomni/routes/api.php
a8311d45d18ec680e80c144e6495d63101f5c0c6d16714b77dbbd3c259c4708e   ./fnb-frontend/src/components/HubPinPrompt.jsx
e0d531381b679d39b0844cf23882c72a010d97d02aab8a246d8971c9002cbda9   ./fnb-frontend/src/components/PosScreen.jsx
c9e3e3f6c50b3b065443c46e1f283836e548e772bf42dbdd2b6c10afaf1ab470   ./fnb-frontend/src/pages/ChamCong.jsx
2c61c8110834e9fa14fb9adac559d551ca3b279603d76ad5b0b1ce47210f7014   ./fnb-frontend/src/pages/CheBien.jsx
eb5287ab0cfae8d1abc7c5218f4a2f8539aaa20e1f6d50073693eb8fa010e12c   ./fnb-frontend/src/pages/ChuyenKho.jsx
c4ede495694d549af043b765c1507ecbdffcc3247043b65b771ed8dec94a0ca7   ./fnb-frontend/src/pages/DangKyCa.jsx
607aa4d0c2c3eb993a94b16315ea1cee24c7b798dea6614b1ee67f3d0b50e761   ./fnb-frontend/src/pages/KiemKe.jsx
27cc4913517e779bd4aef46d9eea125e050982a147d4b2e67986b91b576348ee   ./fnb-frontend/src/pages/Loi3Chuyen.jsx
cda496e41f12a51c0b9b513a02c3e6833b09031e5c2ad8e78641533b3f53eaee   ./fnb-frontend/src/pages/NhapKho.jsx
14eba770a16eb73471e0325fd03c630e50dc472e6b12c21ec6136957457c41fe   ./fnb-frontend/src/pages/StaffHub.jsx
24427ab48fddd246ffc866fda05347193f7da75f04600881b9f5527e4728cc6d   ./fnb-frontend/src/pages/XinNghi.jsx
91b7fbd0fa09dc5ac1f39a23e7cac54d38ef2ca1edccf637b2cc45de0a471d30   ./fnb-frontend/src/pages/XuatKho.jsx
015d33b1d8636b8103303d3e628a1cff66da9e2440dbde8f4fda8d85bd2ba9ae   ./fnb-frontend/src/pages/admin/Customers.jsx
182d418503f5c7da8785258bbbf8b61f35a10dfbbd7e2acd2b123c944ff88375   ./fnb-frontend/src/pages/admin/Inventory.jsx
0cb0d2ab2233df385acaa6ab64131d8a908aa7b58202867f89ddb85aed49e233   ./fnb-frontend/src/pages/admin/LeaveRequests.jsx
9a9d30fe21f77b44d33283c36a5aab2c97c6195ffe0e35c5ae87782c7ae2f466   ./fnb-frontend/src/pages/admin/MemberTiers.jsx
d4cbd24e1009c5404c34193f43e253730ec1d62eb7ef6b0f498302027715951c   ./fnb-frontend/src/pages/admin/OptionGroups.jsx
741c53534d7558ea92560264fb07573755e4257c07d55926b3f31247009f5b3c   ./fnb-frontend/src/pages/admin/Products.jsx
1a8a42e1b49a8457f29c33546a7e73502707fb5b0e30fbbd454d9b84d6a41f28   ./fnb-frontend/src/pages/admin/RdDrafts.jsx
31206b8c4956397b24176f65f3bc801ff57a379d5af13b13225ab1592736ea40   ./fnb-frontend/src/pages/admin/Transactions.jsx
3687ee2d821fb8abb12e5da4b7fad9ffc7dc9a5b847c5d6fcc28e80897906061   ./fnb-frontend/src/pages/hub/Approvals.jsx
57fa75245fd20d542a15cd7364a66caf0d6e64eecc1643d1206bac40590cab07   ./fnb-frontend/src/styles/matcha.css
939ca153819152a2e2653486000d311bcf92b6b7c29a52b3e4321068d2fa1cad   ./fnb-frontend/src/utils/recipeUnits.js
f3d6d818efefc36890e846d87cab10fba55c29a1360a566f5017ebeebe06df5a   ./fnb-frontend/src/utils/staffPin.js
1846f9ee112b7d58285062aba445c6fcf28ac725fd085c0295f0e0ceaba12e38   ./fnb-frontend/src/utils/staffSession.js
539b8a4ce266715f7f63c41691962b1948ac9d728f6a15504ad0e45fbe52ceeb   ./zalo-miniapp/src/api.js
f3e546af4ae8e0652d883c717b33a04f51388c8b4420608fc9b8ff2f67e20df7   ./zalo-miniapp/src/components/PrivacyPolicy.jsx
d5c057dc3c73d5a57e3126a4ea0c5decca1c1d37775cc456d8ef2765abf49f61   ./zalo-miniapp/src/index.css
d98240457a341945ef29f0f3210e4d3113ecb9b51b04d1fe323b7af545580c9c   ./zalo-miniapp/src/pages/Account.jsx
4771dbaea527185580bba653950ab3f77fd787e337a3f132ae5ae169a4712431   ./zalo-miniapp/src/pages/BranchSelect.jsx
caff31dd0c0f361bd1e72ac4b801e086805d6fce1e6e2669a25ab103f5a4dade   ./zalo-miniapp/src/pages/Cart.jsx
80811097dbd53d44060f01d14b809a702356c3ee4532c308a246eec21bc73e6e   ./zalo-miniapp/src/pages/Checkout.jsx
d9ce211cbc3fbf43f5a4e2dcd62901e9b5443d96b55035caeac6dea0d5dacc33   ./zalo-miniapp/src/pages/GroupOrder.jsx
d17f33dea3d41038db42ceeaade074c1bcef9cb8ef4f6038ca971ea815aaf7f6   ./zalo-miniapp/src/pages/Home.jsx
2470f68e9ef4d7555845294972b7c6f1f581fef445a5ab75ec81885481cc0b1e   ./zalo-miniapp/src/pages/TrackOrder.jsx
f4865afaef0a0d12d2abfebedf3f49ed55e2925ecf965e27c255046238512884   ./zalo-miniapp/src/pages/games/HungTranChau.jsx
```
