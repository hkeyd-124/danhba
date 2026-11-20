# Crypto Portfolio Widget

Widget nhỏ gọn cho Windows để theo dõi danh mục đầu tư crypto theo thời gian thực.
Giá lấy trực tiếp từ **Binance USDⓈ-M Futures**. Toàn bộ dữ liệu lưu trên máy.

> Chạy `npm start` để mở widget. Ảnh giao diện: chạy `xvfb-run -a node test/shots.js` (Linux/CI) để tự sinh vào `shots/`.

---

## Tính năng

| | |
|---|---|
| **Widget thật** | Cửa sổ không viền, luôn nổi trên các cửa sổ khác, kéo thả bằng mép trên, thu gọn còn một dòng tổng giá trị, ẩn xuống khay hệ thống. |
| **Giá thời gian thực** | WebSocket `markPrice@1s` của Binance Futures, có REST fallback khi socket rớt. Tự kết nối lại với backoff. |
| **Nhập tay** | Thêm / sửa / xoá lệnh mua–bán: đồng coin, giá vào, số lượng, phí, thời điểm, ghi chú. |
| **Tính toán** | Giá vốn bình quân gia quyền (phí mua gộp vào giá vốn, phí bán trừ vào lãi thực hiện), P&L thực hiện + chưa thực hiện, % phân bổ danh mục. |
| **Cảnh báo giá** | Đặt ngưỡng trên/dưới cho từng đồng. Chạm ngưỡng → thông báo Windows + âm thanh. Chỉ bắn khi giá **cắt qua** ngưỡng, có cooldown 5 phút. |
| **Giao diện tuỳ biến** | 6 kiểu nền (Đậm, Đen, Kính mờ, **Trong suốt**, Aurora, Sáng), độ đục nền 0–100%, 8 màu chữ dựng sẵn + bảng chọn màu tuỳ ý. Tất cả lưu trên máy. |
| **Thanh tiêu đề tự ẩn** | Chỉ hiện khi rê chuột vào mép trên. Bình thường widget không có thanh tiêu đề — tối giản tối đa. |
| **Kéo giãn cửa sổ** | Kéo 8 cạnh/góc để đổi kích thước, có nút "Về mặc định". Kích thước được nhớ. |
| **Riêng tư** | Không tài khoản, không API key, không Firestore, không telemetry. Chỉ một kết nối ra ngoài duy nhất: Binance Futures. |

---

## Yêu cầu

- **Windows 10/11 (64-bit)**
- **Node.js 18+** (khuyến nghị 20 LTS) — chỉ cần khi build từ source

---

## Chạy nhanh (từ source)

```bat
git clone https://github.com/hkeyd-124/danhba.git
cd danhba\crypto-widget
npm install
npm start
```

`npm install` sẽ tải Electron (~200 MB) ở lần đầu.

---

## Build ra file .exe

```bat
cd crypto-widget
npm install
npm run dist
```

