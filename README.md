# Mô phỏng Danh bạ — iOS & Android

Web mô phỏng ứng dụng **Danh bạ** trên điện thoại / iPad, dành cho học sinh thực hành cách lưu số vào danh bạ.

## Cấu trúc (2 trang riêng)

```
index.html        # TRANG 1 — chọn hệ điều hành (iOS / Android)
sim.html          # TRANG 2 — sân khấu mô phỏng thiết bị
styles.css        # style cho thiết bị, iOS và Android
app.js            # dữ liệu, render, điều hướng, localStorage
call-message.css  # style cho màn hình gọi và hội thoại tin nhắn
call-message.js   # mô phỏng gọi đi + nhắn tin (nạp sau app.js)
fix-v4.css        # ghi đè: chống chớp tắt + auto scale (nạp cuối)
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
- **Gọi giả**: bấm **Gọi** trong danh bạ để mở màn hình gọi đi — hiện trạng thái "đang gọi…" rồi tự chuyển sang đếm thời gian; có 6 nút tròn (Tắt tiếng, Bàn phím, Loa, Thêm, Video, Danh bạ), bàn phím trong cuộc gọi bấm được, và nút đỏ kết thúc để thoát về. Bố cục khác nhau đúng kiểu iOS và Android.
- **Nhắn tin giả**: bấm **Nhắn tin** để mở hội thoại — gõ và gửi được (nút gửi hoặc phím Enter), bong bóng chat hiện ra đúng kiểu iOS (xanh gradient) và Android (Material You), tin nhắn neo đáy, có nhãn ngày và giờ gửi. Tin nhắn được lưu lại.
- **Luồng đầy đủ**: xem danh sách → xem chi tiết → thêm mới → sửa → xoá → tìm kiếm (gõ không dấu vẫn tìm được).
- **Auto scale**: khung thiết bị tự thu/phóng để luôn hiện trọn trong màn hình, dù để màn hình dọc hay ngang.
- **Lưu local**: toàn bộ danh bạ, tin nhắn và nhật ký lưu trong `localStorage` của trình duyệt, không dùng Firestore hay backend.

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
- Đây là mô phỏng: không có cuộc gọi hay tin nhắn nào thực sự được gửi đi. Các nút ngoài phạm vi (Video, Thêm, Danh bạ trong cuộc gọi, FaceTime…) chỉ hiện thông báo mô phỏng.
