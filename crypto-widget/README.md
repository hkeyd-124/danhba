# Crypto Portfolio Widget

Widget nhỏ gọn cho Windows để theo dõi danh mục đầu tư crypto theo thời gian thực.
Giá lấy trực tiếp từ **Binance USDⓈ-M Futures**. Toàn bộ dữ liệu lưu trên máy.

> Chạy `npm start` để mở widget. Ảnh giao diện: chạy `xvfb-run -a node test/shots.js` (Linux/CI) để tự sinh vào `shots/`.

---

## Tính năng

| | |
|---|---|
| **Widget thật** | Cửa sổ không viền, luôn nổi trên các cửa sổ khác, kéo thả bằng thanh tiêu đề, thu gọn còn một dòng tổng giá trị, ẩn xuống khay hệ thống. |
| **Vai trò tiện ích** | Không chiếm chỗ trên taskbar, **không hiện trong Alt+Tab**, luôn nổi trên app khác — nên chuyển sang app khác widget vẫn nằm đó. Xem mục *Vai trò cửa sổ*. |
| **Ba chế độ vị trí** | Cửa sổ nổi, dải sát taskbar, và **dải nằm trong thanh taskbar** (cùng hàng với các icon). Bấm vào để bung ra, bấm ra ngoài để thu lại. Xem mục dưới. |
| **Biểu đồ giá trị** | Đường giá trị danh mục theo thời gian (5 phút / 15 phút / 1 giờ), lấy mẫu mỗi 5 giây, lưu trên máy. Không trục, không lưới — chỉ hình dáng và mức thay đổi. |
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

> **Nếu bước nén báo lỗi `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`:** máy build không đủ RAM cho mức nén mặc định (`-mx=9` cần ~1 GB trở lên). `package.json` đã đặt sẵn `"compression": "store"` để tránh việc này; nếu bạn đã xoá, thêm lại:
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

### Ba chế độ vị trí

Bấm **⚙** → mục **Vị trí**, hoặc chuột phải icon khay → *Vị trí*.

| Chế độ | Trông thế nào |
|---|---|
| **Cửa sổ nổi** | Panel tự do, kéo thả và đổi kích thước tuỳ ý. |
| **Sát taskbar** | Dải mỏng nằm **ngay trên** thanh taskbar, trong vùng làm việc nên không che các nút của taskbar. |
| **Trong taskbar** | Dải nằm **đúng trong hình chữ nhật của thanh taskbar**, cùng hàng với các icon app. |

**Cách hoạt động (cả hai chế độ ghim):**

| Trạng thái | Trông thế nào |
|---|---|
| Bình thường | Dải cao ~40px, chỉ hiện **tổng giá trị** + P&L. Không tab, không nhãn thừa. |
| Bấm vào dải | Bung ra đầy đủ giao diện (danh mục, lệnh, cảnh báo) — mở **lên trên** khỏi taskbar. |
| Bấm ra ngoài | Tự thu lại về dải. |
| Bấm ▾ | Thu lại ngay. |

Vị trí ngang, kích thước panel, và chế độ đang chọn đều được nhớ sau khi tắt mở app.

**Tự thu lại khi bấm ra ngoài** — bật/tắt được ở **⚙ → Vị trí**. Mặc định **Bật**.

> Chế độ này **chỉ áp dụng khi đã ghim**. Ở chế độ cửa sổ nổi, widget không tự thu lại khi bạn bấm sang cửa sổ khác — nếu không nó sẽ biến mất giữa lúc bạn đang xem.

> Đang mở form thêm lệnh hay hộp thoại xác nhận thì widget **không** thu lại, kể cả khi hộp thoại làm mất focus.

#### Giới hạn của chế độ "Trong taskbar" — đọc mục này

**Windows không cho nhúng cửa sổ của app khác vào thanh taskbar.** Taskbar là một cửa sổ do `explorer.exe` sở hữu, và không có API công khai nào để biến cửa sổ của process khác thành con của nó. Mọi cách làm đều là hack (đổi parent window, `SetWindowLong` trên handle của explorer) và sẽ vỡ ở bản Windows tiếp theo.

