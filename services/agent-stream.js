// Shares /ws with live market quotes; simulation updates never place orders.
export function attachAgentStream(wss,agent){
 const subscriptions=new WeakMap();
 function send(socket,message){if(socket.readyState!==1)return;if(socket.bufferedAmount>2_000_000){socket.close(1013,'Reconnect for a current snapshot');return}socket.send(JSON.stringify(message))}
 wss.on('connection',socket=>{
  subscriptions.set(socket,null);
  const initial=agent.latestSnapshot();send(socket,{type:'agent_update',runId:initial?.run.id??null,detail:initial,budget:agent.budgetSnapshot()});
  socket.on('message',buffer=>{if(buffer.length>1000)return;try{const m=JSON.parse(buffer.toString());if(m.type!=='agent_subscribe')return;const id=m.runId;if(id!==null&&(!Number.isSafeInteger(id)||id<1))return;subscriptions.set(socket,id);const detail=id===null?agent.latestSnapshot():agent.snapshot(id);send(socket,{type:'agent_update',runId:id??detail?.run.id??null,detail,budget:agent.budgetSnapshot()})}catch{/* ignore malformed subscription frames */}});
 });
 return {publish(message){for(const socket of wss.clients){const selected=subscriptions.get(socket);send(socket,{...message,detail:selected===null||selected===message.runId?message.detail:undefined,run:message.detail?.run??null})}}};
}
