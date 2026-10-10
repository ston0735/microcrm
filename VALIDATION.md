# 交付驗證紀錄

日期：2026-10-10（UTC+8）。執行環境：Windows，Node.js v24.19.0。

- 原始碼語法檢查通過。
- 3 項 Node 自動測試全數通過（領域、模擬 Responses API、HTTP 功能）。
- SQLite 外鍵、FTS5、示例資料建立與資料版本衝突已驗證。
- HTTP 測試涵蓋登入、CSRF、來源限制、唯讀拒絕、CRUD、手動專案六里程碑、TXT 附件搜尋／下載、草稿確認與重複確認拒絕、聊天持久保存及登出。
- 瀏覽器實際登入、查看 Dashboard／商機看板／會議詳情，建立任務草稿並確認，看到新任務出現在看板。
- 桌面版與 390px 窄螢幕介面已視覺檢查；修正手機導航造成的水平溢出。
- 實際本機預覽使用系統暫存資料目錄；工具管理的工作目錄建立 SQLite 有限制。正式本機部署需可寫入的資料路徑。

未驗證：真實 OpenAI API（沒有提供金鑰）、Docker 映像建置、Linux／macOS 執行、正式網路／HTTPS 反向代理、大型資料集、滲透測試、GitHub／Vercel 上雲部署。這些不能視為已通過。
# 雲端版追加驗證（2026-10-10）

雲端程式已新增 PostgreSQL 資料層、Vercel API、部署初始化與操作說明 CLOUD.md，尚未上傳 GitHub 或完成雲端部署。

新增非同步測試與既有 domain 測試共 4 項通過：成交轉案／重複轉換、六里程碑、版本限制、草稿需確認、角色、登入計數、附件保存／下載與搜尋，以及 SQL 參數化。雲端測試使用 SQLite 測試替身，不等於 PostgreSQL 實測。

cloud-db、cloud-handler、cloud-assistant、cloud-setup、api/index 與前端 JavaScript 語法檢查通過。本次完整測試的 HTTP 項目因本機 TCP EACCES 無法完成；下方先前本機版的驗證屬於歷史結果。

未完成：pg 安裝、真實 PostgreSQL schema／交易／SSL、Vercel rewrite／Cookie／附件、真實 AI、重新部署持久化、正式備份還原。不能把 Vercel 的 README 部署標為 CRM 驗收完成。
