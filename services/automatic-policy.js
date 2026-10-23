// Server authority is the persisted, explicitly enabled monitor session.
// This module cannot send exchange requests or manufacture a human approval.
export function prepareAutomaticPolicy(settings,body,e,now){
 if(body.executionMode!=='automatic')return null;
 if(body.acknowledgeAutomaticExecution!==true)throw Error('فعال‌سازی اجرای خودکار به پذیرش صریح مجوز این جلسه نیاز دارد.');
 const duration=Number(body.autoDurationMinutes??60),maxEntries=Number(body.autoMaxEntries??10),lossPercent=Number(body.autoMaxLossPercent??2);
 if(!Number.isInteger(duration)||duration<1||duration>10080||!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>100||!Number.isFinite(lossPercent)||lossPercent<.1||lossPercent>10)throw Error('مدت، تعداد ورود یا سقف زیان مجوز خودکار معتبر نیست.');
 if(!Number.isFinite(e.equity)||e.equity<=0||settings.amountTmn>e.equity)throw Error('بودجهٔ مجوز بیشتر از سرمایهٔ قابل تأیید است.');
 return {version:1,authorizedAt:now,expiresAt:now+duration*60000,budgetTmn:settings.amountTmn,maxEntries,maxLossTmn:settings.amountTmn*lossPercent/100,lossPercent,baselineEquity:e.equity};
}
export function authorizeAutomaticOrder(session,order,e,allOrders,now){
 const policy=session.settings.automatic,q=order.quote;
 if(session.status!=='watching'||!policy||session.settings.executionMode!=='automatic'||now>=policy.expiresAt)throw Error('مجوز اجرای خودکار فعال نیست یا منقضی شده است.');
 if(q.monitorSessionId!==session.id||!q.model?.reviewId||!session.settings.symbols.includes(q.symbol))throw Error('سفارش متعلق به این جلسه و تصمیم مدل نیست.');
 if(q.profile.level!==session.settings.riskLevel)throw Error('پروفایل سفارش با مجوز جلسه متفاوت است.');
 if(session.settings.kind!=='auto'&&q.kind!=='margin_close'&&q.kind!==session.settings.kind)throw Error('نوع معامله خارج از مجوز جلسه است.');
 const own=allOrders.filter(o=>o.id!==order.id&&o.quote.monitorSessionId===session.id),submitted=own.filter(o=>!['draft','expired','invalidated','rejected'].includes(o.status));
 const enters=o=>o.kind==='margin'||o.kind==='spot'&&o.quote.side==='buy';
 const closing=q.kind==='margin_close'||q.kind==='spot'&&q.side==='sell';
 if(closing){
  if(q.kind==='margin_close'){
   const source=submitted.find(o=>o.kind==='margin'&&String(o.exchangeId)===String(q.positionId));
   const p=e.positions.find(p=>String(p.id)===String(q.positionId)&&p.market===q.symbol);
   if(!source||!p||p.first_order_filled===false||!(p.first_order_filled||p.opened_at))throw Error('خروج خودکار فقط برای موقعیت پرشدهٔ همین جلسه مجاز است.');
  }else{
   const inventory=submitted.filter(o=>o.kind==='spot'&&o.symbol===q.symbol).reduce((sum,o)=>{const executed=Number(o.response?.executedQty||0);return sum+(o.quote.side==='buy'?executed:-(['accepted','partial','unknown','submitting'].includes(o.status)?Number(o.quote.quantity):executed))},0);
   if(!Number.isFinite(inventory)||Number(q.quantity)>inventory+1e-12)throw Error('فروش خودکار از مقدار خریداری‌شدهٔ همین جلسه بیشتر است.');
  }
  if(submitted.some(o=>o.id!==order.id&&o.kind===q.kind&&['accepted','partial','unknown','submitting'].includes(o.status)&&(q.kind==='margin_close'?o.quote.positionId===q.positionId:o.symbol===q.symbol&&o.quote.side==='sell')))throw Error('یک خروج برای این موقعیت هنوز تعیین تکلیف نشده است.');
  return {closing:true,policy};
 }
 if(!['margin','spot'].includes(q.kind))throw Error('نوع ورود خودکار پشتیبانی نمی‌شود.');
 if(submitted.some(o=>o.id!==order.id&&o.symbol===q.symbol&&['accepted','partial','unknown','submitting'].includes(o.status)))throw Error('سفارش قبلی همین ارز هنوز تعیین تکلیف نشده است.');
 const entries=submitted.filter(enters),used=entries.reduce((sum,o)=>sum+Number(o.quote.collateral||o.quote.notional)+Number(o.quote.estimatedFees||0),0),cost=Number(q.collateral||q.notional)+Number(q.estimatedFees||0);
 if(entries.length>=policy.maxEntries||!Number.isFinite(cost)||cost<=0||used+cost>policy.budgetTmn)throw Error('سقف تعداد ورود یا مجموع مبالغ ورود این مجوز پر شده است.');
 let equity=e.equity;
 const ownIds=new Set(submitted.filter(o=>o.kind==='margin').map(o=>String(o.exchangeId)));
 for(const p of e.positions.filter(p=>ownIds.has(String(p.id))&&p.first_order_filled!==false)){
  if(p.profit?.currency!=='TMN'||!Number.isFinite(Number(p.profit.value)))throw Error('ارزش سود و زیان باز برای کنترل زیان مجوز قابل تأیید نیست؛ ورود جدید مسدود شد.');
  equity+=Math.min(0,Number(p.profit.value));
 }
 if(!Number.isFinite(equity)||policy.baselineEquity-equity>=policy.maxLossTmn)throw Error('سقف زیان مجوز فعال شد؛ فقط خروج از دارایی‌های همین جلسه مجاز است.');
 return {closing:false,usedTmn:used,costTmn:cost,policy};
}
