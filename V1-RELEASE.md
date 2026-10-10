# 精冠智能 microcrm V1.0 候選版

2026-10-10：此版本為 1.0.0-rc.1。已完成下列功能及自動化邏輯測試，正式驗收仍需確認真實外部 API 與雲端使用流程，不以改版號代替驗收。

## 本次新增

- 商機表單可直接新增公司，並選填聯絡人；保存商機時一次寫入，不需先跳到客戶模組。
- 以台灣公司名稱或 8 碼統編查詢經濟部公司登記資料，顯示多筆候選、來源、登記狀態與查詢時間。使用者確認帶入後才能保存。公司名稱搜尋目前涵蓋營業中本國公司，不涵蓋商號或海外公司。
- 增加公司電話。政府資料不含電話與官網，保留空白；啟用 OpenAI 金鑰後，可額外使用網路搜尋取得候選電話／官網，必須有搜尋來源、同一實體判斷與使用者確認。這是 AI 候選查詢，來源仍需人工核對；沒有金鑰時停用，其他功能可使用。
- 重複公司名稱／統編檢查，快速新增沿用既有公司並保留原資料；公司、聯絡人、商機任一驗證失敗則整筆回復。
- 商機未送出表單可在同一瀏覽器分頁暫存／還原，按保存後清除。暫存依登入者區分，沒有送往 AI，也不包含登入密碼。
- 商機、專案、任務看板支援拖移，保留下拉選單供鍵盤／行動裝置使用；結案仍須選成交或未成交。逾期任務提示。
- 管理員可下載目前模組 CSV，避免 spreadsheet formula injection。不是完整資料庫備份／還原。
- 台灣統編基本格式、不存在日期檢查、查詢限流、查詢逾時與手動輸入退路。

## 安裝與部署差異

新增 company-lookup.mjs、workflow.mjs、public/company-form.js 與 tests/workflow.test.mjs。Node 24，原 PostgreSQL 環境變數沿用，不會重設密碼或清除既有紀錄。

可選 OPENAI_LOOKUP_MODEL（未設則沿用 OPENAI_MODEL，再預設 gpt-4.1-mini）。需要模型支援 Responses web_search；該功能會產生 API／搜尋費用。只傳送正在查找公司的公開名稱、統編、地址，CRM 商機預算、需求與聯絡人不會跟隨這項查詢傳送。

本機啟動方式及環境設定見 README.md／CLOUD.md。

## 驗證

`node --test tests/workflow.test.mjs tests/cloud.test.mjs tests/domain.test.mjs`：8 項通過。包含原本 CRM／AI 草稿、非同步流程、來源過濾、未啟用 AI 情境、公司關聯與回復、CSV 安全。真實 OpenAI 搜尋尚未測試，測試替身不代表真人同名公司判定正確。

正式驗收：新公司＋商機＋聯絡人；既有統編沿用；保存失敗無孤立公司；查詢多候選／逾時；拖移與結案驗證；唯讀操作；CSV；重新部署後資料保留；真實政府資料端點與 AI 查詢（如啟用）。

## 待完成的正式營運項目

資料庫備份／還原演練、負載與高並行寫入測試、私有 Blob 大型附件、PDF／Office 內容解析、SSO／忘記密碼寄信、部門或多租戶隔離、AI 成本監測。現在仍是單一團隊的 admin/member/viewer 權限。這些不能標為已完成。

## 原始碼同步

GitHub 外掛寫入授權尚未恢復。若透過 Vercel 的 source-file deployment 部署候選版，GitHub main 仍為上一版；後續需把此資料夾內更新的檔案同步至儲存庫，否則 Git 推送可能覆蓋候選版本。

資料來源：[經濟部 API 指引](https://data.gcis.nat.gov.tw/od/rule)、[公司登記關鍵字查詢](https://data.gcis.nat.gov.tw/od/demo_cond/6BBA2268-1367-4B42-9CCA-BC17499EBE8C)、[OpenAI 網路搜尋](https://developers.openai.com/api/docs/guides/tools-web-search)。

