const api=window.PresentStudioApi, $=s=>document.querySelector(s);
const presentationId=new URLSearchParams(location.search).get("id")||"pres_demo";
const authToken=localStorage.getItem("presentStudio.accessToken")||"", socket=window.io?window.io():null;
let presentation,currentSlideIndex=0,canvas,saveTimer,shareUrl="",screenShareUrl="",audienceShareUrl="",loading=false,mediaAssets=[],selectedPresenter="Self",uploadRequestId=0,retryUploadFile=null;
const W=1280,H=720;
let editRevision=0,savePromise=null,saveConflict=false,imageRestoreProblem="",pendingInsertions=0;
let unavailableSavedImages=[];
let autosaveRequested=false;
function secureAppUrl(path){const url=new URL(path,location.origin);if(!["localhost","127.0.0.1","::1"].includes(url.hostname))url.protocol="https:";return url.href}
function toast(m){const n=$("#toast");n.textContent=m;n.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>n.classList.remove("show"),2600)}
function setShareLink(url,permission,screenUrl="",audienceUrl=""){shareUrl=url||"";screenShareUrl=screenUrl||"";audienceShareUrl=audienceUrl||"";const isPresenter=permission==="presenter",button=$("#openShareLink"),copyScreenButton=$("#copyScreenLink"),screenStatus=$("#screenShareStatus"),copyAudienceButton=$("#copyAudienceLink"),audienceStatus=$("#audienceShareStatus");$("#shareStatus").textContent=shareUrl?(isPresenter?`Remote Control: ${shareUrl}`:`Presentation Screen: ${shareUrl}`):"";button.disabled=!shareUrl;button.querySelector("span").textContent=shareUrl?(isPresenter?"Open Remote Control":"Open Presentation Screen"):"Open Link";button.setAttribute("aria-label",shareUrl?`Open ${isPresenter?"Remote Control":"Presentation Screen"} link in a new tab`:"Open generated link in a new tab");if(screenStatus)screenStatus.textContent=screenShareUrl?`Locked Screen: ${screenShareUrl}`:"";if(copyScreenButton)copyScreenButton.disabled=!screenShareUrl;if(audienceStatus)audienceStatus.textContent=audienceShareUrl?`Interactive Audience: ${audienceShareUrl}`:"";if(copyAudienceButton)copyAudienceButton.disabled=!audienceShareUrl}
function setShareError(message){setShareLink("","");$("#shareStatus").textContent=message}
function activeSlide(){return presentation.slides[currentSlideIndex]}
function ensure(s){s.canvas||={background:"#f8f4ea",elements:[]};s.canvas.elements||=[];s.canvas.transition||={type:"fade",duration_ms:500};if(!s.canvas.fabric&&!s.canvas.elements.some(x=>x.type==="text"))s.canvas.elements.push({id:"title",type:"text",text:s.title||"Untitled slide",x:18,y:30,width:64,fontSize:56,fontWeight:"600",color:"#171717",textAlign:"center"},{id:"subtitle",type:"text",text:"",x:18,y:52,width:64,fontSize:24,fontWeight:"600",color:"#171717",textAlign:"center"});return s}
function playback(){const s=ensure(presentation.slides[0]);return s.canvas.presentation_playback||=( {mode:"manual",interval_ms:5000,slide_ids:[],media_mode:"all",media_cycle:"all",media_interval_ms:5000,loop_videos:true})}
function text(item){return new fabric.Textbox(item.text||"",{id:item.id,left:(item.x||0)*12.8,top:(item.y||0)*7.2,width:(item.width||40)*12.8,fontSize:item.fontSize||42,fontWeight:item.fontWeight||"500",fontStyle:item.fontStyle||"normal",fontFamily:item.fontFamily||"Arial",fill:item.color||"#171717",textAlign:item.textAlign||"left"})}
function video(item){const fitToSlide=item.fitToSlide===true;return new fabric.Rect({id:item.id,left:item.full_bleed||fitToSlide?0:(item.x||0)*12.8,top:item.full_bleed||fitToSlide?0:(item.y||0)*7.2,width:item.full_bleed||fitToSlide?W:(item.width||40)*12.8,height:item.full_bleed||fitToSlide?H:(item.height||30)*7.2,fill:"#1c1a16",stroke:item.full_bleed||fitToSlide?null:"#d1a948",strokeWidth:item.full_bleed||fitToSlide?0:4,rx:item.full_bleed||fitToSlide?0:8,ry:item.full_bleed||fitToSlide?0:8,mediaType:"video",src:item.src,full_bleed:item.full_bleed===true,loop:item.loop,muted:item.muted===true,fit:item.fit||(item.full_bleed?"fill":"contain")})}
function image(item, targetSlideId=activeSlide()?.id){
  const targetCanvas=canvas, wasLoading=loading;
  pendingInsertions++;
  fabric.Image.fromURL(item.src,o=>{
    pendingInsertions=Math.max(0,pendingInsertions-1);
    if(!o||!o.width||!o.height){
      toast("This image could not load. Check the media link or upload it again.");
      resumeAutosave();
      return;
    }
    if(targetCanvas!==canvas||!presentation.slides.some(slide=>slide.id===targetSlideId)){resumeAutosave();return;}
    o.set({id:item.id,mediaType:"image",src:item.src,thumbnailSrc:item.thumbnailSrc||"",audioSrc:item.audioSrc||"",audioName:item.audioName||"",full_bleed:item.full_bleed===true,loop:item.loop,muted:item.muted===true,fit:item.fit||(item.full_bleed?"fill":"contain"),left:(item.x||0)*12.8,top:(item.y||0)*7.2});
    if(item.fitToSlide){const scale=Math.min(W/o.width,H/o.height);o.set({scaleX:scale,scaleY:scale,left:(W-o.width*scale)/2,top:(H-o.height*scale)/2})}
    else if(item.full_bleed)o.set({scaleX:W/o.width,scaleY:H/o.height,left:0,top:0});
    else{o.scaleToWidth((item.width||40)*12.8);if(o.getScaledHeight()>(item.height||30)*7.2)o.scaleToHeight((item.height||30)*7.2)}
    if(targetSlideId!==activeSlide()?.id){
      const target=ensure(presentation.slides.find(slide=>slide.id===targetSlideId));
      if(target.canvas.fabric){
        const objects=target.canvas.fabric.objects||=[];
        const saved=o.toObject(["id","mediaType","src","thumbnailSrc","audioSrc","audioName","full_bleed","loop","muted","fit"]);
        if(item.full_bleed||item.fitToSlide)objects.unshift(saved);else objects.push(saved);
      }else target.canvas.elements.push({...item,x:o.left/12.8,y:o.top/7.2,width:o.getScaledWidth()/12.8,height:o.getScaledHeight()/7.2});
      schedule();
      renderList();return;
    }
    canvas.add(o);if(item.full_bleed||item.fitToSlide)canvas.sendToBack(o);o.setCoords();canvas.requestRenderAll();
    if(!loading){canvas.setActiveObject(o);panel();schedule()}
  },{crossOrigin:"anonymous"})
}
function capture(){if(!presentation||loading||pendingInsertions)return;const s=ensure(activeSlide());s.canvas.background=canvas.backgroundColor||"#f8f4ea";s.canvas.fabric=canvas.toJSON(["id","mediaType","src","youtubeId","thumbnailUrl","audioSrc","audioName","full_bleed","loop","muted","fit","hyperlink","animation","animationDuration","animationDelay","wordArt","wordArtPreset","shapeRequestedFontSize","shapeText","paragraphAlignments","shapeKind","frameKind","flowchartKind","diagramKind","chartKind","componentType","componentRole","componentIndex","componentName","visualParentId","visualTheme","diagramTheme","chartData","chartStyle","editableComponent"]);if(unavailableSavedImages.length){const objects=s.canvas.fabric.objects||[];for(const entry of unavailableSavedImages){const index=Math.min(entry.index,objects.length);objects.splice(index,0,JSON.parse(JSON.stringify(entry.object)));}}const title=canvas.getObjects().find(o=>o.id==="title");if(title&&title.text.trim())s.title=title.text.trim()}
let slideLoadVersion=0;
const prefetchedSlideImages=new Map();
function prefetchAdjacentImages(){
  for(const index of [currentSlideIndex-1,currentSlideIndex+1]){
    const slide=presentation.slides[index];
    if(!slide)continue;
    const walk=value=>{
      if(Array.isArray(value)){value.forEach(walk);return}
      if(!value||typeof value!=="object")return;
      if((value.mediaType||value.type)==="image"&&value.src&&!prefetchedSlideImages.has(value.src)){
        const image=new Image();image.crossOrigin="anonymous";image.src=value.src;
        prefetchedSlideImages.set(value.src,image);
        if(prefetchedSlideImages.size>16)prefetchedSlideImages.delete(prefetchedSlideImages.keys().next().value);
      }
      Object.values(value).filter(child=>child&&typeof child==="object").forEach(walk);
    };walk(slide.canvas.fabric||slide.canvas.elements);
  }
}
function imageIdentity(object){return object?.id||object?.src||""}
function isSavedImage(object){return object?.type==="image"||object?.mediaType==="image"}
function validateRestoredImages(savedObjects,loadedObjects){
  const actual=new Map();
  for(const object of loadedObjects)if(isSavedImage(object)){
    const key=imageIdentity(object);actual.set(key,(actual.get(key)||0)+1);
  }
  const missing=[];
  for(const object of savedObjects)if(isSavedImage(object)){
    const key=imageIdentity(object),count=actual.get(key)||0;
    if(count>0)actual.set(key,count-1);else missing.push(key||"(unnamed image)");
  }
  return missing;
}
function load(){
  loading=true;imageRestoreProblem="";unavailableSavedImages=[];
  const version=++slideLoadVersion,targetSlideId=activeSlide().id,d=ensure(activeSlide()).canvas;
  const finish=(objects,expected)=>{
    if(version!==slideLoadVersion||targetSlideId!==activeSlide()?.id)return;
    const missing=validateRestoredImages(expected,objects);
    if(missing.length){
      const available=new Map();for(const object of objects)if(isSavedImage(object)){const key=imageIdentity(object);available.set(key,(available.get(key)||0)+1)}
      unavailableSavedImages=expected.flatMap((object,index)=>{if(!isSavedImage(object))return [];const key=imageIdentity(object),count=available.get(key)||0;if(count){available.set(key,count-1);return []}return [{index,object:JSON.parse(JSON.stringify(object))}]});
      imageRestoreProblem=`${missing.length} older image(s) could not load. Their saved references will be preserved while you edit.`;
      $("#modeLabel").textContent="Older images unavailable — edits can be saved";
      $("#modeLabel").title="Retry loading this slide without overwriting its saved images";
      $("#modeLabel").onclick=()=>{if(!loading&&imageRestoreProblem){capture();load()}};
      toast(imageRestoreProblem);
    }else{
      unavailableSavedImages=[];
      $("#modeLabel").onclick=null;
      $("#modeLabel").title="";
      $("#modeLabel").textContent="Images restored";
    }
    canvas.clear();canvas.backgroundColor=d.background||"#f8f4ea";
    canvas.add(...objects);canvas.renderAll();loading=false;panel();prefetchAdjacentImages();resumeAutosave();
  };
  if(d.fabric){
    // Decode offscreen. Retry transient decode/network failures without changing saved JSON.
    const restore=(attempt=0)=>{
      if(version!==slideLoadVersion||targetSlideId!==activeSlide()?.id)return;
      const staging=new fabric.StaticCanvas(null,{width:W,height:H,renderOnAddRemove:false});
      staging.loadFromJSON(d.fabric,()=>{
        const objects=staging.getObjects().slice();objects.forEach(object=>staging.remove(object));
        staging.dispose();
        if(validateRestoredImages(d.fabric.objects||[],objects).length&&attempt<2){
          setTimeout(()=>restore(attempt+1),350*(attempt+1));
          return;
        }
        finish(objects,d.fabric.objects||[]);
      });
    };
    restore();
  }else{
    const pending=d.elements.map(item=>{
      if(item.type==="text")return Promise.resolve(text(item));
      if(item.type==="video")return Promise.resolve(video(item));
      if(item.type!=="image")return Promise.resolve(null);
      return new Promise(resolve=>fabric.Image.fromURL(item.src,object=>{
        if(!object||!object.width||!object.height){resolve(null);return}
        object.set({...item,mediaType:"image",left:(item.x||0)*12.8,top:(item.y||0)*7.2});
        if(item.full_bleed)object.set({scaleX:W/object.width,scaleY:H/object.height,left:0,top:0});
        else{object.scaleToWidth((item.width||40)*12.8);if(object.getScaledHeight()>(item.height||30)*7.2)object.scaleToHeight((item.height||30)*7.2)}
        resolve(object);
      },{crossOrigin:"anonymous"}));
    });
    Promise.all(pending).then(objects=>finish(objects.filter(Boolean),d.elements));
  }
}
function esc(v){return String(v||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function renderUploadStatus(state,message){const status=$("#uploadStatus"),icons={success:"✓",error:"!",info:"•"};status.className="upload-status "+(state?"is-"+state:"");status.setAttribute("aria-busy",String(state==="uploading"));status.innerHTML='<span class="upload-status-line"><span class="upload-state-icon" aria-hidden="true">'+(icons[state]||"")+'</span><span class="upload-status-message">'+esc(message)+"</span>"+(state==="error"?'<button class="upload-retry" type="button">Retry</button>':"")+"</span>"+(state==="uploading"?'<span class="upload-progress" aria-hidden="true"><span class="upload-progress-bar"></span></span>':"");const retry=status.querySelector(".upload-retry");if(retry)retry.onclick=()=>{if(retryUploadFile)uploadFile(retryUploadFile)}}
function active(){return canvas.getActiveObject()}
function showHomeRibbon(){document.querySelectorAll("[data-builder-tab]").forEach(b=>b.classList.toggle("is-active",b.dataset.builderTab==="home"));document.querySelectorAll("[data-ribbon-panel]").forEach(p=>{const on=p.dataset.ribbonPanel==="home";p.hidden=!on;p.classList.toggle("is-active",on)})}function panel(){const o=active(),ok=o&&["textbox","text","i-text"].includes(o.type),isImage=["image","video","youtube"].includes(o?.mediaType);const editorPanel=$("#editorPanel");if(editorPanel)editorPanel.hidden=!ok;$("#imageAudioPanel").hidden=o?.mediaType!=="image";if(isImage){const fitButton=document.querySelector("[data-builder-action=fit-media]");if(fitButton)fitButton.classList.add("is-active")}else document.querySelector("[data-builder-action=fit-media]")?.classList.remove("is-active");document.querySelectorAll("[data-animation]").forEach(b=>b.classList.toggle("is-active",b.dataset.animation===(o?.animation||"none")));const animDuration=$("#animationDuration"),animDelay=$("#animationDelay");if(animDuration)animDuration.value=o?.animationDuration||600;if(animDelay)animDelay.value=o?.animationDelay||0;if(o?.mediaType==="image"){const audio=mediaAssets.filter(a=>a.mimeType.startsWith("audio/"));$("#imageAudio").innerHTML='<option value="">No linked audio</option>'+audio.map(a=>'<option value="'+esc(a.url)+'">'+esc(a.name)+"</option>").join("");$("#imageAudio").value=o.audioSrc||""}if(!ok)return;const selectedSize=selectedTextStyle(o,"fontSize"),selectedFill=selectedTextStyle(o,"fill"),selectedWeight=selectedTextStyle(o,"fontWeight"),selectedItalic=selectedTextStyle(o,"fontStyle");$("#selectionNote").textContent=o.id==="title"?"Title":o.id==="subtitle"?"Subtitle":"Text";$("#fontSize").value=Math.round(selectedSize||o.fontSize||32);$("#textColor").value=selectedFill||o.fill||"#171717";$("#boldButton").classList.toggle("active",String(selectedWeight)==="bold"||Number(selectedWeight)>=700);$("#italicButton").classList.toggle("active",selectedItalic==="italic");setTimeout(()=>editorPanel?.scrollIntoView({block:"nearest",inline:"center",behavior:"smooth"}),0)}
function renderList(){$("#slideList").innerHTML=presentation.slides.map((s,i)=>'<button class="slide-item '+(i===currentSlideIndex?"active":"")+'" type="button" data-index="'+i+'">'+esc(s.title||"Untitled slide")+"</button>").join("");$("#slideList").querySelectorAll("[data-index]").forEach(b=>b.onclick=()=>{capture();currentSlideIndex=Number(b.dataset.index);render()})}
function mediaLibrary(){const countEl=$("#mediaCount"),gridEl=$("#mediaLibraryGrid");if(!countEl||!gridEl)return;const signature=mediaAssets.map(a=>a.id+":"+a.url).join("|");if(gridEl.dataset.assetSignature===signature)return;gridEl.dataset.assetSignature=signature;countEl.textContent=mediaAssets.length+" item"+(mediaAssets.length===1?"":"s");gridEl.innerHTML=mediaAssets.map(a=>'<button class="media-library-item" type="button" data-asset="'+a.id+'">'+(a.mimeType.startsWith("image/")?'<img src="'+a.url+'" alt="">':'<span class="media-type-icon">'+(a.mimeType.startsWith("audio/")?"♫":"▷")+'</span>')+"<span>"+esc(a.name)+"</span></button>").join("");gridEl.querySelectorAll("[data-asset]").forEach(b=>b.onclick=()=>addAsset(mediaAssets.find(a=>a.id===b.dataset.asset)))}
function syncPlayback(){const c=playback();$("#playbackMode").value=c.mode;$("#playbackInterval").value=c.interval_ms;$("#mediaMode").value=c.media_mode;$("#mediaCycle").value=c.media_cycle||"all";$("#mediaInterval").value=c.media_interval_ms||5000;$("#loopVideos").checked=c.loop_videos!==false;$("#playbackSlides").innerHTML=presentation.slides.map((s,i)=>'<label><input type="checkbox" data-play-slide="'+s.id+'" '+(c.slide_ids.includes(s.id)?"checked":"")+"> "+(i+1)+". "+esc(s.title)+"</label>").join("");$("#playbackSlides").querySelectorAll("[data-play-slide]").forEach(b=>b.onchange=()=>{c.slide_ids=[...$("#playbackSlides").querySelectorAll("[data-play-slide]:checked")].map(x=>x.dataset.playSlide);schedule()})}
function render(){const s=ensure(activeSlide()),count=String(currentSlideIndex+1).padStart(2,"0")+" / "+String(presentation.slides.length).padStart(2,"0");$("#presentationTitle").textContent=presentation.title;$("#slideCount").textContent=count;$("#canvasIndex").textContent=count;$("#pageLabel").textContent="Slide "+(currentSlideIndex+1)+" of "+presentation.slides.length;$("#transitionType").value=s.canvas.transition.type;const transitionDuration=s.canvas.transition.duration_ms||500;$("#transitionDuration").value=String(transitionDuration);const customDuration=$("#transitionDurationCustom");if(customDuration)customDuration.value=transitionDuration;renderList();mediaLibrary();syncPlayback();const bgInput=$("#slideBackground");if(bgInput)bgInput.value=s.canvas.background||"#f8f4ea";load()}
function normalize(){presentation.slides.forEach((s,i)=>s.order=i+1)}
function applySavedImageReferences(before,after){
  const refs=new Map();
  const pair=(a,b)=>{
    if(!a||!b||typeof a!=="object"||typeof b!=="object")return;
    if(typeof a.src==="string"&&a.src.startsWith("data:image/")&&b.src&&!b.src.startsWith("data:"))refs.set(a.src,{src:b.src,thumbnailSrc:b.thumbnailSrc||""});
    Object.keys(a).forEach(key=>pair(a[key],b[key]));
  };pair(before,after);
  if(!refs.size)return;
  const update=(value,isFabric=false)=>{
    if(!value||typeof value!=="object")return;
    const match=refs.get(value.src)||refs.get(value.getSrc?.());
    if(match){if(value.set)value.set(match);else Object.assign(value,match)}
    const children=isFabric?(value.getObjects?.()||[]):Object.values(value).filter(child=>child&&typeof child==="object");
    children.forEach(child=>update(child,isFabric));
  };
  presentation.slides.forEach(slide=>update(slide.canvas));
  canvas.getObjects().forEach(object=>update(object,true));
}
async function save(){
  clearTimeout(saveTimer);
  if(loading||pendingInsertions)return Promise.reject(new Error("Images are still loading. Wait before saving."));
  
  if(saveConflict)throw new Error("Download your unsaved copy, then reload the saved version.");
  if(savePromise)return savePromise.then(()=>save());
  autosaveRequested=false;
  capture();normalize();
  const revision=editRevision;
  const snapshot=JSON.parse(JSON.stringify(presentation));
  $("#modeLabel").textContent="Saving…";
  savePromise=(async()=>{
    try{
      const r=await api.savePresentation(snapshot);
      // A slow response must never overwrite edits made while saving.
      if(editRevision===revision){presentation=r.presentation;presentation.slides.forEach(ensure);playback()}
      // Keep the server version even when local edits arrived during this save.
      presentation.updatedAt=r.presentation.updatedAt;
      applySavedImageReferences(snapshot,r.presentation);
      $("#modeLabel").textContent=editRevision===revision?"Saved":"Unsaved changes";
    }catch(e){
      if(e.status===409||e.status===428){saveConflict=true;clearTimeout(saveTimer);showSaveConflict()}
      $("#modeLabel").textContent=saveConflict?"Save conflict — local work kept":"Save failed";toast(e.message);throw e
    }
    finally{savePromise=null}
  })();
  return savePromise;
}
function showSaveConflict(){
  if(document.getElementById("saveConflict"))return;
  const panel=document.createElement("div");panel.id="saveConflict";panel.setAttribute("role","alert");
  panel.style.cssText="position:fixed;bottom:20px;left:20px;right:20px;z-index:10000;background:#fff;color:#171717;padding:20px;border:2px solid #b45309";
  const message=document.createElement("p");message.textContent="Another editor saved this presentation. Your local work is kept here. Download a copy before reloading; reloading discards unsaved edits.";
  const download=document.createElement("button");download.textContent="Download unsaved copy";download.onclick=()=>{
    capture();normalize();const url=URL.createObjectURL(new Blob([JSON.stringify(presentation,null,2)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download="presentation-unsaved.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const reload=document.createElement("button");reload.textContent="Reload saved version";reload.onclick=()=>{if(window.confirm("Reload and discard unsaved local edits? Download your copy first."))location.reload()};
  panel.append(message,download,reload);document.body.append(panel);
}
function resumeAutosave(){
  if(!autosaveRequested||loading||pendingInsertions||saveConflict)return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    if(loading||pendingInsertions)return;
    autosaveRequested=false;
    save().catch(()=>{});
  },600);
}
function schedule(){
  if(saveConflict)return;
  editRevision++;
  autosaveRequested=true;
  $("#modeLabel").textContent="Unsaved changes";
  clearTimeout(saveTimer);
  resumeAutosave();
}
function move(n){capture();currentSlideIndex=(currentSlideIndex+n+presentation.slides.length)%presentation.slides.length;render()} function addSlide(){capture();presentation.slides.splice(currentSlideIndex+1,0,ensure({id:"slide_"+Date.now(),order:0,title:"Slide "+(presentation.slides.length+1),canvas:{background:"#f8f4ea",elements:[]}}));currentSlideIndex++;normalize();render();schedule()} function duplicateSlide(){capture();const s=JSON.parse(JSON.stringify(activeSlide()));s.id="slide_"+Date.now();s.title+=" copy";presentation.slides.splice(currentSlideIndex+1,0,s);currentSlideIndex++;normalize();render();schedule()} function deleteSlide(){if(presentation.slides.length===1)return toast("A presentation needs at least one slide.");capture();const r=presentation.slides.splice(currentSlideIndex,1)[0];playback().slide_ids=playback().slide_ids.filter(id=>id!==r.id);currentSlideIndex=Math.min(currentSlideIndex,presentation.slides.length-1);render();schedule()}
function addAsset(a,announce=true){if(!a)return;if(a.mimeType.startsWith("audio/")){if(announce)renderUploadStatus("info",a.name+" is ready to link to an image.");panel();return}const x={id:"media_"+Date.now(),type:a.mimeType.startsWith("image/")?"image":"video",src:a.url,thumbnailSrc:a.thumbnailUrl||"",x:0,y:0,width:100,height:100,full_bleed:false,fitToSlide:true,loop:$("#loopVideos").checked,muted:false,fit:"contain"};if(x.type==="image")image(x);else{const o=video(x);canvas.add(o);canvas.sendToBack(o);canvas.setActiveObject(o)}canvas.requestRenderAll();if(announce)renderUploadStatus("info",a.name+" fitted to the slide without cropping.");schedule()}
async function uploadFile(f){const targetSlideId=activeSlide()?.id;const requestId=++uploadRequestId;retryUploadFile=null;renderUploadStatus("uploading","Uploading… "+f.name);try{const r=await api.uploadMedia(f);mediaAssets.unshift(r.asset);
if(r.asset.mimeType.startsWith("image/"))image({id:"media_"+Date.now(),type:"image",src:r.asset.url,thumbnailSrc:r.asset.thumbnailUrl||"",x:0,y:0,width:100,height:100,fitToSlide:true,fit:"contain"},targetSlideId);
else if(targetSlideId===activeSlide()?.id)addAsset(r.asset,false);
else toast("Media uploaded. Select it from the library to add it to a slide.");
mediaLibrary();if(requestId===uploadRequestId)renderUploadStatus("success",f.name+" uploaded successfully.")}catch(err){if(requestId!==uploadRequestId)return;retryUploadFile=f;const message=err.message.includes("Cloudinary")?"Media storage is not configured on this server.":err.message;renderUploadStatus("error",message)}}
async function upload(e){const f=e.target.files[0];e.target.value="";if(!f)return;if(f.size>100*1024*1024){renderUploadStatus("error",f.name+" is too large. Maximum upload size is 100 MB.");return toast("Maximum upload size is 100 MB.");}if(!/^(image|video|audio)\//.test(f.type)&&!f.name.toLowerCase().endsWith(".mp3"))return toast("Choose an image, video, or audio file.");await uploadFile(f)}
function action(type){const o=active();if(!o)return toast("Select an element on the slide first.");if(type==="forward")canvas.bringForward(o);if(type==="backward")canvas.sendBackwards(o);if(type==="delete")canvas.remove(o);if(type==="duplicate")o.clone(c=>{c.set({left:(o.left||0)+32,top:(o.top||0)+32,id:(o.id||"element")+"_"+Date.now()});canvas.add(c);canvas.setActiveObject(c)});canvas.requestRenderAll();panel();schedule()}
function selectedTextStyle(o,key){if(!o)return undefined;if(o.isEditing&&o.selectionStart!==o.selectionEnd){const styles=o.getSelectionStyles(o.selectionStart,o.selectionEnd,true);const value=styles.find(style=>style[key]!==undefined)?.[key];if(value!==undefined)return value}return o[key]}
function format(ch){const o=active();if(!o||!["textbox","text","i-text"].includes(o.type))return toast("Select a text element to format it.");if(o.isEditing&&o.selectionStart!==o.selectionEnd)o.setSelectionStyles(ch,o.selectionStart,o.selectionEnd);else o.set(ch);o.dirty=true;o.initDimensions?.();o.setCoords();canvas.requestRenderAll();panel();schedule()}
function fitMediaToSlide(){const o=active();if(!o||!["image","video","youtube"].includes(o.mediaType))return toast("Select an image or video first.");o.set({angle:0,full_bleed:false,fit:"contain"});if(o.mediaType==="image"&&o.width&&o.height){const scale=Math.min(W/o.width,H/o.height);o.set({scaleX:scale,scaleY:scale,left:(W-o.width*scale)/2,top:(H-o.height*scale)/2})}else o.set({left:0,top:0,width:W,height:H,scaleX:1,scaleY:1,stroke:null,strokeWidth:0,rx:0,ry:0});canvas.sendToBack(o);o.setCoords();canvas.requestRenderAll();panel();schedule();toast("Media fitted to the slide without cropping.")}
function selectPresenter(name){if(!["Self","Partner"].includes(name))return;selectedPresenter=name;document.querySelectorAll(".presenter-option").forEach(button=>{const active=button.dataset.presenter===name;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active))})}
function requestScreenAccessCode(){const input=$("#shareScreenCode");const row=$("#shareScreenCodeRow");if(input){row.hidden=false;const code=input.value.trim();if(/^\d{4}$/.test(code))return code;input.focus();toast("Enter exactly four digits for the screen code.");return null}while(true){const value=prompt("Enter a 4-digit code for the presentation screen.");if(value===null)return null;const code=value.trim();if(/^\d{4}$/.test(code))return code;toast("Enter exactly four digits for the screen code.")}}
function syncShareCodeInput(){const row=$("#shareScreenCodeRow"),input=$("#shareScreenCode");if(!row||!input)return;row.hidden=false;input.required=true}
async function start(){if(selectedPresenter==="Partner"){const screenCode=requestScreenAccessCode();if(screenCode===null)return;const partnerWindow=window.open("about:blank","_blank");if(partnerWindow)partnerWindow.opener=null;try{await save();const r=await api.createShareLink(presentation.id,"presenter",screenCode);$("#sharePermission").value="presenter";setShareLink(r.url,r.permission,r.screenUrl||"",r.audienceUrl||"");if(partnerWindow)partnerWindow.location.replace(r.url);else toast("Partner link created. Allow pop-ups or use Copy Link.")}catch(e){partnerWindow?.close();setShareError(e.message);toast(e.message)}return}try{await save();window.open(secureAppUrl("/controller.html?id="+encodeURIComponent(presentation.id)),"_blank","noopener")}catch{}}
function bind(){canvas.on("selection:created",panel);canvas.on("selection:updated",panel);canvas.on("selection:cleared",panel);canvas.on("object:modified",schedule);canvas.on("text:changed",schedule);$("#fontSize").oninput=e=>format({fontSize:+e.target.value});$("#textColor").oninput=e=>format({fill:e.target.value});$("#fontFamily").onchange=e=>format({fontFamily:e.target.value});if(!$("#boldButton").dataset.builderAction)$("#boldButton").onclick=()=>format({fontWeight:(String(selectedTextStyle(active(),"fontWeight"))==="bold"||Number(selectedTextStyle(active(),"fontWeight"))>=700)?"normal":"bold"});if(!$("#italicButton").dataset.builderAction)$("#italicButton").onclick=()=>format({fontStyle:selectedTextStyle(active(),"fontStyle")==="italic"?"normal":"italic"});document.querySelectorAll("[data-align]").forEach(b=>b.onclick=()=>format({textAlign:b.dataset.align}));
$("#imageAudio").onchange=e=>{const o=active();if(o?.mediaType!=="image")return;const asset=mediaAssets.find(a=>a.url===e.target.value);o.set({audioSrc:asset?.url||"",audioName:asset?.name||""});schedule();$("#uploadStatus").textContent=asset?asset.name+" linked to the selected image.":"Linked audio removed."};
$("#transitionType").onchange=e=>{ensure(activeSlide()).canvas.transition.type=e.target.value;schedule()};function setTransitionDuration(value){const duration=Math.max(50,Math.min(10000,Number(value)||500));ensure(activeSlide()).canvas.transition.duration_ms=duration;const custom=$("#transitionDurationCustom");if(custom)custom.value=duration;schedule()}$("#transitionDuration").onchange=e=>setTransitionDuration(e.target.value);const transitionDurationCustom=$("#transitionDurationCustom");if(transitionDurationCustom)transitionDurationCustom.oninput=e=>setTransitionDuration(e.target.value);function setAnimationTiming(){const o=active();if(!o||o.type==="activeSelection")return;o.set({animationDuration:Math.max(100,Math.min(5000,Number($("#animationDuration")?.value)||600)),animationDelay:Math.max(0,Math.min(5000,Number($("#animationDelay")?.value)||0))});schedule()}const animationDuration=$("#animationDuration"),animationDelay=$("#animationDelay");if(animationDuration)animationDuration.oninput=setAnimationTiming;if(animationDelay)animationDelay.oninput=setAnimationTiming;$("#playbackMode").onchange=e=>{playback().mode=e.target.value;syncPlayback();schedule()};$("#playbackInterval").onchange=e=>{playback().interval_ms=+e.target.value;schedule()};$("#mediaMode").onchange=e=>{playback().media_mode=e.target.value;schedule()};$("#mediaCycle").onchange=e=>{playback().media_cycle=e.target.value;schedule()};$("#mediaInterval").onchange=e=>{playback().media_interval_ms=+e.target.value;schedule()};$("#loopVideos").onchange=e=>{playback().loop_videos=e.target.checked;schedule()};
document.querySelectorAll("[data-slide-prev]").forEach(b=>b.onclick=()=>move(-1));document.querySelectorAll("[data-slide-next]").forEach(b=>b.onclick=()=>move(1));const addSlideButton=$("#addSlide"),duplicateSlideButton=$("#duplicateSlide"),deleteSlideButton=$("#deleteSlide");if(addSlideButton)addSlideButton.onclick=addSlide;if(duplicateSlideButton)duplicateSlideButton.onclick=duplicateSlide;if(deleteSlideButton)deleteSlideButton.onclick=deleteSlide;$("#renamePresentation").onclick=()=>{const v=prompt("Presentation title",presentation.title);if(v?.trim()){presentation.title=v.trim();render();schedule()}};$("#renameSlide").onclick=()=>{const v=prompt("Slide title",activeSlide().title);if(v?.trim()){activeSlide().title=v.trim();const t=canvas.getObjects().find(o=>o.id==="title");if(t)t.set("text",v.trim());render();schedule()}};
$("#bringForward").onclick=()=>action("forward");$("#sendBackward").onclick=()=>action("backward");$("#duplicateElement").onclick=()=>action("duplicate");$("#deleteElement").onclick=()=>action("delete");$("#sharePermission").onchange=syncShareCodeInput;$("#shareScreenCode")?.addEventListener("input",e=>{e.target.value=e.target.value.replace(/\D/g,"").slice(0,4)});syncShareCodeInput();$("#generateLink").onclick=async()=>{setShareLink("","");const screenCode=requestScreenAccessCode();if(screenCode===null)return;try{await save();const r=await api.createShareLink(presentation.id,"presenter",screenCode);setShareLink(r.url,r.permission,r.screenUrl||"",r.audienceUrl||"")}catch(e){setShareError(e.message)}};$("#copyLink").onclick=async()=>{if(!shareUrl)return toast("Generate a link first.");try{await navigator.clipboard.writeText(shareUrl);toast("Remote link copied.")}catch{$("#shareStatus").textContent=shareUrl}};$("#copyAudienceLink")&&( $("#copyAudienceLink").onclick=async()=>{if(!audienceShareUrl)return toast("Generate a Remote Control link first.");try{await navigator.clipboard.writeText(audienceShareUrl);toast("Interactive audience link copied.")}catch{$("#audienceShareStatus").textContent=audienceShareUrl}});$("#copyScreenLink")&&( $("#copyScreenLink").onclick=async()=>{if(!screenShareUrl)return toast("Generate a Remote Control link first.");try{await navigator.clipboard.writeText(screenShareUrl);toast("Screen link copied.")}catch{$("#screenShareStatus").textContent=screenShareUrl}});$("#openShareLink").onclick=()=>{if(shareUrl)window.open(shareUrl,"_blank","noopener,noreferrer")};const startLiveButton=$("#startLive");if(startLiveButton)startLiveButton.onclick=start;const openAudienceButton=$("#openAudience");if(openAudienceButton)openAudienceButton.onclick=async()=>{const screenCode=requestScreenAccessCode();if(screenCode===null)return;try{await save();const r=await api.createShareLink(presentation.id,"viewer",screenCode);window.open(r.url,"_blank","noopener")}catch(e){toast(e.message)}};document.querySelectorAll("[data-media-input]").forEach(i=>i.addEventListener("change",upload));$("#fileUpload").addEventListener("change",upload);
}

async function init(){
  if(!window.fabric)throw new Error("The editor canvas library did not load.");
  canvas=new fabric.Canvas("fabricCanvas",{
    width:W,
    height:H,
    preserveObjectStacking:true,
    selection:true
  });

  fabric.Object.prototype.set({
    borderColor:"#101010",
    cornerColor:"#101010",
    cornerStrokeColor:"#ffffff",
    cornerSize:14,
    transparentCorners:false,
    borderScaleFactor:2,
    padding:3
  });

  bind();

  const libraryPromise=api.listMedia().catch(()=>({assets:[]}));
  const r=await api.getPresentation(presentationId);

  presentation=r.presentation;

  if(!presentation.slides.length)addSlide();

  presentation.slides.forEach(ensure);
  playback();
  render();

  $("#modeLabel").textContent="Ready";
  socket?.emit("join_presentation",{presentationId:presentation.id});
  // The editor is usable while the media library loads independently.
  libraryPromise.then(library=>{
    const seen=new Set(mediaAssets.map(asset=>asset.id));
    mediaAssets.push(...(library.assets||[]).filter(asset=>!seen.has(asset.id)));
    mediaLibrary();
  });
}

const audienceLaunchButton = $("#openAudience");
if (audienceLaunchButton) audienceLaunchButton.onclick = async () => {
  const screenCode = requestScreenAccessCode();
  if (screenCode === null) return;
  try {
    await save();
    const result = await api.createShareLink(presentation.id, "viewer", screenCode);
    window.open(result.audienceUrl || result.url, "_blank", "noopener");
  } catch (error) { toast(error.message); }
};

init().catch(e=>{
  $("#modeLabel").textContent="Error";
  toast(e.message);
});
