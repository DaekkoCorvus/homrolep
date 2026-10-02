import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createNanoGPT, NANOGPT_BASE_URL } from '../src/server/ai/provider.js';
import { createSettingsStore } from '../src/server/ai/settings.js';
import { createAppServer } from '../src/server/index.js';

const profile = { name:'Mara', age:24, gender:'woman', race:'human', origin:'Viajé en tren en busca de mi hermana.' };
const completion = (content, finish_reason='stop') => ({ ok:true, json:async()=>({ choices:[{ message:{ content }, finish_reason }] }) });

test('NanoGPT transport handles errors without disclosing provider payloads or credentials', async () => {
  for (const [status, code] of [[401,'AI_AUTH'],[402,'AI_BALANCE'],[429,'AI_RATE_LIMIT'],[503,'AI_UNAVAILABLE']]) {
    const ai=createNanoGPT(async()=>({ ok:false, status, json:async()=>({ error:'private-key' }) }));
    await assert.rejects(ai.verify({ apiKey:'private-key', model:'test-model' }), (error)=>error.code===code && !error.message.includes('private-key'));
  }
  for (const response of [completion(''), completion('incomplete','length'), { ok:true, json:async()=>{throw new SyntaxError('private-key');} }]) {
    await assert.rejects(createNanoGPT(async()=>response).verify({apiKey:'private-key', model:'test-model'}));
  }
  await assert.rejects(createNanoGPT(async()=>{throw Object.assign(new Error(),{name:'TimeoutError'});}).verify({apiKey:'key',model:'test'}), {code:'AI_TIMEOUT'});
});

