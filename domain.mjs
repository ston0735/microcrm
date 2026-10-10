export const SALES = ['新商機','需求洽談','方案提案','報價議價','待簽約','結案'];
export const PROJECT = ['啟動規劃','需求確認','設計製作','開發整合','測試驗收','交付維運'];
export const TASK = ['待辦','進行中','待確認','已完成'];
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
 contacts: {name:'姓名*',companyId:'公司*',title:'職稱',email:'Email',phone:'電話',decisionRole:'決策角色',notes:'備註'},
 opportunities: {name:'商機名稱*',companyId:'公司*',product:'產品*',stage:'階段*',outcome:'結案結果',amount:'預估金額（TWD）',probability:'成交機率（%）',dueDate:'預計簽約日',ownerId:'負責人*',needs:'需求',risks:'風險',nextStep:'下一步',lossReason:'未成交原因'},
 projects: {name:'專案名稱*',companyId:'公司*',product:'產品*',stage:'階段*',ownerId:'負責人*',dueDate:'交付日期',description:'專案範圍',risks:'風險'},
 tasks: {name:'任務名稱*',opportunityId:'商機',projectId:'專案',ownerId:'負責人*',stage:'狀態*',priority:'優先級',dueDate:'截止日期',description:'內容'},
 visits: {name:'紀錄標題*',companyId:'公司*',opportunityId:'商機',projectId:'專案',date:'日期*',method:'方式*',attendees:'與會人',discussion:'討論內容*',needs:'需求',competitors:'競品',intent:'意向',budget:'預算（TWD）',nextStep:'下一步',followUpAt:'跟進時間',ownerId:'負責人*'},
 meetings: {name:'會議名稱*',companyId:'公司*',opportunityId:'商機',projectId:'專案',date:'日期*',attendees:'與會人',transcript:'原始逐字稿',summary:'摘要',decisions:'決議',changes:'變更',risks:'風險',todos:'待辦',ownerId:'負責人*'},
 milestones: {name:'里程碑名稱*',projectId:'專案*',stage:'狀態*',dueDate:'預定完成日',description:'驗收條件'},
 files: {name:'檔案名稱*',companyId:'公司',opportunityId:'商機',projectId:'專案',visitId:'拜訪紀錄',meetingId:'會議紀錄',description:'說明'}
};
export const ENTITIES = Object.keys(FIELDS);
export const REF = {companyId:'companies',opportunityId:'opportunities',projectId:'projects',visitId:'visits',meetingId:'meetings',ownerId:'users'};
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
   if (/Date$/.test(key) || ['date','followUpAt'].includes(key)) {
     if (data[key] && (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(data[key]) || !Number.isFinite(Date.parse(data[key])))) fail(`${label}格式錯誤`);
   }
   if (['amount','budget','probability'].includes(key) && data[key] && (!Number.isFinite(Number(data[key])) || Number(data[key])<0 || (key==='probability' && Number(data[key])>100))) fail(`${label}格式錯誤`);
 }
 if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail('Email 格式錯誤');
 if(type==='companies'&&data.taxId&&!/^\d{8}$/.test(data.taxId))fail('台灣統一編號須為 8 碼數字');
 for(const [key,value] of Object.entries(data))if(value&&(/Date$/.test(key)||['date','followUpAt'].includes(key))){const [y,m,d]=value.slice(0,10).split('-').map(Number);const actual=new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10);if(actual!==value.slice(0,10))fail('日期不存在，請確認年月日');}
 if (data.website && !/^https?:\/\//.test(data.website)) fail('網站需以 http:// 或 https:// 開頭');
 if (data.product && !PRODUCTS.includes(data.product)) fail('產品類型錯誤');
 const stages=type==='opportunities'?SALES:type==='projects'?PROJECT:['tasks','milestones'].includes(type)?TASK:null;
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
 for(const field of ['opportunityId','projectId','visitId','meetingId']) if(data[field] && data.companyId) {
   const r=JSON.parse(db.prepare(`SELECT payload FROM ${REF[field]} WHERE id=?`).get(data[field]).payload);
   if(r.companyId && r.companyId!==data.companyId) fail('所選紀錄屬於其他公司');
 }
 return data;
}

