# Crypto Portfolio Widget

Widget nhỏ gọn cho Windows để theo dõi portfolio crypto theo thời gian thực.
Giá lấy trực tiếp từ **Binance USDⓈ-M Futures**. Toàn bộ dữ liệu lưu trên máy.

---

## ⚡ Cài đặt trên Windows — chọn 1 trong 2 cách

### Cách A — Chạy bằng file .bat (dễ nhất, khuyến nghị)

1. Tải thư mục `crypto-widget` về máy (giải nén file zip, hoặc `git clone`).
2. Mở thư mục đó. Bạn phải thấy các file: `package.json`, `main.js`, `preload.js`.
3. **Nhấp đúp `RUN-WINDOWS.bat`**.

File `.bat` sẽ tự làm hết: kiểm tra Node.js, cài dependencies lần đầu, rồi mở widget.
Không cần gõ lệnh, không cần `cd`.

> Nếu Windows hiện "Windows protected your PC" → bấm **More info** → **Run anyway**.

### Cách B — Gõ lệnh thủ công

```bat
cd /d "đường_dẫn_đến_thư_mục_có_package.json"
npm install
npm start
```

⚠️ **Quan trọng:** `npm install` phải chạy trong thư mục **có `package.json`**.
Nếu bạn thấy lỗi `ENOENT ... Could not read package.json`, nghĩa là bạn đang ở sai thư mục.

---

## 🩺 Lỗi thường gặp khi cài

### `The system cannot find the path specified.`

Bạn `cd` vào một đường dẫn không tồn tại. Nguyên nhân phổ biến nhất: **giải nén zip bị lồng thêm một cấp thư mục**.

Khi giải nén `crypto-widget.zip` bằng "Extract All" vào `C:\`, Windows tạo ra:

```
C:\crypto-widget\              ← thư mục Windows tự tạo (theo tên file zip)
└── crypto-widget\             ← thư mục THẬT chứa code
    ├── package.json
    ├── main.js
    └── ...
```

Nên `cd C:\crypto-widget` **không** vào được thư mục code — phải là `C:\crypto-widget\crypto-widget`.

**Cách kiểm tra:** mở thư mục trong File Explorer, bạn phải **nhìn thấy `package.json`**.
Nếu chỉ thấy một thư mục con tên `crypto-widget`, hãy đi vào trong đó.

**Cách sửa nhanh:** dùng `RUN-WINDOWS.bat` — nó tự `cd` về đúng thư mục của chính nó.

### `npm error code ENOENT ... Could not read package.json`

Bạn đang chạy `npm install` ở thư mục không có `package.json` (thường là `C:\Users\<tên_bạn>`).
Đây **không phải lỗi của app** — chỉ là sai thư mục.

**Sửa:**
```bat
cd /d "C:\crypto-widget\crypto-widget"
dir package.json
npm install
```
Lệnh `dir package.json` phải in ra thông tin file. Nếu báo "File Not Found" thì bạn vẫn ở sai chỗ.

### `'npm' is not recognized as an internal or external command`

Chưa cài Node.js, hoặc chưa mở lại cửa sổ lệnh sau khi cài.
Tải **Node.js 20 LTS** tại https://nodejs.org/ → cài → **đóng hết** cửa sổ Command Prompt → mở lại.

### `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` khi build

Máy không đủ RAM cho mức nén mặc định của 7-Zip (`-mx=9` cần ~1 GB).
Repo này đã đặt sẵn `"compression": "store"` trong `package.json` nên **không còn gặp lỗi này**.
Nếu bạn đã sửa file và lỗi quay lại, kiểm tra dòng đó còn tồn tại không.

### Thông báo Windows không hiện

Windows chỉ hiển thị toast cho app có **shortcut trong Start Menu** mang đúng AppUserModelID.
Bản **portable** (file .exe chạy trực tiếp) không có shortcut → Windows **âm thầm bỏ qua** thông báo.

- **Cách sửa:** cài bằng bộ **Setup** (`Crypto Portfolio Widget Setup 1.0.0.exe`) thay vì bản portable.
- **Dù thế nào**, app luôn có cảnh báo dự phòng: widget tự bật lên, nháy taskbar và bíp.
- Tab **Cảnh báo** sẽ hiện một ô vàng giải thích nếu phát hiện tình huống này.

---

## Build ra file .exe

```bat
BUILD-WINDOWS.bat
```

hoặc thủ công:

```bat
npm install
npm run dist
```

Kết quả trong `dist\`:

- `Crypto Portfolio Widget Setup 1.0.0.exe` — bộ cài NSIS (tạo shortcut Desktop + Start Menu, cho chọn thư mục cài). **Dùng bản này để thông báo Windows hoạt động đầy đủ.**
- `Crypto Portfolio Widget 1.0.0.exe` — bản **portable**, chạy ngay không cần cài.

Chỉ muốn bản portable:

```bat
npm run dist:portable
```

> **Lưu ý:** build lần đầu cần internet để tải `electron-builder` và bộ binary Windows.
> Nếu mạng công ty chặn, đặt biến môi trường proxy trước khi build:
> ```bat
> set HTTPS_PROXY=http://proxy:port
> ```

### Ký số (tuỳ chọn)

Bản build không ký sẽ bị SmartScreen cảnh báo lần đầu chạy. Để ký, đặt các biến môi trường
`CSC_LINK` (đường dẫn file .pfx) và `CSC_KEY_PASSWORD` rồi chạy lại `npm run dist`.

---

## Tính năng

| | |
|---|---|
| **Widget thật** | Cửa sổ không viền, luôn nổi trên các cửa sổ khác, kéo thả bằng thanh tiêu đề, thu gọn còn một dòng tổng giá trị, ẩn xuống khay hệ thống. |
| **Giá thời gian thực** | WebSocket `markPrice@1s` của Binance Futures, có REST fallback khi socket rớt. Tự kết nối lại với backoff. |
| **Nhập tay** | Thêm / sửa / xoá lệnh mua–bán: đồng coin, giá vào, số lượng, phí, thời điểm, ghi chú. |
| **Tính toán** | Giá vốn bình quân gia quyền (phí mua gộp vào giá vốn, phí bán trừ vào lãi thực hiện), P&L thực hiện + chưa thực hiện, % phân bổ danh mục. |
| **Cảnh báo giá** | Đặt ngưỡng trên/dưới cho từng đồng. Chạm ngưỡng → thông báo Windows + âm thanh. Chỉ bắn khi giá **cắt qua** ngưỡng, có cooldown 5 phút. |
| **Riêng tư** | Không tài khoản, không API key, không Firestore, không telemetry. Chỉ một kết nối ra ngoài duy nhất: Binance Futures. |

---

## Yêu cầu

- **Windows 10/11 (64-bit)**
- **Node.js 18+** (khuyến nghị 20 LTS) — chỉ cần khi build từ source

---

## Chạy nhanh (từ source, dùng git)

```bat
git clone https://github.com/hkeyd-124/danhba.git
cd danhba\crypto-widget
npm install
npm start
```

`npm install` sẽ tải Electron (~200 MB) ở lần đầu.

---

## Sử dụng

1. Mở app → widget hiện ở góc trên bên phải màn hình.
2. Tab **Lệnh** → `+ Thêm lệnh` → nhập đồng coin (gõ `BTC` là đủ, tự thêm `USDT`), giá vào, số lượng, phí.
3. Tab **Danh mục** hiện giá vốn, giá hiện tại, P&L và % phân bổ, cập nhật theo từng tick giá.
4. Tab **Cảnh báo** → `+ Thêm` → chọn "vượt lên trên" hoặc "giảm xuống dưới", nhập ngưỡng.
5. Nút **📌** bật/tắt luôn nổi. Nút **▾** thu gọn. Nút **✕** ẩn xuống khay — bấm icon khay để mở lại.

### Phím tắt & thao tác

| Thao tác | Kết quả |
|---|---|
| Kéo thanh tiêu đề | Di chuyển widget |
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

---

## Bảo mật — những gì được đảm bảo

Đây là các biện pháp **được enforce trong code**, không chỉ là lời hứa:

1. **Renderer không có mạng.** `index.html` có CSP `connect-src 'none'`, và main process chặn mọi `will-navigate`, `window.open`, `webview`, và từ chối mọi permission request. Test e2e kiểm chứng `fetch()` từ renderer bị chặn.
2. **Chỉ main process mở socket**, và chỉ tới `fstream.binance.com` / `fapi.binance.com`.
3. **`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.** Renderer không có `require`, không chạm được filesystem.
4. **Không có API key, không có chữ ký request.** Chỉ đọc dữ liệu công khai của sàn — không thể đặt lệnh, không thể rút tiền.
5. **Không telemetry, không analytics, không crash reporting.**

