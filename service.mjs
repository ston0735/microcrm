// Cross-department service logic: quote numbering, stock control, PM scheduling, white-label settings and demo data.
import {fail} from './domain.mjs';
import {list,get,save,purgeRows} from './cloud-db.mjs';

// ---------- White-label settings ----------
export const SETTING_DEFAULTS={
 brandMark:'GAME',brandName:'精冠智能',brandTagline:'工作平台',
 quoteCompany:'精冠智能',quoteHeader:'',quotePrefix:'Q',
 quoteTerms:'1.本估價單有效期限30天。\n2.交期：30天。\n3.付款方式：當月結30天。\n4.交易條件：限臺灣地區。\n5.訂單確認無誤，請簽章回傳，將視為正式訂單。'
};
export const DEPARTMENTS=['管理','業務','行銷','維修','客服'];
export async function getSettings(db){const s={...SETTING_DEFAULTS};for(const r of await db.prepare('SELECT key,value FROM settings').all())if(r.key in SETTING_DEFAULTS)s[r.key]=r.value;return s;}
export async function saveSettings(db,input){
 if(!input||typeof input!=='object')fail('資料格式錯誤');
 for(const key of Object.keys(SETTING_DEFAULTS))if(typeof input[key]==='string'){
  const value=input[key].trim().slice(0,key==='quoteTerms'||key==='quoteHeader'?2000:80);
  if(key==='quotePrefix'&&!/^[A-Za-z0-9]{1,8}$/.test(value))fail('報價單號前綴限 1–8 碼英數字');
  await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value').run(key,value);
 }
 return getSettings(db);
}
export async function setDepartment(db,userId,department){
 if(!DEPARTMENTS.includes(department))fail('部門錯誤');
 if(!await db.prepare('SELECT id FROM users WHERE id=?').get(userId))fail('帳號不存在',404);
 await db.prepare('INSERT INTO user_departments(userId,department) VALUES(?,?) ON CONFLICT(userId) DO UPDATE SET department=EXCLUDED.department').run(userId,department);
}

// ---------- Quotes ----------
// PREFIX-YYYYMMDD-NNN, sequence per day; the date part follows the quote date.
export async function nextQuoteNo(db,quoteDate){
 const {quotePrefix}=await getSettings(db);const day=String(quoteDate||new Date().toISOString().slice(0,10)).replaceAll('-','');
 const base=`${quotePrefix}-${day}-`;let max=0;
 for(const q of await list(db,'quotes'))if(String(q.quoteNo||'').startsWith(base))max=Math.max(max,Number(q.quoteNo.slice(base.length))||0);
 for(const r of await db.prepare('SELECT payload FROM quotes WHERE deletedAt IS NOT NULL').all()){const n=JSON.parse(r.payload).quoteNo||'';if(n.startsWith(base))max=Math.max(max,Number(n.slice(base.length))||0);}
 return base+String(max+1).padStart(3,'0');
}