Vì vậy chế độ này là **một lớp phủ đặt chính xác lên hình chữ nhật của thanh taskbar**, cao bằng taskbar, và được nâng lên trên taskbar trong thứ tự z. Nó **trông và hoạt động như** một phần của taskbar, nhưng **không phải** là một phần của taskbar. Các hệ quả cụ thể:

| Điều | Thực tế |
|---|---|
| Vị trí | Đúng trong hình chữ nhật taskbar, cùng hàng với icon. |
| Khi taskbar tự ẩn | Dải vẫn nằm ở mép dưới màn hình và **vẫn hiện** khi taskbar trượt đi — nó không trượt theo. |
| Khi bấm "Hiện desktop" | Dải **không** bị ẩn theo như các cửa sổ khác. |
| Khi taskbar đổi kích thước | Dải **tự bám theo** trong vòng ~2 giây (xem *Vai trò cửa sổ* bên dưới). |
| Taskbar dọc (cạnh trái/phải) | **Không dùng được** — taskbar dọc chỉ rộng ~48px, không đủ chỗ cho dải ngang. App tự lùi về chế độ *Sát taskbar*. |
| Nhiều màn hình | Dải luôn ở màn hình chính. |
| Kéo dải | Kéo ngang được; kéo dọc bị chặn để dải không bị lôi ra khỏi taskbar. |

Nếu bạn cần nó **thật sự** là một phần của taskbar, chỉ có một cách đúng: viết một **deskband / toolbar** bằng C++ (COM `IDeskBand`) và đăng ký với shell — đó là một sản phẩm khác, không phải Electron, và Microsoft đã không còn hỗ trợ chính thức từ Windows 11.

### Vai trò cửa sổ — tiện ích hay cửa sổ app

Bấm **⚙** → mục **Vai trò cửa sổ**.

| Chế độ | Hành vi |
|---|---|
| **Tiện ích** (mặc định) | Không có nút trên taskbar, **không có trong Alt+Tab**, luôn nổi trên các app khác. Chuyển sang app khác thì widget vẫn nằm nguyên chỗ cũ. |
| **Cửa sổ app** | Hành xử như một ứng dụng bình thường: có nút trên taskbar, có trong Alt+Tab, và có thể bị app khác che. |

> **Đổi vai trò áp dụng ngay**, không cần khởi động lại: `setSkipTaskbar` và mức z-order đều là lệnh runtime.
>
> Một lưu ý nhỏ: danh sách Alt+Tab do shell quản lý và có thể giữ mục cũ cho đến khi cửa sổ được đăng ký lại. Nếu vẫn thấy widget trong Alt+Tab sau khi đổi sang *Tiện ích*, khởi động lại app là cách chắc chắn nhất.

#### Cơ chế thật, và giới hạn

