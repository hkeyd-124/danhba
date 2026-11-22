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
| **Cảnh báo giá** | Ba kiểu: **vượt lên trên**, **giảm xuống dưới**, và **chạm mốc** (chỉ cần giá chạm mốc, không cần biết đang tăng hay giảm). Chạm ngưỡng → thông báo Windows + âm thanh. Hai kiểu đầu chỉ bắn khi giá **cắt qua** ngưỡng; kiểu "chạm mốc" bắn khi giá vào trong dải dung sai. Có cooldown 5 phút. |
| **Chọn nội dung hiển thị** | Tích cái nào hiện cái đó: dòng tổng, P&L, phần trăm trong dải — và **theo dõi từng đồng coin riêng** (mỗi coin một dòng giá + % ngay trong dải taskbar). |
| **Logo coin thật** | Icon SVG/PNG thật của từng đồng (ETH là logo ETH, BTC là logo BTC…), **đóng gói sẵn trong app** — không tải từ mạng. Coin chưa có logo thì vẽ badge chữ. |
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
4. Tab **Cảnh báo** → `+ Thêm` → chọn **"Vượt lên"**, **"Xuống dưới"** hoặc **"Chạm mốc"**, nhập ngưỡng.
   - **Vượt lên** / **Xuống dưới**: chỉ báo khi giá cắt qua ngưỡng theo đúng hướng đó.
   - **Chạm mốc**: báo ngay khi giá chạm ngưỡng, **dù đang tăng hay giảm**. Có thêm ô **Dung sai** (% mỗi bên) — giá chỉ cần vào trong khoảng ± dung sai quanh mốc là báo. Để trống dùng 0,1%.
5. Nút **📌** bật/tắt luôn nổi. Nút **▾** thu gọn. Nút **✕** ẩn xuống khay — bấm icon khay để mở lại.
6. **⚙ → Theo dõi từng coin trong dải** → tích những coin bạn muốn thấy giá ngay trong dải taskbar.

### Chọn nội dung hiển thị trong dải

Bấm **⚙** → mục **Hiển thị**. Mỗi ô là một công tắc độc lập — tích thì hiện, bỏ tích thì ẩn:

| Công tắc | Hiện gì |
|---|---|
| **Tổng giá trị** | Con số lớn ở dòng đầu |
| **Lãi/lỗ** | Số P&L tuyệt đối |
| **Phần trăm** | % lãi/lỗ |
| **Theo dõi từng coin trong dải** | Mỗi coin được tích thêm **một dòng riêng**: logo + mã + giá + % |

Danh sách coin để tích được **sinh từ chính danh mục của bạn** — mua coin mới thì nó tự xuất hiện trong danh sách, không phải chờ bản cập nhật. Bán hết một coin thì dòng của nó tự biến mất khỏi dải (không để lại dòng `0.00` vô nghĩa), nhưng **ô tích vẫn được nhớ** — mua lại là dòng hiện lại ngay.

> **Dải trong taskbar chỉ đủ chỗ cho vài dòng.** Dải nằm *bên trong* hình chữ nhật của taskbar, nên chiều cao bị chặn bởi taskbar: taskbar 48px cho khoảng **2 dòng coin** cộng dòng tổng. Tích nhiều hơn thì phần dư bị cắt — đó là giới hạn vật lý, không phải lỗi. Muốn xem nhiều coin cùng lúc thì dùng chế độ **Cửa sổ nổi** hoặc **Sát taskbar**, ở đó dải không bị chặn chiều cao.

> **Vì sao các dòng sát nhau?** Dòng coin cao **13px** (chữ 9.5–10px), không phải 18–20px như danh sách thường. Đây là mức sát nhất mà chữ vẫn không chạm dòng kế: 13px cho chữ 10px còn 3px khoảng thở, đủ để phần dưới của chữ không chạm phần trên của dòng sau. Cao hơn thì dòng thứ ba bị cắt giữa chữ — tệ hơn là không hiện.

### Logo coin

Mỗi coin có **logo thật** (ETH là hình thoi ETH, BTC là chữ B nghiêng màu cam…), không phải chữ viết tắt. Logo **đóng gói sẵn trong app** tại `src/coin-data.js` — **không tải từ mạng lúc chạy**, nên vẫn giữ đúng cam kết: kết nối ra ngoài duy nhất là Binance Futures.

