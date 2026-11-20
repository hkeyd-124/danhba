# Crypto Portfolio Widget

Widget nhỏ gọn cho Windows để theo dõi danh mục đầu tư crypto theo thời gian thực.
Giá lấy trực tiếp từ **Binance USDⓈ-M Futures**. Toàn bộ dữ liệu lưu trên máy.

> Chạy `npm start` để mở widget. Ảnh giao diện: chạy `xvfb-run -a node test/shots.js` (Linux/CI) để tự sinh vào `shots/`.

---

## Tính năng

| | |
|---|---|
| **Widget thật** | Cửa sổ không viền, luôn nổi trên các cửa sổ khác, kéo thả bằng thanh tiêu đề, thu gọn còn một dòng tổng giá trị, ẩn xuống khay hệ thống. |
| **Ghim trên thanh taskbar** | Thu thành một dải mỏng sát thanh taskbar, chỉ hiện tổng giá trị. Bấm vào để bung ra đầy đủ, bấm ra ngoài để thu lại. Xem mục dưới. |
| **Giá thời gian thực** | WebSocket `markPrice@1s` của Binance Futures, có REST fallback khi socket rớt. Tự kết nối lại với backoff. |
| **Nhập tay** | Thêm / sửa / xoá lệnh mua–bán: đồng coin, giá vào, số lượng, phí, thời điểm, ghi chú. |
| **Tính toán** | Giá vốn bình quân gia quyền (phí mua gộp vào giá vốn, phí bán trừ vào lãi thực hiện), P&L thực hiện + chưa thực hiện, % phân bổ danh mục. |
| **Cảnh báo giá** | Đặt ngưỡng trên/dưới cho từng đồng. Chạm ngưỡng → thông báo Windows + âm thanh. Chỉ bắn khi giá **cắt qua** ngưỡng, có cooldown 5 phút. |
| **Giao diện tuỳ biến** | 7 kiểu nền (Đậm, Đen, Kính mờ, **Trong suốt**, **Chỉ chữ**, Aurora, Sáng), độ đục nền 0–100%, 8 màu chữ dựng sẵn + bảng chọn màu tuỳ ý. Tất cả lưu trên máy. |
| **Chế độ "Chỉ chữ"** | Không nền, không viền, không bóng đổ — chỉ còn chữ, nhìn thẳng ra desktop. Chữ có viền tương phản tự đổi theo màu chữ nên vẫn đọc rõ trên mọi hình nền. |
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
5. Nút **📌** bật/tắt luôn nổi. Nút **▾** thu gọn. Nút **✕** ẩn xuống khay — bấm icon khay để mở lại.

### Chế độ ghim trên thanh taskbar

Widget có thể sống như một **dải mỏng nằm sát thanh taskbar**, thay vì một cửa sổ nổi.

**Bật:** bấm **⚙** → mục **Vị trí** → chọn **Trên taskbar**. (Hoặc chuột phải icon khay → *Ghim trên thanh taskbar*.)

**Cách hoạt động:**

| Trạng thái | Trông thế nào |
|---|---|
| Bình thường | Dải cao 44px, rộng 300px, chỉ hiện **tổng giá trị** + P&L. Không tab, không nhãn thừa. |
| Bấm vào dải | Bung ra đầy đủ giao diện (danh mục, lệnh, cảnh báo) — mở **lên trên** khỏi taskbar. |
| Bấm ra ngoài | Tự thu lại về dải. |
| Bấm ▾ | Thu lại ngay. |

Dải nằm **trong vùng làm việc**, sát mép trong của taskbar, nên **không che** các nút trên taskbar. Vị trí ngang và kích thước panel được nhớ; bật/tắt chế độ này cũng được nhớ sau khi tắt mở app.

**Tự thu lại khi bấm ra ngoài** — bật/tắt được ở **⚙ → Vị trí**. Mặc định **Bật**. Tắt nếu bạn muốn panel mở mãi cho đến khi tự thu gọn.

> Chế độ này **chỉ áp dụng khi đã ghim**. Ở chế độ cửa sổ nổi, widget không tự thu lại khi bạn bấm sang cửa sổ khác — nếu không nó sẽ biến mất giữa lúc bạn đang xem.

> Đang mở form thêm lệnh hay hộp thoại xác nhận thì widget **không** thu lại, kể cả khi hộp thoại làm mất focus.

### Tuỳ chỉnh giao diện

Bấm nút **⚙** ở chân widget (cạnh "Dữ liệu trên máy") để mở bảng **Giao diện**.

**Kiểu nền** — 7 lựa chọn:

| Kiểu | Trông thế nào |
|---|---|
| **Đậm** | Nền xanh đen có quầng sáng, mặc định. |
| **Đen** | Đen tuyệt đối, hợp màn hình OLED. |
| **Kính mờ** | Nền bán trong suốt tông xanh. |
| **Trong suốt** | Nhìn xuyên qua thấy desktop phía sau. |
| **Chỉ chữ** | Không nền, không viền, không bóng đổ — chỉ còn chữ. Xem mục dưới. |
| **Aurora** | Dải màu chuyển sắc xanh–tím. |
| **Sáng** | Nền sáng cho môi trường nhiều ánh sáng. |

