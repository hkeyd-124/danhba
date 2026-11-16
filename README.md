# Mô phỏng Danh bạ — iOS & Android

Web mô phỏng ứng dụng **Danh bạ** trên điện thoại / iPad, dành cho học sinh thực hành cách lưu số vào danh bạ.

## Tính năng

- **Chọn hệ điều hành trước khi vào**: iOS hoặc Android.
- **Khung thiết bị dựng bằng CSS**: Dynamic Island, status bar, home indicator (iOS); camera đục lỗ, thanh gesture (Android).
- **Hình nền tươi sáng** cho màn hình chính, có dock và lưới ứng dụng.
- **Hai giao diện Danh bạ song song**, mỗi bên theo đúng ngôn ngữ thiết kế của hệ điều hành:
  - **iOS**: large title, ô tìm kiếm, nhóm chữ cái A–Z, thanh index bên phải, nút `+` ở góc trên, nút `Sửa` ở chi tiết, form `Huỷ / Xong`, action sheet, alert xác nhận xoá.
  - **Android (Material)**: app bar, ô tìm kiếm dạng pill, nhóm chữ cái, FAB `+`, bottom navigation, menu `⋮` (Sửa / Chia sẻ / Xoá), form có nút back + `Lưu`, dialog xác nhận, snackbar có `HOÀN TÁC`.
- **Luồng đầy đủ**: xem danh sách → xem chi tiết → thêm mới → sửa → xoá → tìm kiếm.
- **Lưu local**: toàn bộ danh bạ lưu trong `localStorage` của trình duyệt, không dùng Firestore hay backend.

## Cấu trúc

```
index.html    # khung màn hình chọn OS + khung thiết bị
styles.css    # toàn bộ style cho thiết bị, iOS và Android
app.js        # dữ liệu, render, điều hướng, localStorage
```

Không cần build, không cần cài đặt. Mở `index.html` là chạy.

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