Điều làm nên hành vi tiện ích là **`skipTaskbar`** của Electron: cửa sổ không hiện trên taskbar, và trên Windows **cũng không hiện trong Alt+Tab** (đây là hệ quả đã được ghi nhận của cách `skipTaskbar` hoạt động — electron/electron#7850, đóng với lý do “giới hạn kỹ thuật của tính năng”, không phải bug). Kèm theo mức always-on-top `screen-saver` — mức cao nhất Electron mở ra và là mức duy nhất nằm trên thanh taskbar — widget không còn chỗ nào để bị ẩn đi.

**Tự bám theo taskbar.** Windows không bắn sự kiện nào khi taskbar đổi kích thước, đổi cạnh, khi DPI đổi, hay khi `explorer.exe` khởi động lại. Vì vậy app đo lại môi trường mỗi **2 giây** (hình chữ nhật taskbar + bounds + work area + scaleFactor) và áp lại vị trí lẫn z-order khi phát hiện thay đổi. Các sự kiện `display-metrics-changed` / `display-added` / `display-removed` xử lý ngay các thay đổi độ phân giải và màn hình.

**Giới hạn cụ thể — đọc mục này:**

| Điều | Thực tế |
|---|---|
| Không có nút taskbar, không có trong Alt+Tab | **Đúng** — nhờ `skipTaskbar`. |
| Luôn nổi trên app khác | **Đúng** — nhờ always-on-top `screen-saver`. |
| Tự bám khi taskbar đổi kích thước / cạnh / độ phân giải / DPI | **Đúng** — trong vòng ~2 giây. |
| Sống sót khi `explorer.exe` khởi động lại | **Đúng** — z-order được áp lại ở mỗi vòng đo. |
| Là một phần của taskbar như tiện ích thời tiết Windows 11 | **Không.** Tiện ích thời tiết do `explorer.exe` tự vẽ *bên trong* cửa sổ taskbar. Cửa sổ của process khác không làm được điều đó: không có API công khai nào để nhận taskbar làm parent. |
| Task Manager | Vẫn liệt kê process — nó vẫn là một app đang chạy, chỉ không hiện trong app switcher. |
| Taskbar tự ẩn | Widget vẫn hiện (nó không trượt theo taskbar). |
| Bấm “Hiện desktop” | Widget không bị ẩn theo. |

Nói ngắn: widget **hành xử** như tiện ích taskbar ở mọi điểm bạn cảm nhận được (không chiếm tab, không mất khi mở app khác, luôn ở đó, tự bám theo taskbar), nhưng về mặt kỹ thuật nó vẫn là một cửa sổ top-level riêng, không phải một phần tử do taskbar vẽ ra.

> **Ghi chú cho người đọc code:** một bản nháp trước đây truyền `type: 'toolbar'` cho `BrowserWindow` với hy vọng nó tạo `WS_EX_TOOLWINDOW` trên Windows. **Điều đó sai** — tuỳ chọn `type` của Electron chỉ có tác dụng trên Linux (`desktop`/`dock`/`toolbar`/`splash`/`notification`) và macOS (`desktop`/`textured`/`panel`), Windows bỏ qua. Tuỳ chọn đó đã bị gỡ, và có unit test chặn việc đưa nó trở lại.

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

**Biểu đồ** — bật/tắt, và chọn khung thời gian **5 phút / 15 phút / 1 giờ**. Xem mục dưới.

> Mọi tuỳ chỉnh được ghi ngay vào `portfolio.json` và **giữ nguyên sau khi tắt mở app**.

### Biểu đồ giá trị danh mục

Một đường mảnh ngay dưới tổng giá trị, cho biết danh mục đã đi lên hay đi xuống trong khung thời gian đang chọn.

**Cố tình tối giản:** không trục, không lưới, không chú giải, không tooltip. Con số ở trên đã nói giá trị là bao nhiêu, nên biểu đồ chỉ cần nói **hình dáng** của chuyển động. Dòng chú thích nhỏ bên dưới ghi khung thời gian và mức thay đổi — thứ mà một sparkline trần không thể cho biết.

| Chi tiết | |
|---|---|
| Dữ liệu | Giá trị danh mục, lấy mẫu mỗi **5 giây**, tối đa **720 mẫu** (~1 giờ) |
| Lưu ở đâu | Khoá `history` trong `portfolio.json` — **chỉ trên máy** |
| Màu | Xanh khi tăng, đỏ khi giảm, xám khi đứng yên — cùng ngôn ngữ với P&L |
| Khi thêm/xoá lệnh | Ghi mẫu ngay lập tức, để biểu đồ hiện **bước nhảy** thay vì nội suy qua nó |
| Chế độ "Chỉ chữ" | Đường có quầng riêng để không chìm vào hình nền |
| Chế độ ghim | **Không vẽ** — dải chỉ cao ~40px, một đường ngoằn ngoèo sau con số chỉ là nhiễu |

> Biểu đồ bắt đầu **trống** ở lần chạy đầu tiên và đầy dần trong vài phút. Đây là dữ liệu quan sát được từ lúc bạn mở app, không phải dữ liệu lịch sử tải về từ Binance — app không tải gì về ngoài giá hiện tại.

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
| Bấm vào dải (khi ghim) | Bung ra đầy đủ |
| Bấm ra ngoài (khi ghim) | Thu lại về dải |
| `Esc` | Đóng hộp thoại đang mở |
| Click icon khay | Hiện / ẩn widget |
| Chuột phải icon khay | Menu: Hiện/Ẩn, Vị trí (3 chế độ), Luôn nổi, Thoát |

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
- Tuỳ chỉnh giao diện nằm trong `settings` của cùng file đó: `theme`, `textColor`, `bgAlpha`, `halo`, `bounds`, `expandedHeight`, `chart`, `chartRange`, `widgetRole`, và cho chế độ ghim: `dockMode` (`float` / `edge` / `taskbar`), `dockX`, `dockWidth`, `collapseOnBlur`. Xoá các khoá này là về mặc định.
- **Lịch sử biểu đồ** nằm ở khoá `history` của cùng file: mảng `{t, v}` (thời điểm, giá trị danh mục), tối đa 720 mẫu, lấy mẫu mỗi 5 giây. Đây là dữ liệu **chỉ trên máy**, không gửi đi đâu. Xoá khoá này là biểu đồ bắt đầu lại từ trống.

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
npm test          :: 53 unit test (toán danh mục + feed + cảnh báo + hình học biểu đồ + vai trò cửa sổ)
```

Test e2e chạy Electron thật (cần Linux + Xvfb, dùng trong CI):

```bash
npm run test:e2e  # 137 assertion: thêm/sửa/xoá lệnh, tick giá, cảnh báo, thu gọn, reload,
                  # theme nền, màu chữ, độ đục, thanh tiêu đề tự ẩn, tay nắm resize,
                  # 3 chế độ vị trí (kể cả dải nằm TRONG hình chữ nhật taskbar),
                  # biểu đồ (đường, vùng tô, chấm cuối, chú thích, khung thời gian, lưu sau reload)

xvfb-run -a node test/window-role.e2e.js  # 13 assertion riêng cho vai trò cửa sổ:
                  # không chiếm taskbar, luôn nổi, áp dụng ngay, lưu sau reload,
                  # và "dấu vân tay" môi trường ổn định cho vòng đo taskbar
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
├── main.js              # main process: cửa sổ, tray, IPC, thông báo, đặt vị trí
├── preload.js           # cầu nối hẹp giữa main và renderer
├── src/
│   ├── portfolio.js     # toán danh mục (thuần, không I/O)
│   ├── feed.js          # Binance Futures WS + REST fallback
│   ├── alerts.js        # engine cảnh báo (edge-triggered)
│   ├── store.js         # lưu JSON atomic + lịch sử biểu đồ
│   └── window-role.js   # vai trò cửa sổ (thuần — unit test trực tiếp)
├── renderer/
│   ├── index.html
│   ├── styles.css         # 7 theme nền (gồm "Chỉ chữ"), thanh tiêu đề tự ẩn, tay nắm resize
│   ├── dock.css           # bố cục dải ghim (sát taskbar + trong taskbar)
│   ├── chart.css          # biểu đồ giá trị
│   ├── chart.js           # hình học biểu đồ (thuần, không DOM — unit test trực tiếp)
│   └── app.js             # render + bảng tuỳ chỉnh giao diện
├── build/               # icon
└── test/                # unit + e2e + screenshot + transparency harness
```

### Kiểm thử chế độ vị trí và biểu đồ

```bash
xvfb-run -a node test/e2e.js        # 137 assertion, gồm 20 cho chế độ ghim + 20 cho biểu đồ
xvfb-run -a node test/window-role.e2e.js  # 13 assertion cho vai trò cửa sổ
xvfb-run -a node test/dock-shots.js # ảnh chụp dải ghim → shots-dock/
xvfb-run -a node test/shots-v6.js   # ảnh chụp biểu đồ + 3 chế độ vị trí → shots-v6/
xvfb-run -a node test/dock-measure.js # số đo hình học thật của dải
```

Bộ e2e kiểm: dải chỉ hiện tổng (không tab, không hero), cửa sổ thật sự cao ≤60px, bấm dải thì bung ra, thu lại về dải, **tổng không bị cắt** (`scrollWidth ≤ clientWidth`), **nút thanh tiêu đề không đè lên tổng** (so bounding box), P&L nhường chỗ khi thanh tiêu đề mở, bấm ra ngoài thì thu lại, form đang mở thì **không** thu, tắt tuỳ chọn thì blur không làm gì, và chế độ ghim sống sót qua reload.

Riêng chế độ **Trong taskbar**, các assertion đọc **hình học cửa sổ thật** từ main process (hook `test-geometry`), không đọc CSS: cửa sổ phải nằm **bên trong** hình chữ nhật taskbar, cao không quá taskbar, nằm trong biên ngang, được nâng trên taskbar, và khi bung ra thì panel **không** đè lên taskbar.

> Sandbox không có window manager nên không thể tạo focus change thật. Vì vậy main process đăng ký hook `test-blur` **chỉ khi `CPW_TEST=1`**, bắn đúng handler mà OS sẽ bắn — để nhánh code thật được kiểm chứ không phải giả định.

---

## Ghi chú kỹ thuật

- **Vì sao `markPrice` chứ không phải `miniTicker`?** `markPrice` là giá dùng để tính P&L và thanh lý trên Futures — đúng thứ một người giữ vị thế futures quan tâm.
- **Taskbar ở cạnh nào?** Không có API cho việc này, nhưng suy ra được: taskbar là dải mà *work area* loại trừ khỏi *bounds* của màn hình. Taskbar tự ẩn báo work area bằng cả màn hình, khi đó mặc định là `bottom`.
- **Vì sao dải ghim bỏ nhãn "Tổng giá trị"?** Ở 44px và 300px, nhãn + P&L lấy hết chỗ và **cắt cụt con số** thành `58,60…` — đúng thứ quan trọng nhất lại không đọc được. Ảnh chụp bắt được lỗi này; giờ nhãn bị bỏ, con số không bao giờ bị ellipsis, và P&L bị giới hạn 46% bề rộng.
- **Vì sao không dùng `type: 'toolbar'` để ẩn khỏi Alt+Tab?** Đã thử và **sai**: tuỳ chọn `type` của Electron chỉ có tác dụng trên Linux (`desktop`/`dock`/`toolbar`/`splash`/`notification`) và macOS (`desktop`/`textured`/`panel`); Windows bỏ qua. Thứ thật sự loại cửa sổ khỏi taskbar **và** Alt+Tab là `skipTaskbar`. Có unit test chặn `type: 'toolbar'` quay lại code.
- **Vì sao widget được "hiện lại" mỗi 2 giây?** Windows không bắn sự kiện nào khi taskbar đổi kích thước/cạnh, khi DPI đổi, hay khi `explorer.exe` khởi động lại — và nó có thể âm thầm gỡ cờ topmost. Vòng đo 2 giây so sánh "dấu vân tay" môi trường (hình chữ nhật taskbar + bounds + work area + scaleFactor) và áp lại z-order. Cờ `userHidden` phân biệt "Windows ẩn hộ" với "người dùng tự ẩn", nên menu khay vẫn ẩn được.
- **Vì sao panel bung ra neo vào taskbar chứ không vào work area?** Khi taskbar tự ẩn, work area bằng cả màn hình, nên neo vào nó đặt đáy panel ở đáy màn hình — **đè lên taskbar**, đúng thứ chế độ này sinh ra để tránh. Test e2e bắt được (đáy panel 1024, đỉnh taskbar 976).
- **Đường dẫn `/market`:** từ 2026 Binance định tuyến stream; `@markPrice` nằm trên `/market`, kết nối không có path sẽ **im lặng không nhận gì**. Code dùng `wss://fstream.binance.com/market/stream?streams=...`.
- **Cảnh báo edge-triggered:** nếu giá đứng yên trên ngưỡng, bạn không bị spam thông báo. Phải quay lại phía bên kia rồi cắt qua lần nữa (và qua cooldown 5 phút).
- **Bán quá số đang giữ:** bị chặn ở số lượng thực có, kèm cảnh báo vàng ở chân widget — không âm thầm tính sai.

---

## Giấy phép

MIT