**Độ đục nền** — thanh trượt 0–100%. Kéo xuống thấp để nhìn xuyên qua desktop. Chọn kiểu *Trong suốt* lần đầu sẽ tự hạ độ đục xuống 35% để bạn thấy ngay tác dụng. Thanh trượt này **ẩn** ở kiểu *Chỉ chữ* vì không có nền để làm đục.

**Màu chữ** — 8 ô màu dựng sẵn (trắng, trắng tinh, xanh nhạt, mint, vàng, hồng, than) hoặc bấm ô cầu vồng để chọn màu bất kỳ.

**Kích thước** — kéo 8 cạnh/góc cửa sổ để đổi kích thước, hoặc bấm **Về mặc định** (420×660).

> Mọi tuỳ chỉnh được ghi ngay vào `portfolio.json` và **giữ nguyên sau khi tắt mở app**.

### Chế độ "Chỉ chữ" — không nền, không khung

Chọn kiểu nền **Chỉ chữ** là widget **không vẽ gì cả**: không nền, không viền, không bo góc, không bóng đổ. Mọi pixel không phải chữ đều trong suốt hoàn toàn, nên bạn nhìn thẳng ra desktop phía sau.

**Làm sao chữ vẫn đọc rõ trên mọi hình nền?** Mỗi ký tự có một **viền tương phản** vẽ *phía sau* nét chữ (`-webkit-text-stroke` + `paint-order: stroke fill`), nên hình chữ không bị dày lên hay nhoè đi. Màu viền được chọn tự động bằng cách tính cả hai khả năng rồi lấy cái cho tương phản cao hơn:

- Chữ sáng → viền gần đen
- Chữ tối → viền gần trắng
- Chữ vàng, xanh accent → viền đen
- Số lãi/lỗ xanh lá và đỏ có **viền riêng** của chính nó (không dùng viền của màu chữ chính), vì xanh lá trên nền trắng chỉ đạt 2.2:1 — không đọc được.

**Thanh trượt "Quầng chữ"** (0–100%, mặc định 70%) chỉnh độ dày viền. Tăng lên nếu hình nền desktop của bạn rất sáng hoặc rối.

Đã đo bằng số: mọi phần tử đạt **WCAG AA (≥4.5:1)** so với viền của chính nó, thấp nhất **6.53:1**; chữ chính đạt **21:1**. Kiểm chứng thêm bằng cách so ảnh chụp trên nền trắng tuyệt đối và nền đen tuyệt đối: pixel viền chỉ đổi **3–4/255** trong khi nền đổi 173–230 — tức hình nền không lọt qua được viền.

**Thanh tiêu đề** ở chế độ này còn tối giản hơn: không có dải nền, chỉ 3 nút tròn nhỏ ở góc phải hiện ra khi rê chuột vào mép trên. Vùng còn lại của mép trên vẫn là tay nắm kéo thả.

**Tay nắm resize** không vẽ gì khi bình thường; chỉ hiện một vạch mảnh khi rê chuột đúng vào cạnh/góc — để vẫn kéo giãn được mà không phá vỡ cam kết "không khung".

**Hộp thoại** (thêm lệnh, cài đặt) vẫn có nền riêng — chúng chỉ hiện tạm thời và cần đọc được, nên không áp dụng chế độ trong suốt cho chúng.

### Thanh tiêu đề tự ẩn

Widget **không có thanh tiêu đề** khi bình thường — chỉ có nội dung. Rê chuột vào **mép trên** là thanh tiêu đề hiện ra (mờ dần trong 0.16 giây) với 3 nút: **📌** ghim, **▾** thu gọn, **✕** ẩn. Rời chuột là nó tự ẩn lại.

Vẫn kéo thả widget được: giữ chuột ở mép trên và kéo — vùng đó luôn là tay nắm di chuyển, kể cả khi thanh tiêu đề đang ẩn.

### Phím tắt & thao tác

| Thao tác | Kết quả |
|---|---|
| Kéo mép trên | Di chuyển widget |
| Kéo cạnh / góc | Đổi kích thước widget |
| Bấm vào dải (khi ghim taskbar) | Bung ra đầy đủ |
| Bấm ra ngoài (khi ghim taskbar) | Thu lại về dải |
| `Esc` | Đóng hộp thoại đang mở |
| Click icon khay | Hiện / ẩn widget |
| Chuột phải icon khay | Menu: Hiện/Ẩn, Ghim trên thanh taskbar, Luôn nổi, Thoát |

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
- Tuỳ chỉnh giao diện nằm trong `settings` của cùng file đó: `theme`, `textColor`, `bgAlpha`, `halo`, `bounds`, `expandedHeight`, và cho chế độ ghim taskbar: `dockToTaskbar`, `dockX`, `dockWidth`, `collapseOnBlur`. Xoá các khoá này là về mặc định.

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
npm run test:e2e  # 107 assertion: thêm/sửa/xoá lệnh, tick giá, cảnh báo, thu gọn, reload,
                  # theme nền, màu chữ, độ đục, thanh tiêu đề tự ẩn, tay nắm resize,
                  # chế độ ghim taskbar (dải, bấm mở, bấm ra ngoài thu lại)