| | |
|---|---|
| Số coin có logo | **77** |
| Nguồn | [spothq/cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons) (CC0-1.0) và CoinCap asset icons |
| Định dạng | Data URI PNG 24px, gộp trong một module 44KB |
| Coin chưa có logo | Vẽ badge: ô vuông bo góc màu thương hiệu + mã coin. Vẫn nhận ra ngay, và đó là kiểu mọi bản trước đây vẽ |
| Màu chữ trên badge | Tự chọn đen hay trắng theo độ tương phản — nền vàng nhạt (BNB) dùng chữ đen, nền xanh đậm (ETH) dùng chữ trắng |
| Thêm coin mới | Xem `src/coin-data.js` và mục *Thêm một coin* trong `CREDITS.md` |

**Vì sao là data URI chứ không phải file ảnh?** Renderer chạy trong sandbox, không đọc được đĩa — nên byte của logo phải đi kèm state. Một module duy nhất cũng tránh được 77 file phải giữ đồng bộ với bảng tra cứu. CSP của trang là `img-src 'self' data:` — chỉ cho phép đúng hai nguồn này, nên logo **không thể** trỏ ra ngoài máy.

**Vì sao 24px?** Logo chỉ hiển thị 11px trong dải và 18px trong panel. 24px là mức gấp đôi cho màn hình HiDPI, đủ nét mà vẫn giữ module ở 44KB thay vì 300KB.

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

Vị trí ngang, kích thước panel, **kích thước dải**, và chế độ đang chọn đều được nhớ sau khi tắt mở app.

#### Kéo giãn dải trong taskbar — kích thước được giữ cố định

Kéo mép trái/phải của dải để đổi chiều rộng. Chiều rộng đó **được nhớ riêng** và **không bị reset** khi bạn bấm vào dải để xem chi tiết rồi bấm ra ngoài để thu lại — dải quay về đúng chiều rộng bạn đã kéo, kể cả sau khi khởi động lại app.

| Điều | Chi tiết |
|---|---|
| Chiều rộng tối thiểu | **200px** — hẹp hơn nữa thì tổng và P&L không còn đọc được |
| Chiều rộng tối đa | Bằng chiều rộng taskbar |
| Chiều cao | **Cố định** theo taskbar — kéo dọc bị chặn để dải không bị lôi ra khỏi taskbar |
| Dưới 260px | Dải **ẩn số P&L tuyệt đối**, chỉ giữ phần trăm (xem bên dưới) |
| Về mặc định | **⚙ → Kích thước → Về mặc định** đặt lại **cả** panel và dải |

> **Vì sao dưới 260px lại ẩn số P&L?** Đo thật: ở 250px số P&L bị cắt thành `+4,...` — dấu ba chấm giữa một con số, vừa trông như lỗi vẽ vừa vô nghĩa. Ở 260px thì vừa. Nên dưới ngưỡng đó dải bỏ số tuyệt đối và giữ `+7.69%`, thứ vẫn tự nói được điều gì đó. Số tuyệt đối vẫn nằm trong panel, cách một cú bấm.

> **Vì sao dải và panel có chiều rộng riêng?** Trước đây cả hai dùng chung một số, nên kéo panel làm dải giãn theo, và tệ hơn: kéo dải **không được lưu** (code cũ bỏ qua mọi thay đổi khi đang thu gọn), nên lần bung/thu sau dải nhảy về kích thước cũ. Đó chính là lỗi đã sửa ở bản này.

**Tự thu lại khi bấm ra ngoài** — bật/tắt được ở **⚙ → Vị trí**. Mặc định **Bật**.

> Chế độ này **chỉ áp dụng khi đã ghim**. Ở chế độ cửa sổ nổi, widget không tự thu lại khi bạn bấm sang cửa sổ khác — nếu không nó sẽ biến mất giữa lúc bạn đang xem.

> Đang mở form thêm lệnh hay hộp thoại xác nhận thì widget **không** thu lại, kể cả khi hộp thoại làm mất focus.

#### Giới hạn của chế độ "Trong taskbar" — đọc mục này

**Windows không cho nhúng cửa sổ của app khác vào thanh taskbar.** Taskbar là một cửa sổ do `explorer.exe` sở hữu, và không có API công khai nào để biến cửa sổ của process khác thành con của nó. Mọi cách làm đều là hack (đổi parent window, `SetWindowLong` trên handle của explorer) và sẽ vỡ ở bản Windows tiếp theo.

