import express from 'express';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config/env.js';
import { serviceChecksRouter } from './services/service-checks.js';
import { readMarketCatalog } from './services/market-catalog.js';
import { createLiveMarkets } from './services/live-markets.js';
import { createKnowledge } from './services/knowledge.js';
import { createAgent } from './services/agent-engine.js';
import { createLiveOrders } from './services/live-orders.js';
import { attachAgentStream } from './services/agent-stream.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const config = readConfig();
mkdirSync(path.dirname(config.app.sqlitePath),{recursive:true});
const db = new DatabaseSync(config.app.sqlitePath);
db.exec(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL DEFAULT 'shadow', paused INTEGER NOT NULL DEFAULT 1); INSERT OR IGNORE INTO settings(id) VALUES(1);`);
const app = express();
app.use(express.json());
app.use('/api/services', serviceChecksRouter(config));
const knowledge=createKnowledge(db,config);
app.use('/api/knowledge',knowledge.router);
let agentStream=null;
const agent=createAgent(db,config,{onUpdate:message=>agentStream?.publish(message)});
app.use('/api/agent',agent.router);
const liveOrders=createLiveOrders(db,config,{onUpdate:message=>{for(const socket of wss.clients)if(socket.readyState===1)socket.send(JSON.stringify(message))}});
app.use('/api/live',liveOrders.router);
app.get('/api/markets', (_,res)=>{res.set('Cache-Control','no-store');res.json(liveMarkets.snapshot());});
app.get('/api/status',(_,res)=>res.json({agentImplemented:true,liveTradingEnabled:false,liveOrderReviewEnabled:config.reviewTrading.enabled,sqlite:true,...db.prepare('SELECT mode, paused FROM settings WHERE id=1').get()}));
app.post('/api/pause',(req,res)=>{if(typeof req.body.paused!=='boolean')return res.status(400).json({error:'paused must be boolean'});db.prepare('UPDATE settings SET paused=? WHERE id=1').run(Number(req.body.paused));res.json({paused:req.body.paused,demo:true});});
const server=createServer(app);
const wss=new WebSocketServer({server,path:'/ws'});
agentStream=attachAgentStream(wss,agent);
const liveMarkets=createLiveMarkets(db,config,message=>{const json=JSON.stringify(message);for(const socket of wss.clients)if(socket.readyState===1)socket.send(json);});
wss.on('connection',socket=>socket.send(JSON.stringify({type:'market_state',...liveMarkets.snapshot()})));
const timer=setInterval(()=>{for(const socket of wss.clients)if(socket.readyState===1)socket.send(JSON.stringify({type:'heartbeat',time:Date.now(),demo:true}));},10000);
if(config.app.nodeEnv==='production'){app.use(express.static(path.join(root,'dist')));app.get('/{*path}',(_,res)=>res.sendFile(path.join(root,'dist','index.html')));}
else{const {createServer:createViteServer}=await import('vite');const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
server.listen(config.app.port,'127.0.0.1',()=>console.log(`Vela ready: http://localhost:${config.app.port}`));
function shutdown(){clearInterval(timer);liveMarkets.stop();knowledge.stop();agent.stop();liveOrders.stop();for(const socket of wss.clients)socket.terminate();wss.close();server.close(()=>{db.close();process.exit(0);});}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
