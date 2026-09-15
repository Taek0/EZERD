import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const routes=new Map([
['/', 'artifacts/brand/ezerd-notion-cover.html'],
['/apps/web/src/tokens.css','apps/web/src/tokens.css'],
]);
const fontDir='apps/web/public/fonts/apple-sd-gothic-neo/';
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 let file=routes.get(url.pathname);
 if(url.pathname.startsWith('/'+fontDir)&&/^[A-Za-z0-9.-]+$/.test(url.pathname.slice(fontDir.length+1))) file=url.pathname.slice(1);
 if(!file){res.writeHead(404).end();return;}
 try {const data=await readFile(path.join(root,file));res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.woff')?'font/woff':'text/html');res.end(data);}catch{res.writeHead(404).end();}
}).listen(5189,'127.0.0.1');