test('settings gate, generation, persistence, failures and concurrent requests work through the API', async (t) => {
  const directory=await mkdtemp(path.join(tmpdir(),'hom-ai-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const settings=createSettingsStore(directory);
  const runs=new Map();
  let fail=false, badPrologue=false, block=false; const releases=[];
  const calls=[];
  const ai=createNanoGPT(async(url, options)=>{
    calls.push({url,options});
    assert.equal(options.headers.authorization,'Bearer test-secret');
    assert.equal(options.redirect,'error');
    if(fail) return {ok:false,status:401};
    if(url.endsWith('/models')) return {ok:true,json:async()=>({data:[{id:'test-model'}]})};
    const body=JSON.parse(options.body);
    assert.equal(body.model,'meta/muse-spark-1.3-contributor');
    assert.equal(body.stream,false);
    assert.ok(body.max_tokens>0);
    assert.ok(!options.body.includes('test-secret'));
    if(block) await new Promise(resolve=>{releases.push(resolve);}); // la narración y la actualización de fondo del GM van en paralelo
    if(body.messages[0].content.includes('prólogo de 2 a 4 frases')) return completion(JSON.stringify({text:'La estación te recibe entre murmullos.',locationId:badPrologue?'unknown':'station'}));
    return completion('Una viajera levanta la mirada y responde a tu saludo.');
  });
  const server=createAppServer({ai,settings,store:{
    saveRun:async(run)=>runs.set(run.id,structuredClone(run)),
    loadRun:async(id)=>structuredClone(runs.get(id)),
    listRuns:async()=>[...runs.values()]
  }});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function api(route,method='GET',body,headers={}) {
    const response=await fetch(base+route,{method,headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  }
  assert.equal((await api('/api/ai/settings')).body.configured,false);
  assert.equal((await api('/api/runs','POST',profile)).status,428);
  assert.equal(calls.length,0);
  assert.equal((await api('/api/ai/settings','POST',{apiKey:'test-secret',model:'test-model'},{origin:'https://foreign.example'})).status,403);
  assert.equal((await api('/api/ai/models','POST',{apiKey:'test-secret'})).body.models[0].id,'test-model');
  assert.equal((await api('/api/ai/settings')).body.configured,false);
  fail=true;
  assert.equal((await api('/api/ai/settings','POST',{apiKey:'test-secret',model:'meta/muse-spark-1.3-contributor',verify:true})).status,403);
  assert.equal((await settings.status()).configured,false); // la comprobación opcional falló: no se guarda nada
  fail=false;
  assert.equal((await api('/api/ai/settings','POST',{apiKey:'test-secret',model:'no es un modelo'})).status,400);
  assert.equal((await settings.status()).configured,false);
  const saved=await api('/api/ai/settings','POST',{apiKey:'test-secret',model:'meta/muse-spark-1.3-contributor'});
  assert.equal(saved.body.configured,true);
  assert.equal(saved.body.verifiedAt,null); // guardar no llama al modelo
  assert.ok(!JSON.stringify(saved).includes('test-secret'));
  assert.equal((await createSettingsStore(directory).status()).configured,true);
  badPrologue=true;
  assert.equal((await api('/api/runs','POST',profile)).status,502);
  assert.equal(runs.size,0);
  badPrologue=false;
  const created=await api('/api/runs','POST',profile);
  assert.equal(created.status,201);
  assert.equal(created.body.player.locationId,'station');
  const id=created.body.id;
  const savedBeforeFailure=structuredClone(runs.get(id));
  fail=true;
  assert.equal((await api(`/api/runs/${id}/action`,'POST',{text:'Saludo a una viajera.'})).status,403);
  assert.deepEqual(runs.get(id),savedBeforeFailure);
  fail=false;
  block=true;
  const pending=api(`/api/runs/${id}/action`,'POST',{text:'Saludo a una viajera.'});
  while(!releases.length) await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal((await api(`/api/runs/${id}/action`,'POST',{type:'wait'})).status,409);
  block=false; releases.splice(0).forEach((release)=>release());
  const acted=await pending;
  assert.equal(acted.body.world.minute,10);
  assert.match(acted.body.narrative.text,/viajera/);
  assert.equal(acted.body.player.money,created.body.player.money);
  assert.ok(!JSON.stringify(acted).includes('test-secret'));
  const prompt=calls.filter(({options})=>options.body).map(({options})=>JSON.parse(options.body).messages.at(-1).content).find((content)=>content.includes('Saludo a una viajera'));
  assert.match(prompt,/Mara/); assert.match(prompt,/La estación/);
  assert.ok(calls.every(({url})=>url.startsWith(NANOGPT_BASE_URL)));
  await api('/api/ai/settings','DELETE');
  assert.equal((await api('/api/runs','POST',profile)).status,428);
  assert.equal((await api(`/api/runs/${id}/posts`,'POST',{text:'Hola ciudad.'})).status,428);
  assert.equal((await api(`/api/runs/${id}`)).status,200);
});

test('settings accept any model id, save without calling the provider and keep older files working', async (t) => {
  const directory=await mkdtemp(path.join(tmpdir(),'hom-settings-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const settings=createSettingsStore(directory);
  for (const bad of ['', 'con espacios', 'x'.repeat(201), '../../etc', 'a;b']) {
    await assert.rejects(settings.candidate({apiKey:'k',model:bad}), {code:'AI_MODEL'}, bad);
  }
  const custom=await settings.candidate({apiKey:'k',model:'anthropic/claude-sonnet-4.5:thinking'});
  assert.deepEqual(await settings.save(custom), {provider:'nanogpt',configured:true,hasKey:true,model:'anthropic/claude-sonnet-4.5:thinking',verifiedAt:null});
  assert.equal((await settings.require()).model,'anthropic/claude-sonnet-4.5:thinking');
  // Un ai.json guardado por la versión anterior (con verifiedAt) sigue siendo válido; cambiar solo el modelo conserva la key.
  await settings.save({apiKey:'k',model:'deepseek/deepseek-v4.1-flash'},{verified:true});
  assert.ok((await settings.status()).verifiedAt);
  const switched=await settings.candidate({model:'meta/muse-spark-1.3-contributor'});
  assert.equal(switched.apiKey,'k');
});

test('provider reports tokens, latency and attempts and the prompt store aggregates them per call type', async () => {
  const { createPromptStore } = await import('../src/server/ai/promptStore.js');
  const prompts=createPromptStore(await mkdtemp(path.join(tmpdir(),'hom-prompts-')));
  let first=true;
  const ai=createNanoGPT(async()=>{
    const truncated=first; first=false;
    return { ok:true, json:async()=>({ choices:[{ message:{ content:truncated?'':'{"narration":"Hola"}' }, finish_reason:truncated?'length':'stop' }], usage:{ prompt_tokens:100, completion_tokens:40, total_tokens:140, completion_tokens_details:{ reasoning_tokens:25 } } }) };
  },{prompts});
  const { text, meta }=await ai.chatDetailed({apiKey:'k',model:'m'},[{role:'user',content:'x'}],100);
  assert.equal(text,'{"narration":"Hola"}');
  assert.equal(meta.attempts,2);
  assert.deepEqual(meta.usage,{prompt:200,completion:80,total:280,reasoning:50}); // suma los dos intentos
  assert.ok(meta.ms>=0 && meta.model==='m');
  prompts.record({kind:'gm',mode:'action',messages:[],response:'x',meta});
  prompts.record({kind:'gm',mode:'action',messages:[],error:'boom',meta:{model:'m',ms:10}});
  const [row]=prompts.stats();
  assert.equal(row.calls,2); assert.equal(row.errors,1); assert.equal(row.promptTokens,200); assert.equal(row.byModel.m.calls,2);
  prompts.resetStats(); assert.deepEqual(prompts.stats(),[]);
});

test('model probe measures native tools, the JSON fallback and unsupported features per model', async () => {
  const { runProbe } = await import('../src/server/ai/probe.js');
  const reply=(message)=>({ ok:true, json:async()=>({ choices:[{ message, finish_reason:'stop' }], usage:{ prompt_tokens:50, completion_tokens:10, total_tokens:60 } }) });
  const toolCall={ id:'c1', type:'function', function:{ name:'travel', arguments:'{"place":"cafe"}' } };
  const fetchImpl=async(url,options)=>{
    const body=JSON.parse(options.body);
    if(body.model==='no-tools'&&(body.tools||body.response_format)) return { ok:false, status:400, json:async()=>({ error:{ message:'tools unsupported, key=secret-key' } }) };
    const last=body.messages.at(-1);
    if(body.tools) {
      if(last.role==='tool') return reply({ content:'Llegas a la cafetería.' });
      if(/miro quién hay/.test(last.content)) return reply({ content:null, tool_calls:[{...toolCall,function:{name:'who_is_here',arguments:'{}'}},{...toolCall,id:'c2',function:{name:'spend_time',arguments:'{"activity":"rest"}'}}] });
      return reply({ content:null, tool_calls:[toolCall] });
    }
    if(body.response_format) return reply({ content:'{"narration":"Esperas.","minutes":15}' });
    if(/travel\(place\)/.test(body.messages[0].content)) return reply({ content:'```json\n{"say":"Vas.","calls":[{"tool":"travel","args":{"place":"cafe"}}]}\n```' });
    return reply({ content:'LISTO' });
  };
  const ai=createNanoGPT(fetchImpl);
  const { results }=await runProbe(ai,{apiKey:'secret-key',model:'good'},{models:['good','no-tools']});
  const good=results[0].tests; const bad=results[1].tests;
  assert.deepEqual(good.map((item)=>item.ok),[true,true,true,true,true]);
  assert.equal(good.find((item)=>item.id==='tools').calls,2); // llamada + segunda vuelta con el resultado
  assert.equal(good.find((item)=>item.id==='tools').usage.prompt,100);
  assert.deepEqual(bad.map((item)=>item.ok),[true,true,false,false,false]); // el texto y el protocolo JSON funcionan sin tools
  assert.equal(bad.find((item)=>item.id==='tools').unsupported,true);
  assert.match(bad.find((item)=>item.id==='tools').note,/tools unsupported/);
  assert.ok(!JSON.stringify(results).includes('secret-key')); // el motivo del proveedor nunca incluye la key
  await assert.rejects(runProbe(createNanoGPT(async()=>({ok:false,status:401,json:async()=>({})})),{apiKey:'k',model:'m'}),{code:'AI_AUTH'});
});
