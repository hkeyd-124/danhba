# Mô phỏng Danh bạ — iOS & Android

Web mô phỏng ứng dụng **Danh bạ** trên điện thoại / iPad, dành cho học sinh thực hành cách lưu số vào danh bạ.

## Cấu trúc (2 trang riêng)

```
index.html    # TRANG 1 — chọn hệ điều hành (iOS / Android)
sim.html      # TRANG 2 — sân khấu mô phỏng thiết bị
styles.css    # toàn bộ style cho thiết bị, iOS và Android
app.js        # dữ liệu, render, điều hướng, localStorage
```

Hai trang tách hẳn nhau: `index.html` chỉ để chọn OS, bấm vào thẻ iOS/Android sẽ mở
`sim.html?os=ios` hoặc `sim.html?os=android`. Trong trang mô phỏng có nút
**Đổi hệ điều hành** để quay lại trang chọn.

Không cần build, không cần cài đặt. Mở `index.html` là chạy.

## Tính năng

- **Chọn hệ điều hành trước khi vào**: iOS hoặc Android, mỗi thẻ có ảnh thu nhỏ thiết bị.
- **Khung thiết bị dựng bằng CSS**: Dynamic Island, status bar, home indicator (iOS); camera đục lỗ, thanh gesture (Android).
- **Hình nền tươi sáng** cho màn hình chính, có dock và lưới ứng dụng.
- **Hai giao diện Danh bạ song song**, mỗi bên theo đúng ngôn ngữ thiết kế của hệ điều hành:
  - **iOS**: large title, ô tìm kiếm, nhóm chữ cái A–Z, thanh index bên phải, nút `+` ở góc trên, nút `Sửa` ở chi tiết, form `Huỷ / Xong`, action sheet, alert xác nhận xoá.
  - **Android (Material)**: app bar, ô tìm kiếm dạng pill, nhóm chữ cái, FAB `+`, bottom navigation 3 tab, menu `⋮` (Sửa / Chia sẻ / Xoá), form có nút back + `Lưu`, dialog xác nhận, snackbar có `HOÀN TÁC`.
- **Ảnh đại diện**: chạm vào ảnh trong form để mở bộ chọn — chọn 1 trong 16 màu có sẵn, hoặc tải ảnh lên từ máy (ảnh được cắt vuông và thu nhỏ còn 320px trước khi lưu). Ảnh đại diện hiển thị ở danh sách, màn chi tiết và form, đúng kiểu avatar tròn của từng hệ.
- **Android có 3 tab hoạt động thật**:
  - **Danh bạ** — toàn bộ liên hệ, nhóm A–Z, tìm kiếm.
  - **Yêu thích** — các liên hệ được đánh dấu sao (bật/tắt bằng ngôi sao trên thanh trên cùng hoặc trong menu `⋮`).
  - **Nhật ký** — lịch sử cuộc gọi, nhóm theo Hôm nay / Hôm qua / ngày; bấm "Gọi" trong chi tiết sẽ ghi một mục vào đây; có nút xoá nhật ký.
- **Luồng đầy đủ**: xem danh sách → xem chi tiết → thêm mới → sửa → xoá → tìm kiếm (gõ không dấu vẫn tìm được).
- **Lưu local**: toàn bộ danh bạ lưu trong `localStorage` của trình duyệt, không dùng Firestore hay backend.

## Chạy thử

```bash
# cách 1: mở trực tiếp
open index.html

# cách 2: chạy server tĩnh
python3 -m http.server 8000
# rồi mở http://localhost:8000
```

## Ghi chú

- Dữ liệu chỉ nằm trên máy đang dùng: đổi trình duyệt, đổi thiết bị hoặc xoá dữ liệu trang sẽ mất danh bạ.
- Nút **Đặt lại dữ liệu** đưa danh bạ về danh sách mẫu ban đầu.
- Các chức năng ngoài phạm vi (gọi điện, nhắn tin, FaceTime…) chỉ hiển thị thông báo mô phỏng, không thực hiện cuộc gọi thật.