Vì vậy chế độ này là **một lớp phủ đặt chính xác lên hình chữ nhật của thanh taskbar**, cao bằng taskbar, và được nâng lên trên taskbar trong thứ tự z. Nó **trông và hoạt động như** một phần của taskbar, nhưng **không phải** là một phần của taskbar. Các hệ quả cụ thể:

| Điều | Thực tế |
|---|---|
| Vị trí | Đúng trong hình chữ nhật taskbar, cùng hàng icon |
| Taskbar tự ẩn | Dải **vẫn hiện** khi taskbar trượt đi — không trượt theo |
| Bấm "Hiện desktop" | Dải **không** bị ẩn theo |
| Taskbar đổi kích thước | Tự bám lại trong ~2 giây |
| Taskbar dọc | **Không dùng được** (chỉ rộng ~48px) — tự lùi về *Sát taskbar* |
| Nhiều màn hình | Luôn ở màn hình chính |
| Kéo dải | Kéo ngang được; kéo dọc bị chặn |

Muốn nó **thật sự** là một phần taskbar thì phải viết **deskband C++ (COM `IDeskBand`)** — sản phẩm khác, không phải Electron, và Microsoft đã bỏ hỗ trợ chính thức từ Windows 11.

### Vai trò cửa sổ — vì sao widget không bị ẩn khi mở app khác

Mặc định widget chạy ở vai trò **Tiện ích**:

| Cơ chế | Tác dụng |
|---|---|
| `skipTaskbar` | Không có nút trên taskbar, **và không có trong Alt+Tab** |
| always-on-top `screen-saver` | Mức cao nhất Electron mở ra, và là mức duy nhất nằm **trên** thanh taskbar |
| Vòng đo môi trường 2 giây | Tự bám lại vị trí + z-order khi taskbar đổi |

Đổi ở **⚙ → Vai trò cửa sổ** — áp dụng **ngay**, không cần khởi động lại.

> **Giới hạn:** Windows không cho app Electron nhúng vào taskbar. Widget vẫn là một cửa sổ top-level riêng (Task Manager vẫn liệt kê process), nhưng nó **không chiếm chỗ trên taskbar**, **không có trong Alt+Tab**, và **luôn nổi trên app khác**.

---

### Màu chữ và ô đọc tương phản

**⚙ → Màu chữ**: 8 màu dựng sẵn + bảng chọn màu tuỳ ý. Dưới đó là một ô đọc **tương phản** — nó đo màu chữ bạn chọn với nền hiện tại và nói thẳng là đọc được hay không.

| Ô đọc hiện | Nghĩa |
|---|---|
| `16.5:1` + "Rất tốt" | Đo được, và đạt chuẩn WCAG |
| `3.2:1` + "Hơi thấp" | Đo được, nhưng chữ nhỏ sẽ khó đọc |
| `nền trong suốt` | **Không đo được** — nền là hình nền desktop, không có màu nền để đo |

> **Vì sao đôi khi nó nói "không đo được" thay vì đưa ra một con số?** Với kiểu nền **Chỉ chữ**, hoặc **Trong suốt** / **Kính mờ** khi độ đục xuống dưới **60%**, phần lớn phía sau chữ là hình nền desktop của bạn. Đo màu chữ với màu nền danh nghĩa của theme lúc đó sẽ ra một con số trông rất chắc chắn nhưng sai — ví dụ "16.5:1" cho chữ có thể đang nằm trên một bức ảnh trắng. Một con số sai còn tệ hơn không có số, vì bạn sẽ tin nó. Nên dưới ngưỡng đó ô đọc nói rõ là không đo được và gợi ý dùng **Quầng chữ**.

> **Vì sao theme Sáng cần màu chữ riêng?** Đo thật trên pixel: chữ xanh `#16c784` trên nền sáng chỉ đạt **1.9:1**, đỏ `#ea3943` **3.4:1**, xanh dương `#4f8cff` **3.0:1** — đều dưới chuẩn 4.5:1. Nguyên nhân là theme sáng đang dùng màu ngữ nghĩa cứng của theme tối. Bản này tách riêng bộ màu cho theme sáng (`#0a6b48`, `#b3261e`, `#1d4ed8`), sau đó **không còn mục nào dưới 4.5:1**.

---

## Dữ liệu lưu ở đâu

`%APPDATA%\Crypto Portfolio Widget\portfolio.json`

Mở nhanh: **⚙ → Mở thư mục dữ liệu**.

