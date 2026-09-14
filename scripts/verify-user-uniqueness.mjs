import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const require=createRequire(new URL('../apps/server/package.json',import.meta.url));
const {Pool}=require('pg');const {readConfig}=await import('../apps/server/dist/config.js');
const config=readConfig();const url=new URL(config.DATABASE_URL);assert(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Local DB only');
const schema='test_identity_'+randomUUID().replaceAll('-','');assert(/^test_identity_[a-f0-9]{32}$/.test(schema));
const pool=new Pool({connectionString:config.DATABASE_URL});let created=false;let client;
try{
 client=await pool.connect();await client.query(`CREATE SCHEMA "${schema}"`);created=true;
 await client.query(`SET search_path TO "${schema}"`);
 const journal=JSON.parse(await readFile(new URL('../apps/server/drizzle/meta/_journal.json',import.meta.url),'utf8'));
 for(const entry of journal.entries){const sql=await readFile(new URL(`../apps/server/drizzle/${entry.tag}.sql`,import.meta.url),'utf8');await client.query(sql.replaceAll('"public".',`"${schema}".`));}
 client.release();client=undefined;
 url.searchParams.set('options',`-c search_path=${schema}`);
 const exitCode=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['apps/server/scripts/test-integration.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,DATABASE_URL:url.toString()},stdio:'inherit'});child.on('error',reject);child.on('exit',code=>resolve(code));});
 assert.equal(exitCode,0,'Isolated API verification failed');console.log('PASS isolated username uniqueness migration/API tests; application rows untouched.');
}finally{
 if(client)client.release();
 if(created)await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
 await pool.end();
}