```

### Kiểm chứng nền trong suốt thật

Test riêng, chứng minh cửa sổ **thật sự** có kênh alpha chứ không chỉ vẽ màu bán trong suốt:

```bash
xvfb-run -a -s "-screen 0 1280x900x24 +extension Composite" \
  sh -c 'xcompmgr -c & sleep 2; node test/transparency.js'
```

Cách nó chứng minh: trên X11, cửa sổ nhìn xuyên qua được phải có visual **32-bit ARGB**; cửa sổ đục chỉ được cấp visual 24-bit và alpha bị server bỏ qua. Test đọc depth của cửa sổ widget.

Kết quả đo được:

| Điều kiện | Depth | Kết luận |
|---|---|---|
| Có compositor (`xcompmgr`) | **32** | Trong suốt thật |
| Không có compositor | 24 | Đục — đúng như dự đoán |

Sự khác biệt này chính là bằng chứng: depth đổi theo compositor nghĩa là cửa sổ thực sự yêu cầu alpha, chứ không phải luôn đục rồi bị CSS che.

> Trên Windows, Desktop Window Manager luôn bật, nên điều kiện tương đương "có compositor" luôn thoả.

---

## Cấu trúc

```
crypto-widget/
├── main.js              # main process: cửa sổ, tray, IPC, thông báo
├── preload.js           # cầu nối hẹp giữa main và renderer
├── src/
│   ├── portfolio.js     # toán danh mục (thuần, không I/O)
│   ├── feed.js          # Binance Futures WS + REST fallback
│   ├── alerts.js        # engine cảnh báo (edge-triggered)
│   └── store.js         # lưu JSON atomic
├── renderer/
│   ├── index.html
│   ├── styles.css         # 7 theme nền (gồm "Chỉ chữ"), thanh tiêu đề tự ẩn, tay nắm resize
│   ├── dock.css           # bố cục dải ghim taskbar (nạp sau styles.css)
│   └── app.js             # render + bảng tuỳ chỉnh giao diện
├── build/               # icon
└── test/                # unit + e2e + screenshot + transparency harness
```

### Kiểm thử chế độ ghim taskbar

```bash
xvfb-run -a node test/e2e.js        # 107 assertion, gồm 20 cho chế độ ghim
xvfb-run -a node test/dock-shots.js # ảnh chụp dải ghim → shots-dock/
xvfb-run -a node test/dock-measure.js # số đo hình học thật của dải
```

Bộ e2e kiểm: dải chỉ hiện tổng (không tab, không hero), cửa sổ thật sự cao ≤60px, bấm dải thì bung ra, thu lại về dải, **tổng không bị cắt** (`scrollWidth ≤ clientWidth`), **nút thanh tiêu đề không đè lên tổng** (so bounding box), P&L nhường chỗ khi thanh tiêu đề mở, bấm ra ngoài thì thu lại, form đang mở thì **không** thu, tắt tuỳ chọn thì blur không làm gì, và chế độ ghim sống sót qua reload.

> Sandbox không có window manager nên không thể tạo focus change thật. Vì vậy main process đăng ký hook `test-blur` **chỉ khi `CPW_TEST=1`**, bắn đúng handler mà OS sẽ bắn — để nhánh code thật được kiểm chứ không phải giả định.

---

## Ghi chú kỹ thuật

- **Vì sao `markPrice` chứ không phải `miniTicker`?** `markPrice` là giá dùng để tính P&L và thanh lý trên Futures — đúng thứ một người giữ vị thế futures quan tâm.
- **Taskbar ở cạnh nào?** Không có API cho việc này, nhưng suy ra được: taskbar là dải mà *work area* loại trừ khỏi *bounds* của màn hình. Taskbar tự ẩn báo work area bằng cả màn hình, khi đó mặc định là `bottom`.
- **Vì sao dải ghim bỏ nhãn "Tổng giá trị"?** Ở 44px và 300px, nhãn + P&L lấy hết chỗ và **cắt cụt con số** thành `58,60…` — đúng thứ quan trọng nhất lại không đọc được. Ảnh chụp bắt được lỗi này; giờ nhãn bị bỏ, con số không bao giờ bị ellipsis, và P&L bị giới hạn 46% bề rộng.
- **Đường dẫn `/market`:** từ 2026 Binance định tuyến stream; `@markPrice` nằm trên `/market`, kết nối không có path sẽ **im lặng không nhận gì**. Code dùng `wss://fstream.binance.com/market/stream?streams=...`.
- **Cảnh báo edge-triggered:** nếu giá đứng yên trên ngưỡng, bạn không bị spam thông báo. Phải quay lại phía bên kia rồi cắt qua lần nữa (và qua cooldown 5 phút).
- **Bán quá số đang giữ:** bị chặn ở số lượng thực có, kèm cảnh báo vàng ở chân widget — không âm thầm tính sai.

---

## Giấy phép

MIT
