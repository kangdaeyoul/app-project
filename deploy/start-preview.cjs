const {spawn}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const api=spawn(process.execPath,['dist/main.js'],{cwd:path.join(root,'apps/api'),stdio:'inherit',env:{...process.env,HOST:'127.0.0.1',PORT:'4000'}});
const web=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'start','--hostname','0.0.0.0','--port',process.env.PORT||'3000'],{cwd:path.join(root,'apps/admin-web'),stdio:'inherit',env:{...process.env,API_URL:'http://127.0.0.1:4000'}});
let closing=false;
function stop(code=0){if(closing)return;closing=true;api.kill('SIGTERM');web.kill('SIGTERM');process.exitCode=code;}
for(const child of [api,web]){child.on('error',err=>{console.error(err);stop(1)});child.on('exit',code=>stop(code||0));}
process.on('SIGTERM',()=>stop());process.on('SIGINT',()=>stop());
