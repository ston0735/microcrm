export const SALES = ['新商機','需求洽談','方案提案','報價議價','待簽約','結案'];
export const PROJECT = ['啟動規劃','需求確認','設計製作','開發整合','測試驗收','交付維運'];
export const TASK = ['待辦','進行中','待確認','已完成'];
export const TICKET = ['已收單','工程師出發','維修中','待料','已完工'];
export const QUOTE = ['報價中','議價中','成交','未成交'];
export const CAMPAIGN = ['草稿','已排程','已寄送'];
export const PRODUCTS = ['GAME 系統','虛擬展間','PMS 專案管理','客製化網站／軟體'];
export const TEMPLATES = {
 'GAME 系統':['啟動與資料盤點','知識與權限確認','對話流程設計','AI 與系統串接','情境測試與驗收','教育訓練與維運'],
 '虛擬展間':['展間目標確認','素材與動線確認','場景與互動設計','3D 製作與整合','跨裝置測試與驗收','上線與成效追蹤'],
 'PMS 專案管理':['流程盤點','角色與規格確認','看板與報表設計','資料匯入與整合','權限測試與驗收','教育訓練與維運'],
 '客製化網站／軟體':['啟動與範圍界定','需求規格簽核','UI／UX 設計確認','功能開發與整合','UAT 與驗收','部署交付與維運']
};
// Field allowlists also drive the form UI. IDs and server metadata cannot be supplied as content.
export const FIELDS = {
 companies: {name:'公司名稱*',industry:'產業',website:'網站',taxId:'統一編號',address:'地址',phone:'公司電話',notes:'備註／公開資料來源'},
 contacts: {name:'姓名*',companyId:'公司*',title:'職稱',email:'Email',phone:'電話',decisionRole:'決策角色',notes:'備註',inquiryDate:'諮詢日期',channel:'諮詢管道',leadStatus:'名單認列',interestProducts:'諮詢產品（可多選）',groups:'名單分組（、分隔）',subscription:'EDM 訂閱',leadOwnerId:'名單負責人'},
 opportunities: {name:'商機名稱*',companyId:'公司*',product:'產品*',stage:'階段*',outcome:'結案結果',amount:'預估金額（TWD）',probability:'成交機率（%）',dueDate:'預計簽約日',ownerId:'負責人*',needs:'需求',risks:'風險',nextStep:'下一步',lossReason:'未成交原因'},
 projects: {name:'專案名稱*',companyId:'公司*',product:'產品*',stage:'階段*',ownerId:'負責人*',dueDate:'交付日期',description:'專案範圍',risks:'風險'},
 tasks: {name:'任務名稱*',opportunityId:'商機',projectId:'專案',ownerId:'負責人*',stage:'狀態*',priority:'優先級',dueDate:'截止日期',description:'內容'},
 visits: {name:'紀錄標題*',companyId:'公司*',opportunityId:'商機',projectId:'專案',date:'日期*',method:'方式*',attendees:'與會人',discussion:'討論內容*',needs:'需求',competitors:'競品',intent:'意向',budget:'預算（TWD）',nextStep:'下一步',followUpAt:'跟進時間',ownerId:'負責人*'},
 meetings: {name:'會議名稱*',companyId:'公司*',opportunityId:'商機',projectId:'專案',date:'日期*',attendees:'與會人',transcript:'會議紀錄全文（可直接貼上）',summary:'摘要',decisions:'決議',changes:'變更',risks:'風險',todos:'待辦',ownerId:'負責人*'},
 milestones: {name:'里程碑名稱*',projectId:'專案*',stage:'狀態*',dueDate:'預定完成日',description:'驗收條件'},
 files: {name:'檔案名稱*',companyId:'公司',opportunityId:'商機',projectId:'專案',visitId:'拜訪紀錄',meetingId:'會議紀錄',description:'說明'},
 instruments: {name:'儀器名稱*',companyId:'客戶公司*',model:'機型*',serialNo:'序號',gunType:'電子槍類型',detectors:'偵測器配置',softwareVersion:'軟體版本',installDate:'裝機日期',warrantyStatus:'保固／合約狀態',warrantyDate:'保固到期日',location:'安裝地點',notes:'備註（規格、校正參數）'},
 contracts: {name:'合約名稱*',companyId:'客戶公司*',instrumentId:'適用儀器',contractType:'合約類型*',startDate:'合約起日*',endDate:'合約迄日*',inspections:'巡檢次數（合約期內）',callouts:'叫修次數（合約期內）',includes:'其他包含項目',amount:'合約金額（未稅）',billingTerms:'請款條件',ownerId:'負責業務*',notes:'備註'},
 tickets: {name:'工單主旨*',companyId:'客戶公司*',instrumentId:'儀器',contractId:'所屬合約',kind:'工單類型*',stage:'處理狀態*',priority:'優先級',channel:'報修管道',errorCode:'錯誤代碼',symptom:'故障描述／工作內容*',scheduledDate:'預約到場日',ownerId:'負責工程師*',diagnosis:'診斷與處理',partsUsed:'更換零件',calibration:'校正數據',signedBy:'客戶簽收人',completedDate:'完工日期'},
 quotes: {name:'報價主旨*',quoteNo:'報價單號（自動產生）',companyId:'客戶公司*',contactId:'聯絡人',opportunityId:'關聯商機',category:'報價類別*',stage:'報價狀態*',quoteDate:'報價日期*',items:'品項明細*',finalAmount:'議價後成交金額（未稅）',validDays:'有效天數',delivery:'交期',payment:'付款方式',terms:'條款備註',ownerId:'負責業務*',invoiceNo:'發票號碼',invoiceDate:'發票開立日',paymentStatus:'款項狀態'},
 products: {name:'品名*',sku:'品號*',category:'分類*',compatibleModels:'適用機型（、分隔；空白＝通用）',unit:'單位',price:'建議售價',openingStock:'期初數量',safetyStock:'安全庫存',location:'儲位',notes:'備註'},
 stockmoves: {name:'異動說明*',productId:'品項*',kind:'異動類型*',qty:'數量*',date:'日期*',ticketId:'關聯工單',ownerId:'經手人*',notes:'備註（進出貨單號等）'},
 articles: {name:'標題*',errorCode:'錯誤代碼',models:'適用機型',category:'類別',symptom:'症狀描述',solution:'排除步驟 SOP*',source:'來源／參考文件'},
 campaigns: {name:'Email 主旨（A 版）*',subjectB:'主旨 B 版（A/B 測試，選填）',preheader:'預覽文字',senderName:'寄件人名稱',senderEmail:'寄件人信箱',targetGroups:'寄送分組（、分隔）',excludeGroups:'排除分組（、分隔）',stage:'狀態*',sendAt:'預定寄送時間',content:'信件內容*',delivered:'成功遞送',bounced:'退回',opened:'開啟',clicked:'點擊',unsubscribed:'取消訂閱'}
};
export const ENTITIES = Object.keys(FIELDS);
export const REF = {companyId:'companies',opportunityId:'opportunities',projectId:'projects',visitId:'visits',meetingId:'meetings',ownerId:'users',leadOwnerId:'users',instrumentId:'instruments',contractId:'contracts',ticketId:'tickets',productId:'products',contactId:'contacts'};
// Stage lists per entity (board columns and validation).
export const STAGES = {opportunities:SALES,projects:PROJECT,tasks:TASK,milestones:TASK,tickets:TICKET,quotes:QUOTE,campaigns:CAMPAIGN};
// Select options; MULTI fields store values joined with '、'.
export const OPTIONS = {
 gunType:['鎢絲 (W)','CeB6','場發射 (FEG)','其他'],
 detectors:['SED 二次電子','BSD 背向散射','EDS 能譜','EBSD','CL 陰極螢光','STEM'],
 warrantyStatus:['保固內','全包合約','勞務合約','過保'],
 contractType:['全包合約','勞務合約','巡檢保養合約','延長保固'],
 kind:{tickets:['叫修','PM 巡檢','裝機','RMA 返修'],stockmoves:['國內進貨','國外進貨','國內出貨','國外出貨','維修領用','盤點調整']},
 channel:{tickets:['電話','LINE','Email','網頁','儀器 Log 回傳','業務轉介'],contacts:['官網表單','展覽','研討會','電話','Email','LINE','業務開發','轉介']},
 category:{quotes:['維修保養','耗材','設備','零件'],products:['耗材','備品零件','設備','Demo 機'],articles:['真空系統','電子光學','偵測器','軟體','機構','其他']},
 paymentStatus:['未請款','已請款','已入帳'],
 leadStatus:['待確認','有效名單','無效名單','重複名單'],
 subscription:['訂閱中','已取消訂閱'],
 interestProducts:['Phenom 桌上型 SEM','Ion Milling (CP)','防震台','主動式消磁器','光學顯微鏡','鑲埋／切割／研磨設備','耗材','維修保養合約']
};
export const MULTI = ['detectors','interestProducts'];
export const NUMBERS = ['amount','budget','probability','inspections','callouts','finalAmount','validDays','price','openingStock','safetyStock','qty','delivered','bounced','opened','clicked','unsubscribed'];
export const optionsFor=(type,key)=>{const o=OPTIONS[key];return Array.isArray(o)?o:o?.[type];};
export function fail(message,status=400) { throw Object.assign(new Error(message),{status}); }
export function validate(db,type,input,existing={}) {
 if (!FIELDS[type] || !input || typeof input!=='object' || Array.isArray(input)) fail('資料格式錯誤');
 const data={};
 for (const [key,label] of Object.entries(FIELDS[type])) {
   const value=input[key] ?? existing[key] ?? '';
   if (typeof value!=='string' && typeof value!=='number') fail(`${label}格式錯誤`);
   data[key]=String(value).trim();
   if (data[key].length > (['transcript','discussion','description'].includes(key)?50000:10000)) fail(`${label}過長`);
   if (label.endsWith('*') && !data[key]) fail(`${label.slice(0,-1)}為必填`);
   if (REF[key] && data[key] && !db.prepare(`SELECT id FROM ${REF[key]} WHERE id=?`).get(data[key])) fail(`${label}不存在`);
   if (/Date$/.test(key) || ['date','followUpAt','sendAt'].includes(key)) {
     if (data[key] && (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(data[key]) || !Number.isFinite(Date.parse(data[key])))) fail(`${label}格式錯誤`);
   }
   if (NUMBERS.includes(key) && data[key] && (!Number.isFinite(Number(data[key])) || (key!=='qty' && Number(data[key])<0) || (key==='probability' && Number(data[key])>100))) fail(`${label}格式錯誤`);
 }
 if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail('Email 格式錯誤');
 if (data.senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.senderEmail)) fail('寄件人信箱格式錯誤');
 if (type==='contracts' && data.startDate && data.endDate && data.endDate<data.startDate) fail('合約迄日不可早於起日');
 if (type==='stockmoves' && Number(data.qty)===0) fail('數量不可為 0');
 if(type==='companies'&&data.taxId&&!/^\d{8}$/.test(data.taxId))fail('台灣統一編號須為 8 碼數字');
 for(const [key,value] of Object.entries(data))if(value&&(/Date$/.test(key)||['date','followUpAt','sendAt'].includes(key))){const [y,m,d]=value.slice(0,10).split('-').map(Number);const actual=new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10);if(actual!==value.slice(0,10))fail('日期不存在，請確認年月日');}
 if (data.website && !/^https?:\/\//.test(data.website)) fail('網站需以 http:// 或 https:// 開頭');
 if (data.product && !PRODUCTS.includes(data.product)) fail('產品類型錯誤');
 const stages=STAGES[type]||null;
 if (stages && !stages.includes(data.stage)) fail('階段錯誤');
 if(type==='opportunities') {
   if(data.stage==='結案' && !['成交','未成交'].includes(data.outcome)) fail('結案必須選擇成交或未成交');
   if(data.stage!=='結案') data.outcome='';
   if(data.outcome==='未成交' && !data.lossReason) fail('請填寫未成交原因');
 }
 if (data.opportunityId && data.projectId) {
   const p=JSON.parse(db.prepare('SELECT payload FROM projects WHERE id=?').get(data.projectId).payload);
   if(p.opportunityId!==data.opportunityId) fail('商機與專案關聯不一致');
 }
 for(const field of ['opportunityId','projectId','visitId','meetingId','instrumentId','contractId','contactId']) if(data[field] && data.companyId) {
   const r=JSON.parse(db.prepare(`SELECT payload FROM ${REF[field]} WHERE id=?`).get(data[field]).payload);
   if(r.companyId && r.companyId!==data.companyId) fail('所選紀錄屬於其他公司');
 }
 return data;
}