Kết quả trong thư mục `dist\`:

- `Crypto Portfolio Widget Setup 1.0.0.exe` — bộ cài NSIS (tạo shortcut Desktop + Start Menu, cho chọn thư mục cài)
- `Crypto Portfolio Widget 1.0.0.exe` — bản **portable**, chạy ngay không cần cài

Chỉ muốn bản portable:

```bat
npm run dist:portable
```

> **Lưu ý:** build lần đầu cần internet để tải `electron-builder` và bộ binary Windows.
> Nếu mạng công ty chặn, đặt biến môi trường proxy trước khi build:
> ```bat
> set HTTPS_PROXY=http://proxy:port
> ```

> **Nếu bước nén báo lỗi `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`:** máy build không đủ RAM cho mức nén mặc định (`-mx=9` cần ~1 GB trở lên). Thêm vào `package.json`:
> ```json
> "compression": "store"
> ```
> (hoặc `"normal"`), rồi chạy lại. File .exe sẽ lớn hơn nhưng build được trên máy yếu.

### Ký số (tuỳ chọn)

Bản build không ký sẽ bị SmartScreen cảnh báo lần đầu chạy. Để ký, đặt các biến môi trường
`CSC_LINK` (đường dẫn file .pfx) và `CSC_KEY_PASSWORD` rồi chạy lại `npm run dist`.

---

## Sử dụng

1. Mở app → widget hiện ở góc trên bên phải màn hình.
2. Tab **Lệnh** → `+ Thêm lệnh` → nhập đồng coin (gõ `BTC` là đủ, tự thêm `USDT`), giá vào, số lượng, phí.
3. Tab **Danh mục** hiện giá vốn, giá hiện tại, P&L và % phân bổ, cập nhật theo từng tick giá.
4. Tab **Cảnh báo** → `+ Thêm` → chọn "vượt lên trên" hoặc "giảm xuống dưới", nhập ngưỡng.
5. Rê chuột vào **mép trên** để hiện thanh tiêu đề: **📌** bật/tắt luôn nổi, **▾** thu gọn, **✕** ẩn xuống khay — bấm icon khay để mở lại.

### Tuỳ chỉnh giao diện

Bấm nút **⚙** ở chân widget (cạnh "Dữ liệu trên máy") để mở bảng **Giao diện**.

**Kiểu nền** — 6 lựa chọn:

| Kiểu | Trông thế nào |
|---|---|
| **Đậm** | Nền xanh đen có quầng sáng, mặc định. |
| **Đen** | Đen tuyệt đối, hợp màn hình OLED. |
| **Kính mờ** | Nền bán trong suốt tông xanh. |
| **Trong suốt** | Nhìn xuyên qua thấy desktop phía sau. |
| **Aurora** | Dải màu chuyển sắc xanh–tím. |
| **Sáng** | Nền sáng cho môi trường nhiều ánh sáng. |

**Độ đục nền** — thanh trượt 0–100%. Kéo xuống thấp để nhìn xuyên qua desktop. Chọn kiểu *Trong suốt* lần đầu sẽ tự hạ độ đục xuống 35% để bạn thấy ngay tác dụng.

**Màu chữ** — 8 ô màu dựng sẵn (trắng, trắng tinh, xanh nhạt, mint, vàng, hồng, than) hoặc bấm ô cầu vồng để chọn màu bất kỳ.

**Kích thước** — kéo 8 cạnh/góc cửa sổ để đổi kích thước, hoặc bấm **Về mặc định** (420×660).

> Mọi tuỳ chỉnh được ghi ngay vào `portfolio.json` và **giữ nguyên sau khi tắt mở app**.

### Thanh tiêu đề tự ẩn

Widget **không có thanh tiêu đề** khi bình thường — chỉ có nội dung. Rê chuột vào **mép trên** là thanh tiêu đề hiện ra (mờ dần trong 0.16 giây) với 3 nút: **📌** ghim, **▾** thu gọn, **✕** ẩn. Rời chuột là nó tự ẩn lại.

Vẫn kéo thả widget được: giữ chuột ở mép trên và kéo — vùng đó luôn là tay nắm di chuyển, kể cả khi thanh tiêu đề đang ẩn.

### Phím tắt & thao tác

| Thao tác | Kết quả |
|---|---|
| Kéo mép trên | Di chuyển widget |
| Kéo cạnh / góc | Đổi kích thước widget |
| `Esc` | Đóng hộp thoại đang mở |
| Click icon khay | Hiện / ẩn widget |
| Chuột phải icon khay | Menu: Hiện/Ẩn, Luôn nổi, Thoát |

---

## Dữ liệu lưu ở đâu

Một file JSON duy nhất:

```
%APPDATA%\crypto-portfolio-widget\portfolio.json
```

Bấm **"Dữ liệu trên máy"** ở chân widget để mở thư mục chứa file này.

- Ghi kiểu **atomic** (ghi file tạm rồi rename) nên mất điện giữa chừng không làm hỏng dữ liệu.
- Nếu file bị hỏng, bản cũ được giữ lại thành `portfolio.json.corrupt-<timestamp>` thay vì bị xoá.
- Sao lưu = copy file đó. Khôi phục = chép đè lại.
- Tuỳ chỉnh giao diện nằm trong `settings` của cùng file đó: `theme`, `textColor`, `bgAlpha`, `bounds`, `expandedHeight`. Xoá các khoá này là về mặc định.

---

## Bảo mật — những gì được đảm bảo

Đây là các biện pháp **được enforce trong code**, không chỉ là lời hứa:

1. **Renderer không có mạng.** `index.html` có CSP `connect-src 'none'`, và main process chặn mọi `will-navigate`, `window.open`, `webview`, và từ chối mọi permission request. Test e2e kiểm chứng `fetch()` từ renderer bị chặn.
2. **Chỉ main process mở socket**, và chỉ tới `fstream.binance.com` / `fapi.binance.com`.
3. **`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.** Renderer không có `require`, không chạm được filesystem.
4. **Không có API key, không có chữ ký request.** Chỉ đọc dữ liệu công khai của sàn — không thể đặt lệnh, không thể rút tiền.
5. **Không telemetry, không analytics, không crash reporting.**
6. **Tuỳ chỉnh giao diện không thêm kết nối nào.** Nền trong suốt, màu chữ, kích thước cửa sổ đều là CSS và API cửa sổ của Electron — không tải ảnh nền từ mạng, không gọi dịch vụ ngoài. Kết nối ra ngoài vẫn chỉ có Binance Futures.

