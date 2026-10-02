import { test, expect } from '@playwright/test'
import { makeRitualStore, mockRituals, silentWav } from './ritual-fixture'
import { partnerId } from './fixture'

test('two accounts meet through held touches and receive signals over the realtime channel',async({page,browser})=>{
  const store=makeRitualStore();await mockRituals(page,store)
  const context=await browser.newContext();const partner=await context.newPage();await mockRituals(partner,store,true)
  await page.goto('/');await partner.goto('http://127.0.0.1:4173/')
  await expect(page.getByText('Connected',{exact:true})).toBeVisible()
  await expect(partner.getByText('Connected',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Hold to share warmth'}).focus();await page.keyboard.down('Space')
  await expect(partner.getByRole('heading',{name:'Mira is reaching for you.'})).toBeVisible()
  await partner.getByRole('button',{name:'Hold to share warmth'}).focus();await partner.keyboard.down('Space')
  await expect(page.getByRole('heading',{name:'There you are. Both of you.'})).toBeVisible()
  await page.keyboard.up('Space');await partner.keyboard.up('Space')
  await expect(page.getByRole('button',{name:'Hold to share warmth'})).toHaveAttribute('aria-pressed','false')
  await page.getByRole('button',{name:'A kiss',exact:true}).click()
  await expect(partner.locator('.touch-response')).toContainText('Mira blew a kiss.')
  expect(store.presence.every(p=>p.holding_until===null)).toBe(true)
  await context.close()
})

test('answers stay sealed until the second account replies, then reveal in both open pages',async({page,browser})=>{
  const store=makeRitualStore();await mockRituals(page,store)
  const context=await browser.newContext();const partner=await context.newPage();await mockRituals(partner,store,true)
  await page.goto('/#play');await partner.goto('http://127.0.0.1:4173/#play')
  await page.getByLabel('Your answer',{exact:true}).fill('A sunrise walk with you')
  await page.getByRole('button',{name:'Seal my answer'}).click()
  await expect(partner.getByText('Mira has answered',{exact:false})).toBeVisible()
  await expect(partner.getByText('A sunrise walk with you',{exact:true})).toHaveCount(0)
  await partner.getByLabel('Your answer',{exact:true}).fill('Making our Sunday tea')
  await partner.getByRole('button',{name:'Seal my answer'}).click()
  for(const tab of [page,partner]){
    await expect(tab.getByText('A sunrise walk with you',{exact:true})).toBeVisible()
    await expect(tab.getByText('Making our Sunday tea',{exact:true})).toBeVisible()
  }
  await context.close()
})

test('failed signals show a recoverable error without announcing delivery',async({page})=>{
  const store=makeRitualStore();store.failSignal=true;await mockRituals(page,store);await page.goto('/')
  await page.getByRole('button',{name:'A hug',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('Temporarily offline')
  await expect(page.locator('.touch-response')).not.toContainText('You sent')
  store.failSignal=false;await page.getByRole('button',{name:'A hug',exact:true}).click()
  await expect(page.locator('.touch-response')).toContainText('You sent a long-distance hug.')
})

test('sealed capsule cannot request its body until the server opening time',async({page})=>{
  const store=makeRitualStore();store.letters.push({id:'sealed-1',author_id:partnerId,title:'For our reunion',kind:'capsule',unlock_at:new Date(Date.now()+86400000).toISOString(),created_at:new Date().toISOString(),opened_at:null,has_audio:false});store.contents.set('sealed-1',{body:'A secret picnic for us',storage_path:null})
  await mockRituals(page,store);await page.goto('/#keepsakes');await page.getByRole('button',{name:'Letters & capsules'}).click()
  await expect(page.getByRole('button',{name:'Waiting for its moment'})).toBeDisabled()
  expect(store.requests.some(r=>r.name==='read_letter')).toBe(false)
  await expect(page.getByText('A secret picnic for us')).toHaveCount(0)
  store.letters[0].unlock_at=new Date(Date.now()-1000).toISOString();store.emit('nook_letters')
  await page.getByRole('button',{name:'Break the little seal'}).click()
  await expect(page.getByRole('dialog')).toContainText('A secret picnic for us')
})

test('drawing has keyboard controls, partner updates, own undo, and a confirmed clear',async({page,browser})=>{
  const store=makeRitualStore();await mockRituals(page,store)
  const context=await browser.newContext();const partner=await context.newPage();await mockRituals(partner,store,true)
  for(const tab of [page,partner]){await tab.goto('http://127.0.0.1:4173/#play');await tab.getByRole('button',{name:'Doodle together'}).click()}
  const paper=page.getByRole('application',{name:'Shared drawing paper'})
  await paper.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');await page.keyboard.press('Space')
  await expect(partner.locator('.doodle-paper polyline')).toHaveCount(1)
  await partner.getByRole('button',{name:'Add a heart',exact:true}).click()
  await expect(page.locator('.doodle-paper polyline')).toHaveCount(2)
  await page.getByRole('button',{name:'Undo my last stroke'}).click()
  await expect(partner.locator('.doodle-paper polyline')).toHaveCount(1)
  expect(store.strokes[0].author_id).toBe(partnerId)
  await page.getByRole('button',{name:'Clear our drawing'}).click()
  await expect(page.getByRole('dialog')).toContainText('both of your drawings')
  await page.getByRole('button',{name:'Clear our paper'}).click()
  await expect(partner.locator('.doodle-paper polyline')).toHaveCount(0)
  await context.close()
})

test('recording permission errors retain the audio upload fallback',async({page})=>{
  await mockRituals(page)
  await page.addInitScript(()=>{Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>Promise.reject(new DOMException('Denied','NotAllowedError'))})})
  await page.goto('/');await page.getByRole('button',{name:'A whisper',exact:true}).click()
  await page.getByRole('button',{name:'Start recording'}).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Microphone access was not allowed')
  await page.getByLabel('Or choose an audio file').setInputFiles({name:'little-hello.wav',mimeType:'audio/wav',buffer:silentWav(1)})
  await page.getByRole('button',{name:'Save to our nook'}).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('status').filter({hasText:'Saved to your nook.'})).toBeVisible()
})

test('shared recordings play and pause in both browsers after each person joins',async({page,browser})=>{
  const store=makeRitualStore();await mockRituals(page,store,false,true)
  const context=await browser.newContext();const partner=await context.newPage();await mockRituals(partner,store,true,true)
  for(const tab of [page,partner]){
    await tab.goto('http://127.0.0.1:4173/#mixtape');await tab.getByRole('button',{name:'Whispers & ambience'}).click();await tab.getByRole('button',{name:'Listen together',exact:true}).click();await tab.getByRole('button',{name:'Join & play together'}).click()
    await expect.poll(()=>tab.locator('.listening-room audio').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(false)
  }
  await page.getByRole('button',{name:'Pause for both'}).click()
  for(const tab of [page,partner])await expect.poll(()=>tab.locator('.listening-room audio').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true)
  await partner.getByRole('button',{name:'Play together',exact:true}).click()
  await expect.poll(()=>page.locator('.listening-room audio').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(false)
  await context.close()
})

test('recording blocks saving until stopped and releases the microphone when the dialog closes',async({page})=>{
  await mockRituals(page)
  await page.addInitScript(()=>{
    (window as any).stoppedTracks=0
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>({getTracks:()=>[{stop:()=>{(window as any).stoppedTracks++}}]})})
    class Recorder {
      static isTypeSupported(){return true}
      mimeType='audio/mp4';state='inactive';ondataavailable:any;onstop:any
      start(){this.state='recording'}
      stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['fixture recording'],{type:'audio/mp4'})});this.onstop?.()})}
    }
    Object.defineProperty(window,'MediaRecorder',{value:Recorder})
  })
  await page.goto('/');await page.getByRole('button',{name:'A whisper',exact:true}).click()
  await page.getByRole('button',{name:'Start recording'}).click()
  await expect(page.getByRole('button',{name:'Stop recording'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Save to our nook'})).toBeDisabled()
  await page.getByRole('button',{name:'Close',exact:true}).click()
  expect(await page.evaluate(()=>(window as any).stoppedTracks)).toBeGreaterThan(0)
  await page.getByRole('button',{name:'A whisper',exact:true}).click()
  await page.getByRole('button',{name:'Start recording'}).click();await page.getByRole('button',{name:'Stop recording'}).click()
  await expect(page.getByRole('button',{name:'Save to our nook'})).toBeEnabled()
  await expect(page.getByText('a-little-whisper.m4a',{exact:true})).toBeVisible()
})

test('settings persist haptics, quiet mode and shared time zones; reduced motion stays readable',async({page})=>{
  const {requests}=await mockRituals(page)
  await page.addInitScript(()=>{(window as any).pulses=[];Object.defineProperty(navigator,'vibrate',{value:(p:unknown)=>{(window as any).pulses.push(p);return true}})})
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#settings')
  await page.getByLabel('Gentle haptics',{exact:true}).uncheck();await page.getByLabel('Quiet mode',{exact:true}).check()
  await page.getByLabel('Pronouns (optional)',{exact:true}).fill('she/her')
  await page.getByRole('button',{name:'Save my settings'}).click()
  await expect(page.getByRole('status').filter({hasText:'Your corner is updated.'})).toBeVisible()
  expect(requests.some(r=>r.body.haptics===false&&r.body.quiet_mode===true&&r.body.pronouns==='she/her')).toBe(true)
  await page.getByLabel('Our shared day').fill('Asia/Singapore')
  await page.getByRole('button',{name:'Save shared settings'}).click()
  await expect(page.getByRole('status').filter({hasText:'Your shared space is updated.'})).toBeVisible()
  expect(requests.some(r=>r.body.ritual_timezone==='Asia/Singapore')).toBe(true)
  await page.evaluate(()=>{(window as any).pulses=[]})
  await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('button',{name:'Together',exact:true}).click()
  await page.getByRole('button',{name:'A tiny tap',exact:true}).click()
  expect(await page.evaluate(()=>(window as any).pulses.filter((p:unknown)=>p!==0))).toEqual([])
  await expect(page.getByText('Resting quietly',{exact:true})).toBeVisible()
  await expect(page.locator('.touch-orbit')).toBeVisible()
})

test('all Dearest screens fit narrow phones and produce review screenshots',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await mockRituals(page,undefined,false,true);await page.goto('/')
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1000})
    for(const [id,name] of [['today','Together'],['keepsakes','Scrapbook'],['mixtape','Mixtape'],['play','Parlour']]){
      await page.goto('/#'+id);await expect(page.locator('h1')).toBeVisible()
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} ${width}px`).toBe(true)
      if(width!==320)await page.screenshot({path:info.outputPath(`dearest-${id}-${width}.png`),fullPage:true})
      if(id==='play')for(const activity of ['Little games','Doodle together','Surprises']){await page.getByRole('button',{name:activity,exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${activity} ${width}px`).toBe(true)}
    }
  }
  expect(errors).toEqual([])
})
