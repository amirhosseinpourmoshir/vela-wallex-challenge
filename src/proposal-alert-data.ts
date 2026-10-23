export type AlertProposal={id:string;status:string;createdAt:number;expiresAt:number;symbol:string;quote:{side:string;model?:{reviewId?:number}}};
export const proposalAlertKey=(o:AlertProposal)=>o.quote.model?.reviewId?'review:'+o.quote.model.reviewId:'order:'+o.id;
export function newProposalAlerts(orders:AlertProposal[],seen:Set<string>,mountedAt:number,now:number){
 const fresh:AlertProposal[]=[];for(const o of [...orders].sort((a,b)=>a.createdAt-b.createdAt)){const key=proposalAlertKey(o);if(seen.has(key))continue;seen.add(key);if(o.status==='draft'&&o.createdAt>=mountedAt&&o.expiresAt>now)fresh.push(o)}return fresh;
}