Muốn tự kiểm chứng: bật Wireshark/Resource Monitor và xem tiến trình chỉ nói chuyện với `binance.com`.

---

## Kiểm thử

```bat
npm test          :: 22 unit test (toán danh mục + feed + cảnh báo)
```

Test e2e chạy Electron thật (cần Linux + Xvfb, dùng trong CI):

```bash
npm run test:e2e  # 61 assertion: thêm/sửa/xoá lệnh, tick giá, cảnh báo, thu gọn, reload,
                  # theme nền, màu chữ, độ đục, thanh tiêu đề tự ẩn, tay nắm resize
```

---

## Cấu trúc

```
crypto-widget/
├── main.js              # main process: cửa sổ trong suốt, tray, IPC, thông báo, resize
├── preload.js           # cầu nối hẹp giữa main và renderer
├── src/
│   ├── portfolio.js     # toán danh mục (thuần, không I/O)
│   ├── feed.js          # Binance Futures WS + REST fallback
│   ├── alerts.js        # engine cảnh báo (edge-triggered)
│   └── store.js         # lưu JSON atomic
├── renderer/
│   ├── index.html
│   ├── styles.css         # 6 theme nền, thanh tiêu đề tự ẩn, tay nắm resize
│   └── app.js             # render + bảng tuỳ chỉnh giao diện
├── build/               # icon
└── test/                # unit + e2e + screenshot harness
```

---

## Ghi chú kỹ thuật

- **Vì sao `markPrice` chứ không phải `miniTicker`?** `markPrice` là giá dùng để tính P&L và thanh lý trên Futures — đúng thứ một người giữ vị thế futures quan tâm.
- **Đường dẫn `/market`:** từ 2026 Binance định tuyến stream; `@markPrice` nằm trên `/market`, kết nối không có path sẽ **im lặng không nhận gì**. Code dùng `wss://fstream.binance.com/market/stream?streams=...`.
- **Cảnh báo edge-triggered:** nếu giá đứng yên trên ngưỡng, bạn không bị spam thông báo. Phải quay lại phía bên kia rồi cắt qua lần nữa (và qua cooldown 5 phút).
- **Bán quá số đang giữ:** bị chặn ở số lượng thực có, kèm cảnh báo vàng ở chân widget — không âm thầm tính sai.
- **Vì sao cửa sổ luôn `transparent: true`?** Để đổi kiểu nền không cần tạo lại cửa sổ — mọi kiểu nền đều do CSS vẽ, nên chuyển theme tức thì và không mất trạng thái (vị trí cuộn, ô đang gõ).
- **Vì sao phải tự làm resize?** Cửa sổ trong suốt không viền **không có viền resize gốc của Windows**. Renderer vẽ 8 dải vô hình ở cạnh/góc; main process theo con trỏ chuột để đổi kích thước (một timer 16 ms, không gửi IPC mỗi lần di chuột).
- **Vì sao thanh tiêu đề cần một dải cảm biến riêng?** Vùng `-webkit-app-region: drag` nuốt sự kiện chuột, nên bản thân thanh tiêu đề không tự phát hiện được hover. Dải `.tb-zone` nằm dưới, không phải vùng kéo, nên báo hover tin cậy; khi thanh hiện ra thì nó phủ lên dải đó và nhận việc kéo.

---

## Giấy phép

MIT
