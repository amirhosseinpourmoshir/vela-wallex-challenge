// Development-only middleware upgrade: keeps an already-running backtest alive
// when the reviewed live API is upgraded. Production mounts it in server.js.
export function reviewDevUpgrade(){
 let native=false,service,db;
 return {name:'vela-reviewed-api-upgrade',apply:'serve',configResolved(c){native=c.define?.__VELA_REVIEW_API_INSTALLED__==='true'},async configureServer(vite){
  if(native)return;
  const [{DatabaseSync},{readConfig},{createLiveOrders}]=await Promise.all([import('node:sqlite'),import('../config/env.js'),import(new URL('./live-orders.js?upgrade='+Date.now(),import.meta.url).href)]);
  const config=readConfig();db=new DatabaseSync(config.app.sqlitePath);db.exec('PRAGMA busy_timeout=5000');
  service=createLiveOrders(db,config,{onUpdate:message=>vite.ws.send('vela:live-review',message)});
  vite.middlewares.use('/api/review',service.router);
 },closeBundle(){service?.stop();db?.close();service=null;db=null}};
}
