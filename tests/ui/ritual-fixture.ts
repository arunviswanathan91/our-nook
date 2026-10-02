import type { Page, WebSocketRoute } from '@playwright/test'
import { mockApp, userId, partnerId, coupleId } from './fixture'

export function makeRitualStore() {
  const now=()=>new Date().toISOString()
  const store={
    failSignal:false,failRead:false,
    requests:[] as {name:string;body:Record<string,any>;user:string}[],
    presence:[] as any[],signals:[] as any[],watered:[] as string[],strokes:[] as any[],hearts:[] as any[],letters:[] as any[],
    contents:new Map<string,{body:string;storage_path:string|null}>(),
    prompts:[{id:'daily-1',couple_id:coupleId,author_id:userId,kind:'daily',prompt:'What ordinary moment would you like to share today?',options:null,audio_post_id:null,day_key:'2026-10-02',answered_by:[] as string[],created_at:now(),answers:[] as any[]}],
    state:{plant_name:'Our little fern',water_count:4,touch_count:12,breathe_started_at:null as string|null,listen_post_id:null as string|null,listen_playing:false,listen_position:0,listen_updated_at:null as string|null,listen_by:null as string|null},
    subscribers:[] as {socket:WebSocketRoute;topic:string;join:string;bindings:any[]}[],
    emit(table:string){for(const s of store.subscribers){const ids=s.bindings.filter(b=>b.table===table).map(b=>b.id);if(ids.length)try{s.socket.send(JSON.stringify([s.join,null,s.topic,'postgres_changes',{ids,data:{schema:'public',table,type:'UPDATE',commit_timestamp:now(),columns:[],record:{couple_id:coupleId},old_record:{},errors:null}}]))}catch{}}},
    live(){return {server_now:now(),day_key:'2026-10-02',state:store.state,presence:store.presence,signals:store.signals,watered_by:store.watered}},
    snapshot(user:string){return {live:store.live(),daily_id:'daily-1',letters:store.letters,prompts:store.prompts.map(p=>({...p,answers:p.answers.filter(a=>a.user_id===user||p.answered_by.length===2)})),strokes:store.strokes,hearts:store.hearts}},
  }
  return store
}
export function silentWav(seconds=30){
  const data=Buffer.alloc(44+seconds*8000*2)
  data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(8000,24);data.writeUInt32LE(16000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40)
  return data
}
export async function mockRituals(page:Page,store=makeRitualStore(),asPartner=false,withMusic=false){
  const requests=await mockApp(page,{asPartner})
  const user=asPartner?partnerId:userId
  await page.routeWebSocket('wss://nook-test.supabase.co/**',socket=>{
    socket.onMessage(raw=>{
      const [join,ref,topic,event,payload]=JSON.parse(String(raw))
      if(event==='phx_join'){
        const bindings=(payload.config?.postgres_changes||[]).map((b:any,i:number)=>({...b,id:i+1}))
        store.subscribers.push({socket,topic,join,bindings})
        socket.send(JSON.stringify([join,ref,topic,'phx_reply',{status:'ok',response:{postgres_changes:bindings}}]))
      }else if(event==='heartbeat'||event==='phx_leave')socket.send(JSON.stringify([join,ref,topic,'phx_reply',{status:'ok',response:{}}]))
    })
    socket.onClose(()=>{store.subscribers=store.subscribers.filter(s=>s.socket!==socket)})
  })
  await page.route('https://nook-test.supabase.co/rest/v1/rpc/**',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1)!.replace('nook_',''),body=route.request().postDataJSON()||{}
    store.requests.push({name,body,user});let value:any=null;let changed=''
    if((name==='signal'&&store.failSignal)||(name==='rituals'&&store.failRead))return route.fulfill({status:503,json:{message:'Temporarily offline. Please try again.'}})
    if(name==='rituals')value=store.snapshot(user)
    if(name==='live_state')value=store.live()
    if(name==='ping'){
      let p=store.presence.find(p=>p.user_id===user);if(!p){p={user_id:user,seen_at:new Date().toISOString(),holding_until:null};store.presence.push(p)}
      p.seen_at=new Date().toISOString();if(body.p_hold!==undefined)p.holding_until=body.p_hold?new Date(Date.now()+8000).toISOString():null
      value={server_now:new Date().toISOString()};changed='nook_presence'
    }
    if(name==='signal'){store.signals.unshift({id:crypto.randomUUID(),author_id:user,kind:body.p_kind,created_at:new Date().toISOString()});store.state.touch_count++;changed='nook_signals'}
    if(name==='water'){if(!store.watered.includes(user)){store.watered.push(user);store.state.water_count++}changed='nook_ritual_state';value=true}
    if(name==='ritual_action'){if(body.p_action==='plant_name')store.state.plant_name=body.p_value;else store.state.breathe_started_at=body.p_action==='breathe'?new Date().toISOString():null;changed='nook_ritual_state'}
    if(name==='answer'){
      const p=store.prompts.find(p=>p.id===body.p_id)!;p.answers=p.answers.filter(a=>a.user_id!==user);p.answers.push({user_id:user,answer:body.p_answer,created_at:new Date().toISOString()});p.answered_by=[...new Set([...p.answered_by,user])];changed='nook_prompts'
    }
    if(name==='create_prompt'){value=crypto.randomUUID();store.prompts.push({id:value,couple_id:coupleId,author_id:user,kind:body.p_kind,prompt:body.p_prompt,options:body.p_options,audio_post_id:body.p_audio,day_key:null as any,answered_by:body.p_answer?[user]:[],created_at:new Date().toISOString(),answers:body.p_answer?[{user_id:user,answer:body.p_answer}]:[]});changed='nook_prompts'}
    if(name==='create_letter'){value=crypto.randomUUID();store.letters.unshift({id:value,author_id:user,title:body.p_title,kind:body.p_kind,unlock_at:body.p_unlock,created_at:new Date().toISOString(),opened_at:null,has_audio:Boolean(body.p_audio)});store.contents.set(value,{body:body.p_body,storage_path:body.p_audio});changed='nook_letters'}
    if(name==='read_letter'){const l=store.letters.find(l=>l.id===body.p_id)!;value=Date.parse(l.unlock_at)>Date.now()&&l.author_id!==user?{locked:true,unlock_at:l.unlock_at}:{locked:false,...store.contents.get(l.id)}}
    if(name==='stroke'){value=crypto.randomUUID();store.strokes.push({id:value,author_id:user,points:body.p_points,color:body.p_color,width:body.p_width,created_at:new Date().toISOString()});changed='nook_strokes'}
    if(name==='erase_strokes'){if(body.p_all)store.strokes=[];else{const last=store.strokes.findLast(s=>s.author_id===user);store.strokes=store.strokes.filter(s=>s!==last)}changed='nook_strokes'}
    if(name==='listen'){Object.assign(store.state,{listen_post_id:body.p_post,listen_playing:body.p_playing,listen_position:body.p_position,listen_updated_at:new Date().toISOString(),listen_by:user});changed='nook_ritual_state'}
    if(name==='heart'){const found=store.hearts.find(h=>h.post_id===body.p_post&&h.user_id===user);store.hearts=found?store.hearts.filter(h=>h!==found):[...store.hearts,{post_id:body.p_post,user_id:user}];changed='nook_hearts'}
    await route.fulfill({json:value});if(changed)store.emit(changed)
  })
  await page.route('https://nook-test.supabase.co/storage/v1/**',route=>{
    const path=new URL(route.request().url()).pathname
    if(path.includes('/object/sign/')&&route.request().method()==='POST')return route.fulfill({json:{signedURL:'/object/sign/nook-memories/fixture.wav?token=test'}})
    if(route.request().method()==='GET')return route.fulfill({body:silentWav(),contentType:'audio/wav'})
    return route.fulfill({json:{Key:path,Id:crypto.randomUUID()}})
  })
  if(withMusic)await page.route('https://nook-test.supabase.co/rest/v1/nook_posts*',route=>route.fulfill({json:[
    {id:'song-1',couple_id:coupleId,author_id:userId,kind:'song',body:'For our next slow Sunday.',link_url:'https://open.spotify.com/track/1rqqCSm0Qe4I9rUvWncaom',storage_path:null,metadata:{title:'Our slow Sunday',artist:'A song from my side',collection:'Sunday mornings'},created_at:new Date().toISOString()},
    {id:'voice-1',couple_id:coupleId,author_id:partnerId,kind:'voice',body:'A little goodnight.',link_url:null,storage_path:`${coupleId}/${partnerId}/fixture.wav`,metadata:{title:'Sleepy goodnight',duration:30},created_at:new Date().toISOString()},
  ]}))
  return {store,requests}
}
