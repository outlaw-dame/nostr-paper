import Redis from 'ioredis';
import { Client } from 'pg';
import pino from 'pino';
import { embedText } from './embed.js';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const redis = new Redis(process.env.REDIS_URL!);
const pg = new Client({ connectionString: process.env.POSTGRES_URL });

const STREAM = process.env.REDIS_STREAM || 'events.ingest';
const GROUP = 'embedding';
const CONSUMER = `embed-${Math.random().toString(36).slice(2)}`;

function backoff(attempt:number){
  const base=Math.min(1000*2**attempt,30000);
  return base+Math.floor(Math.random()*250);
}

async function ensureGroup(){
  try{
    await redis.xgroup('CREATE',STREAM,GROUP,'0','MKSTREAM');
  }catch(err:any){
    if(!err.message.includes('BUSYGROUP')) throw err;
  }
}

async function processMessage(payload:any){
  const event=JSON.parse(payload);
  if(event.kind!==1) return;
  const text=event.content||'';
  if(!text.trim()) return;
  const embedding=embedText(text);
  await pg.query(
    `UPDATE search_docs SET embedding=$1 WHERE event_id=$2`,
    [embedding,event.event_id]
  );
}

async function run(){
  await pg.connect();
  await ensureGroup();
  let attempt=0;
  while(true){
    try{
      const res=await redis.xreadgroup(
        'GROUP',GROUP,CONSUMER,
        'BLOCK',5000,
        'COUNT',20,
        'STREAMS',STREAM,'>'
      );
      if(!res) continue;
      for(const[,messages]of res){
        for(const[id,fields]of messages){
          const payload=fields[1];
          try{
            await processMessage(payload);
            await redis.xack(STREAM,GROUP,id);
          }catch(err){
            log.error({err},'embedding failed');
          }
        }
      }
      attempt=0;
    }catch(err){
      const delay=backoff(attempt++);
      log.error({err,delay},'worker retry');
      await new Promise(r=>setTimeout(r,delay));
    }
  }
}

run().catch(err=>{
  log.fatal(err);
  process.exit(1);
});
