import { createServer } from 'node:http';
// 仅用于专属本机代理实验，不接受业务数据。
createServer((req,res) => {
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});
  res.write('data: first\n\n');
  if (req.url === '/idle') return;
  let n=0;
  const tick=setInterval(()=>{
    n++;
    res.write('data: '+n+'\n\n');
    if (n===5) { clearInterval(tick); res.end(); }
  },700);
  res.on('close',()=>clearInterval(tick));
}).listen(3000,'0.0.0.0');
