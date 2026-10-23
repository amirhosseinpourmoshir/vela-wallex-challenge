// Narrow MCP adapter: no order, transfer, withdrawal or cancellation tools.
const READ_TOOLS=new Set(['wallex_basic_get_market_depth','wallex_basic_candle_history','wallex_credit_sub_account_balances_details']);
export function createWallexMcp(config,{fetchImpl=fetch}={}){
 let ready=null,sessionId=null,nextId=0,connected=false,lastError=null,calls=0;
 const endpoint=config.mcp?.serverUrl;
 if(endpoint){const u=new URL(endpoint),base=new URL(config.wallex.baseUrl);if(u.origin!==base.origin||u.pathname!=='/mcp'||u.search||u.hash)throw Error('MCP must use the configured Wallex origin and /mcp path.');}
 async function rpc(method,params,notification=false){
  const requestId=notification?null:++nextId;const r=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(config.wallex.httpTimeoutMs),headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26','x-api-key':config.wallex.apiKey,'Sub-Account-Client-id':config.wallex.subAccountId,...(sessionId?{'Mcp-Session-Id':sessionId}:{})},body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:requestId}),method,params})});
  if(!r.ok)throw Error('MCP HTTP '+r.status);sessionId=r.headers.get('mcp-session-id')||sessionId;if(notification)return;
  const raw=await r.text();let d;if(r.headers.get('content-type')?.includes('text/event-stream')){const messages=raw.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>{try{return JSON.parse(l.slice(5))}catch{return null}});d=messages.find(x=>x?.id===requestId)}else d=JSON.parse(raw);
  if(!d||d.error)throw Error('MCP request failed');return d.result;
 }
 async function initialize(){const result=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'vela-readonly',version:'1.0'}});if(!result?.capabilities?.tools)throw Error('MCP tools unavailable');await rpc('notifications/initialized',{},true);connected=true;}
 return {status:()=>({enabled:config.mcp?.enabled===true,connected,calls,lastError}),async call(name,args={}){
  if(!READ_TOOLS.has(name))throw Error('MCP tool is not read-only or not allowed');if(!config.mcp?.enabled||!endpoint)throw Error('MCP is not configured');
  try{ready??=initialize().catch(e=>{ready=null;throw e});await ready;const result=await rpc('tools/call',{name,arguments:args});if(result?.isError)throw Error('MCP tool failed');const value=result?.structuredContent||JSON.parse(result?.content?.find(c=>c.type==='text')?.text||'null');if(!value||value.success===false)throw Error('MCP returned invalid data');calls++;lastError=null;connected=true;return value.result??value;}catch(e){connected=false;lastError=String(e.message).slice(0,100);throw e;}
 }};
}
