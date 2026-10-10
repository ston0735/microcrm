# microcrm：GitHub + Vercel 部署

目前狀態：雲端程式已準備，尚未連接實際 PostgreSQL、安裝 pg 或完成 Vercel 端到端驗證。GitHub 外掛目前回覆 403 Resource not accessible by integration，尚未將此程式上傳至儲存庫。GitHub 的 README 和 Vercel 的 README 部署不代表 CRM 已上線。

## 1. 建立資料庫

進入 Vercel 的既有 `microcrm` 專案，從 Storage 建立／連接 Neon PostgreSQL。選擇符合需求的方案，確認專案連接成功。若整合只提供 `POSTGRES_URL`，在此專案的 Environment Variables 設定 `DATABASE_URL` 為相同連線字串。連線字串只保存在 Vercel，不要貼到聊天、GitHub 或 README。

正式部署使用專用資料庫。Preview 使用另一個資料庫／Neon branch；不要讓開發預覽使用正式資料庫。程式使用 `microcrm` schema，需要建立資料表及 schema 的權限。

## 2. 設定環境變數

在 microcrm → Settings → Environment Variables 設定 Production：

|名稱|設定|
|---|---|
|DATABASE_URL|Neon 的 PostgreSQL 連線字串，含 SSL 設定|
|ADMIN_EMAIL|管理員的登入 Email|
|ADMIN_PASSWORD|自行產生 16–200 字元的專用強密碼；禁止本機示例密碼|
|COOKIE_SECURE|1|
|SEED_DEMO|1 顯示明確標示的示例；0 建立空白系統|
|OPENAI_API_KEY|選填；未填時明確顯示演示模式|
|OPENAI_MODEL|選填，預設 gpt-4.1-mini|

示例種子只在首次建立管理員時執行，不會在重新部署時覆蓋資料或更改密碼。雲端沒有 sales@game.local 或 viewer@game.local 等預設弱帳號。登入後從設定新增業務與唯讀帳號。

## 3. 上傳程式

GitHub 儲存庫：`ston0735/microcrm`，分支 `main`。

把此 `game-crm` 資料夾**內部的程式檔案**放到儲存庫根目錄：根目錄必須直接有 package.json、vercel.json、cloud-setup.mjs、cloud-db.mjs、cloud-handler.mjs、cloud-assistant.mjs，以及 public、api、tests 等目錄。不要只上傳 ZIP 檔，也不要多包一層 game-crm 目錄。

如果 GitHub 外掛權限尚未修復，可在 GitHub `Add file → Upload files` 拖入上述檔案與目錄，再 Commit changes。禁止上傳 `.env`、`data/`、CRM SQLite、上傳附件、node_modules 或 `.vercel/`。`.env.example`、`.env.cloud.example` 是空白範本，可上傳。

## 4. Vercel 設定與部署

使用既有 microcrm 專案，連接上述 GitHub 儲存庫；不要另建同名專案。Framework Preset 為 Other，Node.js 24.x，Root Directory 為儲存庫根目錄。vercel.json 已設定 Build Command `node cloud-setup.mjs`、Output Directory `public` 與 API 路由。檢查既有 Settings 的手動 override 沒有蓋掉這些設定。

每次部署會檢查環境變數，在 PostgreSQL 交易內建立缺少的資料表；既有資料不會被清除。缺少必要設定時建置會失敗，不能把失敗部署當成可用 CRM。

成功後用 ADMIN_EMAIL／ADMIN_PASSWORD 登入。測試新增公司、重新整理、成交转專案、附件、AI 草稿確認、唯讀帳號和審計。再次部署後確認紀錄與附件仍存在，再交付使用者。

## 本機測試

Node.js 24 下，原本的本機版仍可 `node --env-file-if-exists=.env local-server.mjs` 啟動，不依賴 pg。測試：`node --test tests/*.test.mjs`。

雲端整合需先 `npm install`；設定專用測試 DATABASE_URL 等變數後執行 `npm run cloud:setup`。這會修改所指定資料庫，不應指定正式資料庫做開發測試。這次未執行實際雲端資料庫初始化。

## 實作與限制

- PostgreSQL 實體外鍵、成交來源唯一約束、資料版本衝突、持久 sessions、審計、草稿及聊天記錄。寫入使用交易，回應在 COMMIT 成功後才送出。
- 附件存為 PostgreSQL BYTEA，下載需登入，雲端單份 3 MB（本機 5 MB）；適用小型 MVP。大量／大型附件後續改私有 Blob。文字搜尋使用 ILIKE，支援繁體中文短字；PDF／Office／圖片未做內容解析。
- 為避免並行轉案／草稿確認覆寫，目前同一套系統的寫入使用 PostgreSQL advisory lock，AI 對話也會占用寫入交易。高並行流量需改成各紀錄鎖與短交易，並加索引／聊天非同步處理。
- 最長 60 秒函式；真實 AI 可能超時。沒有金鑰時其他功能仍可操作，演示模式不冒充 AI。
- 共用同一工作區的 admin/member/viewer 角色；沒有多租戶、部門隔離、SSO、忘記密碼／寄信或完整資料遷移工具。SQLite 既有資料不會自動匯入雲端。
- 新增的 cloud.test.mjs 以非同步 SQLite 測試替身驗證業務邏輯及附件，不等於真實 PostgreSQL、SSL、Vercel 路由或部署驗證。部署前必須完成上述實際驗收。
- 設定資料庫備份／還原與容量監測；不要將示例金額解讀為公司真實業績。

平台文件：[Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)、[node-postgres transactions](https://node-postgres.com/features/transactions)。
