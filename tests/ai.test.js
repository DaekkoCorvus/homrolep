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
  let fail=false, badPrologue=false, release=null, block=false;
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
    if(block) await new Promise(resolve=>{release=resolve;});
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
  assert.equal((await api('/api/ai/settings','POST',{apiKey:'test-secret',model:'meta/muse-spark-1.3-contributor'})).status,403);
  assert.equal((await settings.status()).configured,false);
  fail=false;
  const saved=await api('/api/ai/settings','POST',{apiKey:'test-secret',model:'meta/muse-spark-1.3-contributor'});
  assert.equal(saved.body.configured,true);
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
  while(!release) await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal((await api(`/api/runs/${id}/action`,'POST',{type:'wait'})).status,409);
  release(); block=false;
  const acted=await pending;
  assert.equal(acted.body.world.minute,10);
  assert.match(acted.body.narrative.text,/viajera/);
  assert.equal(acted.body.player.money,created.body.player.money);
  assert.ok(!JSON.stringify(acted).includes('test-secret'));
  const prompt=JSON.parse(calls.at(-1).options.body).messages.at(-1).content;
  assert.match(prompt,/Mara/); assert.match(prompt,/La estación/);
  assert.ok(calls.every(({url})=>url.startsWith(NANOGPT_BASE_URL)));
  await api('/api/ai/settings','DELETE');
  assert.equal((await api('/api/runs','POST',profile)).status,428);
  assert.equal((await api(`/api/runs/${id}/posts`,'POST',{text:'Hola ciudad.'})).status,428);
  assert.equal((await api(`/api/runs/${id}`)).status,200);
});
