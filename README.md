# 週末競馬條件簿

JRA 中央賽馬本週末賽事與近十年相同條件統計。網站是純靜態 React 應用程式；JRA 資料只由 GitHub Actions 在建置端取得，使用者瀏覽器不會直接連線 JRA。

## 功能

- 依日期、競馬場瀏覽本週末出馬表。
- 比較相同競馬場、跑道、距離、級別、年齡／性別限制及負重方式的近十年賽事。
- 顯示高／低勝率條件、樣本數、基準勝率及 Wilson 95% 信賴區間分類。
- 以公開公式計算馬匹條件指數，逐項列出加減分理由。
- JRA 頁面解析失敗時保留上次成功資料並顯示過期警告。

## 本機開發

需求：Node.js 24 與 npm。

```bash
npm install
npm run dev
```

品質檢查：

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## GitHub Pages 部署

1. 將專案推送至 GitHub，預設分支使用 `main`。
2. 到 `Settings → Pages → Build and deployment`，將 Source 選為 `GitHub Actions`。
3. `Test and deploy GitHub Pages` 會在每次推送後測試、建置並部署 `dist`。
4. 到 Actions 手動執行 `Update JRA weekend data`：
   - 首次選 `bootstrap`，分年度重建十二年資料；前兩年只暖機，後十年納入統計。這會進行大量、低頻率請求，可能需數小時。
   - 平時選 `update` 即可立即更新本週資料。

排程會在日本時間週四、週五及週末賽事時段執行。排程成功後，衍生統計與週末快照會由 GitHub Actions bot 寫回儲存庫，進而觸發 Pages 部署。

## 資料設計

- `data/aggregate-store.json`：月份／賽事條件的彙總計數、已處理賽事 ID、活躍馬匹的精簡狀態。沒有保存 JRA 原始 HTML。
- `public/data/weekend.json`：前端唯一讀取的公開介面，並以 Zod 在產生端及瀏覽器端驗證。
- `scripts/jra/`：低併發 HTTP、JRA POST 導航發現、Shift_JIS 解碼、頁面解析、統計與輸出。

單項條件分數公式：

```text
勝率與基準的百分點差 × min(1, √(樣本數 / 100))
```

單項限制於 ±20 分；樣本少於 30，或 Wilson 95% 信賴區間未完全越過基準時，不納入排行。

## 使用限制

此專案定位為個人、非商用原型，並非 JRA 官方服務。使用者須自行確認 JRA 使用條款、著作權及資料二次利用規範。若用於公開商業服務，應更換為具再配布授權的資料來源。

條件指數不是實際勝率，不構成投注建議。馬券限年滿 20 歲者購買，請量力而為。