- **Lệnh** nằm ở khoá `trades`.
- Tuỳ chỉnh giao diện nằm trong `settings` của cùng file đó: `theme`, `textColor`, `bgAlpha`, `halo`, `bounds`, `expandedHeight`, `chart`, `chartRange`, `widgetRole`, và cho chế độ ghim: `dockMode` (`float` / `edge` / `taskbar`), `dockX`, `dockWidth`, **`stripWidth`**, `collapseOnBlur`. Xoá các khoá này là về mặc định.
- **`stripWidth`** là chiều rộng **riêng của dải** khi ghim, tách khỏi `dockWidth` của panel. `null` = "chưa từng kéo" → dải dùng `dockWidth`, đúng như mọi bản trước, nên nâng cấp không làm dải nhảy kích thước. Kéo dải lần đầu là khoá này được ghi.
- **Lịch sử biểu đồ** nằm ở khoá `history` — tối đa 720 mẫu (~1 giờ), mỗi mẫu 5 giây.
- **Cảnh báo** nằm ở khoá `alerts`. Mỗi cảnh báo có `direction` (`above` / `below` / `touch`) và — chỉ với `touch` — `tolerance` (% mỗi bên). File của bản cũ (schema v2) được nâng lên v4 khi mở app: cảnh báo cũ giữ nguyên hướng và **không** bị gắn thêm `tolerance`; `stripWidth` được đặt `null` để dải giữ đúng chiều rộng cũ.
- **Coin theo dõi trong dải** nằm ở khoá `stripCoins` — mảng mã coin, ví dụ `["LDO", "ETH"]`, theo đúng thứ tự bạn tích. Mảng rỗng = chỉ hiện dòng tổng, đúng như mọi bản trước, nên **nâng cấp không đổi gì** cho tới khi bạn tích coin đầu tiên. File schema v5 được nâng lên v6 khi mở app và nhận `stripCoins: []`. Giá trị không phải chuỗi, không phải mã hợp lệ, hoặc trùng lặp đều bị loại — sửa tay file cũng không làm hỏng dải.

Ghi file theo kiểu **atomic** (ghi file tạm rồi rename), nên mất điện giữa lúc ghi không làm hỏng dữ liệu. File hỏng được sao lưu thành `portfolio.json.corrupt-<timestamp>` chứ không bị xoá.

---

## Bảo mật

| | |
|---|---|
| Renderer | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Không có `fetch`, không có `WebSocket` — mọi giá đi qua IPC. |
| Điều hướng | `will-navigate` chặn, `setWindowOpenHandler` từ chối, `will-attach-webview` chặn, mọi permission request bị từ chối. |
| Kết nối ra ngoài | **Duy nhất** `fapi.binance.com` / `fstream.binance.com` (và `wss://fstream.binance.com`). Không analytics, không crash report, không update check. |
| Logo coin | **Đóng gói sẵn trong app** tại `renderer/assets/coins/` — **không tải từ CDN lúc chạy**. CSP `img-src 'self'` chỉ cho phép ảnh cùng gốc, nên kể cả có ai chèn thẻ `<img>` trỏ ra ngoài thì trình duyệt cũng chặn. |
| Dữ liệu | Chỉ một file JSON trên máy. Không upload, không đồng bộ, không tài khoản. |

---

## Kiểm thử

```bat
npm test          :: 160 unit test (toán danh mục + feed + cảnh báo + migration dữ liệu + hình học biểu đồ + vai trò cửa sổ + kích thước dải ghim + chọn coin theo dõi + logo coin + tương phản màu chữ)
```

E2e cần Xvfb (Linux/CI) vì nó khởi động Electron thật:

```bash
npm run test:e2e  # 153 assertion: thêm/sửa/xoá lệnh, tick giá, cảnh báo (cả 3 kiểu, kể cả chạm mốc
                  # từ cả hai hướng), thu gọn, reload, theme nền, màu chữ, độ đục,
                  # thanh tiêu đề tự ẩn, tay nắm resize,
                  # 3 chế độ vị trí (kể cả dải nằm TRONG hình chữ nhật taskbar),
                  # biểu đồ (đường, vùng tô, chấm cuối, chú thích, khung thời gian, lưu sau reload)
                  # Kéo giãn dải có bộ test riêng: test/strip.e2e.js
```

### Kiểm thử chế độ vị trí và biểu đồ