Muốn tự kiểm chứng: bật Wireshark/Resource Monitor và xem tiến trình chỉ nói chuyện với `binance.com`.

---

## Kiểm thử

```bat
npm test
```

22 unit test (toán danh mục + feed + cảnh báo).

Test e2e chạy Electron thật (cần Linux + Xvfb, dùng trong CI):

```bash
npm run test:e2e
```

33 assertion: thêm/sửa/xoá lệnh, tick giá, cảnh báo, thu gọn, reload, và kiểm tra renderer bị chặn mạng.

---

## Cấu trúc

```
crypto-widget/
├── RUN-WINDOWS.bat      # chạy app bằng 1 cú nhấp đúp (tự cd, tự npm install)
├── BUILD-WINDOWS.bat    # build ra .exe bằng 1 cú nhấp đúp
├── main.js              # main process: cửa sổ, tray, IPC, thông báo
├── preload.js           # cầu nối hẹp giữa main và renderer
├── src/
│   ├── portfolio.js     # toán danh mục (thuần, không I/O)
│   ├── feed.js          # Binance Futures WS + REST fallback
│   ├── alerts.js        # engine cảnh báo (edge-triggered)
│   └── store.js         # lưu JSON atomic
├── renderer/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── build/
│   └── make-icons.js    # sinh icon bằng Node thuần (không cần binary trong repo)
└── test/                # unit + e2e + screenshot harness
```

---

## Ghi chú kỹ thuật

- **Vì sao `markPrice` chứ không phải `miniTicker`?** `markPrice` là giá dùng để tính P&L và thanh lý trên Futures — đúng thứ một người giữ vị thế futures quan tâm.
- **Đường dẫn `/market`:** từ 2026 Binance định tuyến stream; `@markPrice` nằm trên `/market`, kết nối không có path sẽ **im lặng không nhận gì**. Code dùng `wss://fstream.binance.com/market/stream?streams=...`.
- **Cảnh báo edge-triggered:** nếu giá đứng yên trên ngưỡng, bạn không bị spam thông báo. Phải quay lại phía bên kia rồi cắt qua lần nữa (và qua cooldown 5 phút).
- **Bán quá số đang giữ:** bị chặn ở số lượng thực có, kèm cảnh báo vàng ở chân widget — không âm thầm tính sai.
- **Icon:** sinh tự động bằng `build/make-icons.js` (Node thuần, không dependency), nên repo không chứa file nhị phân và icon không bao giờ lệch với source.

---

## Giấy phép

MIT