// ---------- Stock ----------
const OUT=['國內出貨','國外出貨','維修領用'];
export const signedQty=m=>{const q=Number(m.qty)||0;return m.kind==='盤點調整'?q:OUT.includes(m.kind)?-Math.abs(q):Math.abs(q);};
export async function stockOf(db,productId,excludeId=null){
 const p=await get(db,'products',productId);if(!p)return 0;let n=Number(p.openingStock)||0;
 for(const m of await list(db,'stockmoves'))if(m.productId===productId&&m.id!==excludeId)n+=signedQty(m);return n;
}
// Runs before a stock movement is saved: part compatibility and no negative stock.
export async function checkStockMove(db,input,id){
 const before=id?await get(db,'stockmoves',id):{};const m={...before,...input};
 if(!m.productId)return;const product=await get(db,'products',m.productId);if(!product)fail('品項不存在');
 if(m.ticketId&&product.compatibleModels){
  const ticket=await get(db,'tickets',m.ticketId),inst=ticket?.instrumentId?await get(db,'instruments',ticket.instrumentId):null;
  const models=product.compatibleModels.split(/[、,，;；\n]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(inst&&models.length&&!models.some(x=>String(inst.model).toLowerCase().includes(x)))fail(`零件不相容：「${product.name}」適用 ${product.compatibleModels}，但此工單的儀器機型為 ${inst.model}。請確認料號。`);
 }
 const after=(await stockOf(db,m.productId,id||null))+signedQty(m);
 if(after<0)fail(`庫存不足：「${product.name}」目前庫存 ${after-signedQty(m)}，無法${m.kind} ${Math.abs(Number(m.qty))}。`);
}

// ---------- Preventive maintenance ----------
export async function schedulePm(db,contractId,userId){
 const c=await get(db,'contracts',contractId);if(!c)fail('合約不存在',404);
 const n=Math.round(Number(c.inspections)||0);if(n<1)fail('此合約未設定巡檢次數');if(n>24)fail('巡檢次數過多（上限 24）');
 const existing=(await list(db,'tickets')).filter(t=>t.contractId===contractId&&t.kind==='PM 巡檢');
 if(existing.length)fail(`此合約已有 ${existing.length} 張 PM 工單，未重複建立`,409);
 const start=Date.parse(c.startDate),end=Date.parse(c.endDate),span=end-start,created=[];
 for(let i=0;i<n;i++){
  const date=new Date(start+span*(i+0.5)/n).toISOString().slice(0,10);
  created.push(await save(db,'tickets',{name:`PM 巡檢 ${i+1}/${n}｜${c.name}`,companyId:c.companyId,instrumentId:c.instrumentId||'',contractId,kind:'PM 巡檢',stage:'已收單',priority:'中',channel:'',symptom:`依合約執行第 ${i+1} 次預防性維護巡檢：真空系統、電子槍、偵測器、Pump 狀態檢查與影像解析度測試。`,scheduledDate:date,ownerId:c.ownerId||userId},userId));
 }
 return created;
}

// ---------- Demo data (based on the client's own spreadsheet formats) ----------
export async function loadDemo(db,user){
 if(await db.prepare('SELECT entity FROM demo_records LIMIT 1').get())fail('示範資料已載入；如需重新載入請先清除',409);
 const uid=user.id;const track=async(type,input)=>{const r=await save(db,type,input,uid);await db.prepare('INSERT INTO demo_records(entity,recordId) VALUES(?,?)').run(type,r.id);return r;};
 const D=n=>{const d=new Date(Date.now()+n*86400000);return d.toISOString().slice(0,10);};
 const yr=new Date().getFullYear();
 // Companies & contacts
 const c1=await track('companies',{name:'成功大學自強校區貴重儀器中心（示範）',industry:'學術',address:'臺南市東區',notes:'示範資料'});
 const c2=await track('companies',{name:'國立中央大學 地球科學學院（示範）',industry:'學術',address:'桃園市中壢區'});
 const c3=await track('companies',{name:'勢得科研股份有限公司（示範）',industry:'業界',address:'新竹縣竹北市'});
 const c4=await track('companies',{name:'宜蘭精密材料股份有限公司（示範）',industry:'業界',address:'宜蘭縣五結鄉'});
 const p1=await track('contacts',{name:'陳經理（示範）',companyId:c4.id,title:'設備主管',email:'chen.demo@example.com',phone:'03-0000-000',inquiryDate:D(-40),channel:'展覽',leadStatus:'有效名單',interestProducts:'Phenom 桌上型 SEM、維修保養合約',groups:'既有客戶、SEM 用戶',subscription:'訂閱中',leadOwnerId:uid});
 await track('contacts',{name:'林教授（示範）',companyId:c1.id,title:'中心主任',email:'lin.demo@example.com',inquiryDate:D(-25),channel:'研討會',leadStatus:'有效名單',interestProducts:'Ion Milling (CP)、耗材',groups:'學術單位、SEM 用戶',subscription:'訂閱中',leadOwnerId:uid});
 await track('contacts',{name:'王助理（示範）',companyId:c2.id,title:'研究助理',email:'wang.demo@example.com',inquiryDate:D(-12),channel:'官網表單',leadStatus:'待確認',interestProducts:'耗材',groups:'學術單位',subscription:'訂閱中',leadOwnerId:uid});
 await track('contacts',{name:'張工程師（示範）',companyId:c3.id,title:'製程工程師',email:'chang.demo@example.com',inquiryDate:D(-8),channel:'LINE',leadStatus:'有效名單',interestProducts:'耗材、防震台',groups:'業界客戶',subscription:'已取消訂閱',leadOwnerId:uid});
 await track('contacts',{name:'李小姐（示範）',companyId:c3.id,title:'採購',email:'lee.demo@example.com',inquiryDate:D(-3),channel:'電話',leadStatus:'有效名單',interestProducts:'主動式消磁器',groups:'業界客戶',subscription:'訂閱中',leadOwnerId:uid});
 // Instruments
 const i1=await track('instruments',{name:'Phenom ProX G6｜宜蘭精密（示範）',companyId:c4.id,model:'Phenom ProX G6',serialNo:'PXG6-DEMO-0625',gunType:'CeB6',detectors:'BSD 背向散射、EDS 能譜',softwareVersion:'ProSuite 3.x',installDate:'2023-06-25',warrantyStatus:'勞務合約',warrantyDate:'2024-06-24',location:'宜蘭縣五結鄉 2F 品保實驗室',notes:'原廠搭配 RV020 Pump。'});
 const i2=await track('instruments',{name:'Phenom XL G2｜成大貴儀（示範）',companyId:c1.id,model:'Phenom XL G2',serialNo:'PXL2-DEMO-1188',gunType:'CeB6',detectors:'BSD 背向散射、SED 二次電子、EDS 能譜',softwareVersion:'ProSuite 3.x',installDate:'2024-03-21',warrantyStatus:'保固內',warrantyDate:D(150),location:'自強校區 貴重儀器中心 B1'});
 const i3=await track('instruments',{name:'Phenom Pharos｜中央地科（示範）',companyId:c2.id,model:'Phenom Pharos',serialNo:'PHA-DEMO-0507',gunType:'場發射 (FEG)',detectors:'SED 二次電子、BSD 背向散射',installDate:'2021-05-07',warrantyStatus:'過保',warrantyDate:'2023-05-06',location:'地科院 3F 實驗室'});
 // Contracts (from 維修保養合約及巡檢紀錄)
 const k1=await track('contracts',{name:'ProX G6 年度保養合約（示範）',companyId:c4.id,instrumentId:i1.id,contractType:'巡檢保養合約',startDate:`${yr}-06-25`,endDate:`${yr+1}-06-24`,inspections:'4',callouts:'2',includes:'Pump 保養 1 次',amount:'80000',billingTerms:'每次巡檢後請款（每次 $20,000）',ownerId:uid});
 const k2=await track('contracts',{name:'Pharos 勞務合約（示範）',companyId:c2.id,instrumentId:i3.id,contractType:'勞務合約',startDate:D(-330),endDate:D(35),inspections:'2',callouts:'2',amount:'60000',billingTerms:'簽約後一次請款',ownerId:uid});
 // Products (from 庫存品進銷庫存清單 / 耗材案件)
 const pr=async(sku,name,category,openingStock,safetyStock,price,compatibleModels='',unit='EA')=>track('products',{sku,name,category,openingStock:String(openingStock),safetyStock:String(safetyStock),price:String(price),compatibleModels,unit});
 const g1=await pr('EM-C200Cu','TEM Carbon film on Copper 200 mesh (50) 碳膜銅網','耗材',1,5,4200);
 await pr('EM-C300Cu','TEM Carbon film 300 mesh Copper (50) 碳膜銅網','耗材',0,5,4500);
 await pr('AGT5482','鑽石筆','耗材',6,3,1667);
 await pr('AGG3458','Membrane Box 150x150x50mm 正方型膜盒','耗材',40,20,1619);
 await pr('OSM-2-5ML','Osmium Tetroxide 2% solution 5×5ml ampoule','耗材',2,2,10600);
 const turbo=await pr('PW-1179607','Turbopump Split House','備品零件',2,1,48000,'Phenom XL');
 const usb=await pr('PW-1179382','USB Reset Switch set USB 重置開關組','備品零件',3,1,6800,'Phenom ProX、Phenom Pure、Phenom XL');
 const itx=await pr('PW-1179617','Mini ITX Board (XL 2)','備品零件',2,1,52000,'Phenom XL G2');
 const filament=await pr('CEB6-PH','CeB6 燈絲（Phenom 系列）','備品零件',4,2,38000,'Phenom ProX、Phenom XL、Phenom Pure');
 await pr('PW-100-018','Phenom XL G1（Demo 機・維修間）','Demo 機',1,0,0);
 // Knowledge base (demo SOP content; codes are illustrative)
 const kb=async(name,errorCode,models,category,symptom,solution)=>track('articles',{name,errorCode,models,category,symptom,solution,source:'示範內容，正式導入時以原廠手冊與內部 SOP 取代'});
 await kb('抽真空逾時／真空度無法達標','E-VAC-01','Phenom ProX、Phenom XL、Phenom Pure','真空系統','進樣後抽真空超過 3 分鐘仍未就緒，畫面停在 Loading。','1. 檢查樣品座 O-ring 是否沾附粉塵或破損，以無塵布清潔。\n2. 確認樣品未含揮發性溶劑、未超出高度。\n3. 檢查 Pre-vacuum pump 運轉聲與排氣，必要時更換薄膜。\n4. 檢查 Turbo pump 狀態；若有異音，安排 Pump 保養。\n5. 仍無法改善，回傳系統 Log 給工程師並開立叫修。');
 await kb('燈絲壽命終止／影像全黑','E-SRC-03','Phenom ProX、Phenom XL、Phenom Pure','電子光學','影像全黑、Emission current 為 0，或燈絲時數接近上限。','1. 查看燈絲使用時數。\n2. 依 SOP 更換 CeB6 燈絲（需領用料號 CEB6-PH，系統會檢查機型相容性）。\n3. 更換後執行 Source alignment 與亮度／對比校正。\n4. 記錄束流與解析度測試結果於工單「校正數據」。');
 await kb('BSD 影像雜訊大、對比異常','E-DET-12','Phenom ProX、Phenom XL','偵測器','BSD 影像出現條紋雜訊或對比忽高忽低。','1. 確認防震台與周邊震源（空壓機、門開關）。\n2. 檢查主動式消磁器是否啟用。\n3. 重新執行 Detector calibration。\n4. 若仍異常，檢查 BSD 排線與接地。');
 // Tickets (repair history across departments)
 const t1=await track('tickets',{name:'抽真空異常，無法進樣（示範）',companyId:c4.id,instrumentId:i1.id,contractId:k1.id,kind:'叫修',stage:'維修中',priority:'高',channel:'LINE',errorCode:'E-VAC-01',symptom:'客戶反映今早開機後抽真空超過 5 分鐘仍未就緒，產線檢驗暫停。',scheduledDate:D(0),ownerId:uid,diagnosis:'初判樣品座 O-ring 老化，Pre-vacuum pump 薄膜需更換。'});
 await track('tickets',{name:'燈絲到期更換（示範）',companyId:c1.id,instrumentId:i2.id,kind:'叫修',stage:'已完工',priority:'中',channel:'電話',errorCode:'E-SRC-03',symptom:'影像全黑，燈絲時數已達上限。',scheduledDate:D(-20),ownerId:uid,diagnosis:'更換 CeB6 燈絲並完成 Source alignment。',partsUsed:'CEB6-PH ×1',calibration:'放大倍率校正 OK；解析度測試 10 nm 通過',signedBy:'林教授（示範）',completedDate:D(-19)});
 await track('tickets',{name:'BSD 影像雜訊（示範）',companyId:c2.id,instrumentId:i3.id,contractId:k2.id,kind:'叫修',stage:'待料',priority:'中',channel:'Email',errorCode:'E-DET-12',symptom:'BSD 影像出現橫向條紋。',scheduledDate:D(2),ownerId:uid,diagnosis:'已排除震源，疑似 BSD 排線老化，待料中。'});
 await track('tickets',{name:'Pharos 合約 PM 巡檢（示範）',companyId:c2.id,instrumentId:i3.id,contractId:k2.id,kind:'PM 巡檢',stage:'已完工',priority:'中',symptom:'定期巡檢。',scheduledDate:D(-150),ownerId:uid,diagnosis:'巡檢正常。',calibration:'真空度、束流穩定度正常',signedBy:'王助理（示範）',completedDate:D(-150)});
 // Stock movements (進出貨與維修領用)
 await track('stockmoves',{name:'原廠進貨（示範）',productId:filament.id,kind:'國外進貨',qty:'2',date:D(-30),ownerId:uid,notes:'進口報單 DEMO-001'});
 await track('stockmoves',{name:'成大燈絲更換領用（示範）',productId:filament.id,kind:'維修領用',qty:'1',date:D(-19),ownerId:uid});
 await track('stockmoves',{name:'碳膜銅網出貨（示範）',productId:g1.id,kind:'國內出貨',qty:'1',date:D(-5),ownerId:uid,notes:'出貨單 DEMO-045'});
 // Quotes (from 維修保養合約與零件耗材報價單 / 耗材案件統計)
 const q=async(input)=>track('quotes',{validDays:'30',payment:'當月結30天',delivery:'30天',ownerId:uid,...input,quoteNo:await nextQuoteNo(db,input.quoteDate)});
 await q({name:'Phenom SEM 兩年保養合約（示範）',companyId:c4.id,contactId:p1.id,category:'維修保養',stage:'議價中',quoteDate:D(-2),items:'Phenom SEM 保養合約 | 2 | 年 | 68500\n(1) 巡檢保養：依測試報告表進行設備巡檢 | 4 | 次 | 0\n(2) 叫修服務：到場診斷、簡易故障排除，零件另計 | 4 | 次 | 0\n(3) PUMP 保養：Pre vacuum pump 薄膜、Turbo pump 油棉更換清潔 | 1 | Set | 0',finalAmount:'128000',terms:'更換零件保固三個月，舊品需回收（Core return）。'});
 await q({name:'白金靶材（示範）',companyId:c1.id,category:'耗材',stage:'成交',quoteDate:D(-60),items:'57mm dia×0.1mm 白金靶材 | 1 | EA | 60000',invoiceNo:'DM00000001',invoiceDate:D(-45),paymentStatus:'已入帳'});
 await q({name:'Membrane Box 膜盒（示範）',companyId:c2.id,category:'耗材',stage:'未成交',quoteDate:D(-58),items:'AGG3458 Membrane Box 150x150x50mm | 50 | EA | 1619'});
 await q({name:'鑽石筆（示範）',companyId:c3.id,category:'耗材',stage:'成交',quoteDate:D(-58),items:'AGT5482 鑽石筆 | 3 | EA | 1667',invoiceNo:'DM00000002',invoiceDate:D(-58),paymentStatus:'已入帳'});
 await q({name:'Osmium Tetroxide 2%（示範）',companyId:c3.id,category:'耗材',stage:'報價中',quoteDate:D(-6),items:'Osmium Tetroxide 2% solution 5×5ml ampoule | 1 | EA | 10600\n危險品處理費用 | 1 | EA | 5000',payment:'第一次交易須匯款全額後出貨',delivery:'期貨 30天'});
 await q({name:'ProX G6 年度保養合約（示範）',companyId:c4.id,category:'維修保養',stage:'成交',quoteDate:`${yr}-06-10`,items:'ProX G6 年度保養合約（巡檢 4、叫修 2、Pump 1） | 1 | 年 | 80000',invoiceNo:'DM00000003',invoiceDate:D(-30),paymentStatus:'已請款'});
 // EDM
 await track('campaigns',{name:'【新品】Phenom XL G2 桌上型 SEM 線上 Demo 報名（示範）',subjectB:'免進實驗室！看 XL G2 如何 3 分鐘完成大樣品觀察（示範）',preheader:'11 月場次開放報名，名額有限',senderName:'業務團隊',senderEmail:'marketing@example.com',targetGroups:'SEM 用戶、學術單位',excludeGroups:'',stage:'已寄送',sendAt:D(-10)+'T10:00',content:'親愛的客戶您好：\n\n我們將於 11 月舉辦 Phenom XL G2 線上 Demo……\n\n[立即報名]',delivered:'186',bounced:'4',opened:'79',clicked:'23',unsubscribed:'2'});
 await track('campaigns',{name:'年度保養合約續約優惠（示範）',preheader:'續約享巡檢加贈一次',senderName:'客服中心',senderEmail:'service@example.com',targetGroups:'既有客戶',excludeGroups:'',stage:'草稿',content:'您的設備保養合約即將到期……'});
 void t1;void turbo;void usb;void itx;
 return {loaded:(await db.prepare('SELECT count(*) n FROM demo_records').get()).n};
}
export async function clearDemo(db,user){
 const seeds=(await db.prepare('SELECT entity,recordId FROM demo_records').all()).map(r=>({type:r.entity,id:r.recordId}));
 if(!seeds.length)fail('目前沒有示範資料',404);
 const removed=await purgeRows(db,seeds);await db.prepare('DELETE FROM demo_records').run();
 return {removed};
}