```bash
xvfb-run -a node test/e2e.js        # 154 assertion, gồm 20 cho chế độ ghim + 20 cho biểu đồ
xvfb-run -a node test/strip-coins.e2e.js  # 27 assertion cho dòng coin trong dải + logo thật + tương phản
xvfb-run -a node test/strip.e2e.js  # 20 assertion riêng cho kéo giãn dải (chạy độc lập được)
xvfb-run -a node test/window-role.e2e.js  # 13 assertion cho vai trò cửa sổ
xvfb-run -a node test/dock-shots.js # ảnh chụp dải ghim → shots-dock/
xvfb-run -a node test/shots-v6.js   # ảnh chụp biểu đồ + 3 chế độ vị trí → shots-v6/
xvfb-run -a node test/shots-v8.js   # ảnh chụp form cảnh báo "chạm mốc" → shots-v8/
xvfb-run -a node test/shots-v9.js   # ảnh chụp dải ở 3 chiều rộng + mức tối thiểu → shots-v9/
xvfb-run -a node test/measure-v9.js # số đo thật của dải ở 7 chiều rộng (căn dọc, padding, cắt cụt)
xvfb-run -a node test/dock-measure.js # số đo hình học thật của dải
```

---

## Cấu trúc file

```
crypto-widget/
├── main.js              # main process: cửa sổ, vị trí, resize, IPC, khay
├── preload.js           # cầu nối hẹp (contextBridge)
├── src/
│   ├── portfolio.js     # toán danh mục (thuần — unit test trực tiếp)
│   ├── feed.js          # WebSocket + REST fallback
│   ├── alerts.js        # engine cảnh báo (thuần)
│   ├── chart.js         # hình học biểu đồ (thuần)
│   ├── store.js         # lưu JSON atomic + lịch sử biểu đồ
│   ├── dock-size.js     # kích thước dải ghim (thuần — unit test trực tiếp)
│   ├── display.js       # công tắc hiển thị + chọn coin theo dõi (thuần)
│   ├── coin-icon.js     # logo coin + badge dự phòng (thuần)
│   ├── coin-data.js     # 77 logo coin, data URI PNG 24px (sinh sẵn, 44KB)
│   ├── text-color.js    # màu chữ + đo tương phản (thuần)
│   └── window-role.js   # vai trò cửa sổ (thuần — unit test trực tiếp)
├── renderer/
│   ├── index.html
│   ├── styles.css
│   ├── dock.css         # chế độ ghim + trong taskbar
│   ├── app.js
│   └── assets/coins/    # CREDITS.md — nguồn và giấy phép logo
├── build/
│   └── make-icons.js    # sinh icon từ source
└── test/
```

---

## Ghi chú kỹ thuật

- **Vì sao kéo dải bị mất kích thước?** Hai lỗi chồng lên nhau. (1) Handler `resized` có điều kiện `!collapsed`, mà dải trong taskbar **luôn** ở trạng thái thu gọn — nên kéo dải xong không lưu gì cả. (2) Dải và panel dùng chung một số `dockWidth`, nên kéo panel cũng làm dải giãn theo. Giờ dải có `stripWidth` riêng, và `src/dock-size.js` quyết định từng trường hợp (nổi/thu gọn, ghim/thu gọn) nên trường hợp "ghim + thu gọn" được lưu đúng. Có 17 unit test + **20 assertion e2e riêng** (`test/strip.e2e.js`); chèn lại điều kiện cũ vào code thì 3 assertion fail ngay (`expected 540, got 420`) — đúng triệu chứng đã báo.
- **Vì sao dưới 260px dải ẩn số P&L?** Đo thật ở 7 chiều rộng (`test/measure-v9.js`): 250px thì P&L bị cắt thành `+4,...`, 260px thì vừa. Dấu ba chấm giữa một con số vừa trông như lỗi vẽ vừa vô nghĩa, nên dưới ngưỡng đó dải bỏ số tuyệt đối và giữ phần trăm. Ngưỡng là một **container query** trong `renderer/dock.css` (`@container (max-width: 259px)`), không phải media query — media query đo viewport, mà ở đây chính dải LÀ cửa sổ và cửa sổ do main process đổi kích thước. Cũng không dùng class JS: container query tự phản ứng, không cần thêm chỗ nào phải đồng bộ.
- **Vì sao `save-alert` phải giữ `direction: 'touch'`?** Bản trước ép mọi cảnh báo về `above`/`below` ngay tại ranh giới IPC — renderer có kiểu "chạm mốc", engine hiểu nó, nhưng lệnh lưu ném đi. Hậu quả: cảnh báo "chạm mốc" lưu xong thành "vượt lên", chỉ bắn một chiều. E2e bắt được; giờ `touch` và `tolerance` đi qua nguyên vẹn.
- **Vì sao `markPrice` chứ không phải `miniTicker`?** `markPrice` là giá dùng để tính P&L và thanh lý trên Futures — đúng thứ một người giữ vị thế futures quan tâm.
- **Taskbar ở cạnh nào?** Không có API cho việc này, nhưng suy ra được: taskbar là dải mà *work area* loại trừ khỏi *bounds* của màn hình. Taskbar tự ẩn báo work area bằng cả màn hình, khi đó mặc định là `bottom`.
- **Vì sao `type: 'toolbar'` không dùng được?** Tuỳ chọn `type` của `BrowserWindow` chỉ có tác dụng trên **Linux** và **macOS**; Windows bỏ qua hoàn toàn. Thứ thật sự loại cửa sổ khỏi taskbar và Alt+Tab là `skipTaskbar`. Có unit test chặn `type: 'toolbar'` quay lại code.
- **Vì sao vòng đo 2 giây?** Windows không bắn sự kiện nào khi taskbar đổi kích thước, đổi cạnh, khi DPI đổi, hay khi `explorer.exe` khởi động lại. Cách duy nhất là đo lại và so sánh một "dấu vân tay" gồm hình chữ nhật taskbar + bounds + work area + scaleFactor.
- **Vì sao dải tự cao lên khi tích coin?** Dòng tổng chiếm một dòng 13px; mỗi coin được tích thêm một dòng 13px nữa. Chiều cao do `stripHeightFor()` tính và **bị chặn bởi chính hình chữ nhật taskbar** — dải là lớp phủ *bên trong* taskbar, cao hơn taskbar thì nó thò ra ngoài desktop và không còn đọc như một phần của taskbar. Taskbar 48px cho 44px khả dụng → 2 dòng coin. Chưa tích coin nào thì hàm trả về đúng 44px của mọi bản trước, nên bản cũ không đổi gì.
- **Vì sao dòng coin cao 13px?** Đây là mức sát nhất mà chữ 10px vẫn không chạm dòng kế: 13px cho chữ 10px còn 3px khoảng thở. Cao hơn thì dòng thứ ba bị cắt giữa chữ trong dải 44px — tệ hơn là không hiện. Đo bằng DOM: `mid` của logo, mã, giá và % đều trùng khít (38.5 / 51.5 / 64.5), nên các cột thẳng hàng thật chứ không phải "trông có vẻ".
- **Vì sao logo là data URI?** Renderer chạy sandbox, không đọc được đĩa, nên byte phải đi kèm state. CSP `img-src 'self' data:` chỉ cho phép đúng hai nguồn — logo không thể trỏ ra ngoài máy, và không có lần gọi mạng nào cho một thứ chỉ để trang trí.
- **Vì sao nền trong suốt dưới 60% báo "không đo được"?** Theme `clear`/`glass` có thanh độ đục kéo xuống 0. Ở 0.35 thì thứ nằm sau chữ là **hình nền**, không phải `#0a0e16` — nên đo theo màu danh nghĩa của theme sẽ ra một con số tự tin "16.5:1" cho chữ có thể đang nằm trên một bức ảnh trắng. Đó đúng là kiểu sai mà ô đọc tương phản sinh ra để chặn, và nó chỉ cách một cái kéo thanh trượt. Dưới ngưỡng đó câu trả lời là "không đo được", kèm lý do và cách khắc phục.
- **Vì sao công tắc hiển thị từng trông như hỏng?** `[hidden]` của trình duyệt thua mọi rule `display` do tác giả đặt — và `.hero-row`, `.hero-label`, `.alloc`, `.collapsed-view` đều là flex/grid. Nên `el.hidden = true` không có tác dụng gì. Thêm `[hidden] { display: none !important; }` là xong; `!important` ở đây chính là mục đích, không phải lối tắt.
- **Vì sao hai chỗ màu chữ không đổi theo bảng chọn?** `.seg-btn.is-active` là `#d5e4ff` và `.calc` là `#b9cdf0` — cả hai viết cứng, nên bảng chọn màu chữ không bao giờ chạm tới. Giờ chúng đọc `var(--text)` và `var(--muted)`, là các tông dẫn xuất từ màu bạn chọn.

---

## Giấy phép

MIT
