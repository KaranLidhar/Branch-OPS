import { useState } from "react";

// ── CONSTANTS ─────────────────────────────────────────────────────────────
const TRUCK_TYPES = ["High Roof Cargo Van","15 Cube","16 Cabover","26 FT CDL","26 FT G Class","18 Reefer","26 CDL Reefer","26 G Class Reefer","Day Cab","Sleeper"];

const LINE = {
  RL:  { bg:"#84cc16", text:"#1a2e05", label:"Ready Line" },
  WL:  { bg:"#7dd3fc", text:"#0c2a3e", label:"Wash Line" },
  SRL: { bg:"#f1f5f9", text:"#0f172a", label:"Service Ready" },
  SL:  { bg:"#f87171", text:"#3b0a0a", label:"Service Line" },
  SHOP:{ bg:"#374151", text:"#f9fafb", label:"Shop / Deadline" },
  PUR: { bg:"#a855f7", text:"#f5f3ff", label:"Purolator" },
};

// ── HELPERS ───────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2,9);
const todayStr = () => new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"});
const todayKey = () => new Date().toISOString().slice(0,10);
const fmtDate  = d => { if(!d) return ""; return new Date(d+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}); };
const fmtKey   = k => { if(!k) return ""; return new Date(k+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}); };
const twoWeeks = () => { const d=new Date(); d.setDate(d.getDate()+14); return d.toISOString().slice(0,10); };
const daysUntil = d => {
  if(!d) return null;
  const t=new Date(); t.setHours(0,0,0,0);
  return Math.round((new Date(d+"T00:00:00")-t)/(864e5));
};

const mkBoard = () => { const b={}; TRUCK_TYPES.forEach(t=>{b[t]=[];}); return b; };
const BLANK = () => ({ yard:mkBoard(), reso:mkBoard(), tomorrow:mkBoard(), pm:[], tasks:[], hikes:[], sent:[], checkins:[], pmScheduled:[], pmRows:[] });
// pmRows: the PM checklist rows (pending/scheduled only — done rows stay in history)
// pmScheduled: [{unit,scheduledDate,swapRequired,swapUnit,customer}] for task generation

// ── PM DATA FROM EXCEL ────────────────────────────────────────────────────
// Parsed from uploaded PM schedule table (Belfield location)
const PM_DATA_RAW = [
  { unit:"515857", pmType:"DRY", customer:"FORTIGO FREIGHT SERVICES INC",  nextPM:"2026-03-18", daysLeft:-14, defeDays:"Orange", comment:"4th" },
  { unit:"568080", pmType:"WET", customer:"PUROLATOR INC",                  nextPM:"2026-03-21", daysLeft:-11, defeDays:"Yellow", comment:"Done" },
  { unit:"516557", pmType:"DRY", customer:"THOMSON TERMINALS LTD",          nextPM:"2026-03-21", daysLeft:-11, defeDays:"Yellow", comment:"7th" },
  { unit:"567278", pmType:"DRY", customer:"PUROLATOR INC",                  nextPM:"2026-03-25", daysLeft:-7,  defeDays:"Yellow", comment:"14th" },
  { unit:"198385", pmType:"DRY", customer:"SURE TRACK COURIER LTD",         nextPM:"2026-03-29", daysLeft:-3,  defeDays:"Gray",   comment:"" },
  { unit:"292019", pmType:"WET", customer:"FORTIGO FREIGHT SERVICES INC",   nextPM:"2026-04-11", daysLeft:10,  defeDays:"8:14 Days", comment:"17th" },
  { unit:"235651", pmType:"DRY", customer:"THOMSON TERMINALS INC",          nextPM:"2026-04-12", daysLeft:11,  defeDays:"8:14 Days", comment:"15th" },
  { unit:"569763", pmType:"DRY", customer:"PUROLATOR INC",                  nextPM:"2026-04-14", daysLeft:13,  defeDays:"8:14 Days", comment:"21st" },
  { unit:"284007", pmType:"DRY", customer:"ATS HEALTHCARE INC",             nextPM:"2026-04-14", daysLeft:13,  defeDays:"8:14 Days", comment:"22nd" },
  { unit:"228643", pmType:"G1",  customer:"KNG INC",                        nextPM:"2026-04-18", daysLeft:17,  defeDays:"15:30 Days", comment:"" },
  { unit:"516561", pmType:"DRY", customer:"THOMSON TERMINALS LTD",          nextPM:"2026-04-19", daysLeft:18,  defeDays:"15:30 Days", comment:"24th" },
];

function urgencyColor(days){
  if(days < 0)  return { bg:"#7f1d1d", text:"#fca5a5", label:"OVERDUE" };
  if(days <= 5)  return { bg:"#78350f", text:"#fdba74", label:"URGENT" };
  if(days <= 14) return { bg:"#713f12", text:"#fde68a", label:"SOON" };
  return { bg:"#1f2937", text:"#9ca3af", label:"UPCOMING" };
}

// ── PM TAB COMPONENT ──────────────────────────────────────────────────────
// PM rows live in main state (S.pmRows) so New Day can filter done ones out
// On first load, seed from PM_DATA_RAW if pmRows is empty
function PMTab({ S, setS, notify, openModal }) {
  // Seed pmRows into main state on first render if empty
  useState(() => {
    if((S.pmRows||[]).length === 0){
      const seen = new Set();
      const seeded = PM_DATA_RAW
        .filter(r=>{ if(seen.has(r.unit)) return false; seen.add(r.unit); return true; })
        .map(r=>({
          ...r, id:uid(), status:"pending", scheduledDate:"",
          swapRequired:false, swapUnit:"", notes:r.comment||"", _prev:null,
        }));
      setS(s=>({...s, pmRows:seeded}));
    }
  });

  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState("days");
  const [expandedId, setExpandedId] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);

  const rows = S.pmRows || [];

  // Parse CSV text into PM row objects
  function parseCSVtoPMRows(csv){
    const lines = csv.split(/\r?\n/).filter(l=>l.trim());
    if(lines.length < 2) throw new Error("File appears empty");
    // Detect header row
    const headers = lines[0].split(',').map(h=>h.replace(/['"]/g,'').trim().toLowerCase());
    const get = (row, ...keys) => {
      for(const k of keys){
        const idx = headers.findIndex(h=>h.includes(k));
        if(idx>=0 && row[idx]) return row[idx].replace(/['"]/g,'').trim();
      }
      return "";
    };
    const parsed = [];
    for(let i=1;i<lines.length;i++){
      // Handle quoted CSV fields
      const row = lines[i].match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g)||lines[i].split(',');
      const unit      = get(row,'unit');
      const pmType    = get(row,'pm type','type');
      const customer  = get(row,'customer');
      const nextPM    = get(row,'next pm','pm due','due date','date');
      const daysLeft  = parseInt(get(row,'days','days until','until'))||0;
      const defeDays  = get(row,'defe','deferral','defer');
      const comment   = get(row,'comment','comments','note');
      if(!unit || unit.length<3) continue; // skip empty/header rows
      parsed.push({ unit, pmType:pmType||"DRY", customer, nextPM, daysLeft, defeDays, comment });
    }
    return parsed;
  }

  // Merge parsed rows into pmRows — skip duplicates by unit #, preserve existing status/scheduledDate
  function mergePMRows(parsed){
    setS(s=>{
      const existing = s.pmRows || [];
      const existingUnits = new Set(existing.map(r=>r.unit));
      let added = 0, dupes = 0;
      const newRows = [...existing];
      for(const r of parsed){
        if(existingUnits.has(r.unit)){ dupes++; continue; }
        newRows.push({
          ...r, id:uid(), status:"pending", scheduledDate:"",
          swapRequired:false, swapUnit:"", notes:r.comment||"", _prev:null,
        });
        existingUnits.add(r.unit);
        added++;
      }
      // Deduplicate existing rows too — keep first occurrence
      const seen = new Set();
      const deduped = newRows.filter(r=>{ if(seen.has(r.unit)) return false; seen.add(r.unit); return true; });
      setUploadStatus({ok:true, msg:`✓ Imported ${added} new unit${added!==1?"s":""} · ${dupes} duplicate${dupes!==1?"s":""} skipped · ${deduped.length} total`});
      return {...s, pmRows:deduped};
    });
  }

  function updateRow(id, patch){
    setS(s=>({...s, pmRows:s.pmRows.map(r=>r.id===id?{...r,...patch}:r)}));
  }

  function updateWithUndo(id, patch){
    setS(s=>({...s, pmRows:s.pmRows.map(r=>r.id===id?{...r,_prev:{status:r.status,scheduledDate:r.scheduledDate},...patch}:r)}));
  }

  function undoRow(id){
    setS(s=>({...s, pmRows:s.pmRows.map(r=>{
      if(r.id!==id||!r._prev) return r;
      return {...r,...r._prev,_prev:null};
    })}));
    notify("Action undone ↩");
  }

  function markScheduled(id, scheduledDate){
    if(!scheduledDate){ notify("Please pick a scheduled date first"); return; }
    const row = rows.find(r=>r.id===id);
    if(!row) return;
    updateWithUndo(id, { status:"scheduled", scheduledDate });
    // Sync to pmScheduled for newDay task generation
    setS(s=>{
      const existing=(s.pmScheduled||[]).filter(p=>p.unit!==row.unit);
      return {...s, pmScheduled:[...existing,{unit:row.unit,scheduledDate,swapRequired:row.swapRequired,swapUnit:row.swapUnit,customer:row.customer,pmType:row.pmType}]};
    });
    notify(`Unit ${row.unit} scheduled for ${fmtDate(scheduledDate)} ✓`);
  }

  function markDone(id){
    const row = rows.find(r=>r.id===id);
    // Mark done — will be filtered out on next New Day, stays visible today
    updateWithUndo(id, { status:"done" });
    // Remove from pmScheduled so it doesn't generate tasks anymore
    setS(s=>({...s, pmScheduled:(s.pmScheduled||[]).filter(p=>p.unit!==row?.unit)}));
    if(row) notify(`Unit ${row.unit} PM done ✓ — will be removed on next New Day`);
  }


  const filtered = rows
    .filter(r => filterStatus==="all" || r.status===filterStatus)
    .sort((a,b) => sortBy==="days" ? a.daysLeft-b.daysLeft : a.unit.localeCompare(b.unit));

  const overdue   = rows.filter(r=>r.daysLeft<0&&r.status!=="done").length;
  const urgent    = rows.filter(r=>r.daysLeft>=0&&r.daysLeft<=5&&r.status!=="done").length;
  const scheduled = rows.filter(r=>r.status==="scheduled").length;
  const done      = rows.filter(r=>r.status==="done").length;

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:16}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#fb923c",letterSpacing:"0.08em"}}>PM SCHEDULE</div>
          <div style={{fontSize:10,color:"#4b5563",marginTop:1}}>Imported from Belfield PM table · set scheduled date · confirm done · undo any action</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[["OVERDUE",overdue,"#ef4444","#7f1d1d"],["URGENT",urgent,"#fb923c","#78350f"],["SCHEDULED",scheduled,"#34d399","#064e3b"],["DONE",done,"#6b7280","#1f2937"]].map(([l,v,c,bg])=>(
            <div key={l} style={{background:bg,border:`1px solid ${c}33`,borderRadius:6,padding:"4px 12px",textAlign:"center"}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:c}}>{v}</div>
              <div style={{fontSize:9,color:c,opacity:0.8,letterSpacing:"0.06em"}}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter + Sort */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:10,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.07em"}}>Filter:</span>
        {[["all","All"],["pending","Pending"],["scheduled","Scheduled"],["done","Done"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFilterStatus(v)} style={{border:"none",borderRadius:5,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:filterStatus===v?"#f59e0b":"#1f2937",color:filterStatus===v?"#0b0e14":"#6b7280"}}>{l}</button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:10,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.07em"}}>Sort:</span>
          {[["days","By Date"],["unit","By Unit"]].map(([v,l])=>(
            <button key={v} onClick={()=>setSortBy(v)} style={{border:"none",borderRadius:5,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:sortBy===v?"#374151":"#1f2937",color:sortBy===v?"#e2e8f0":"#6b7280"}}>{l}</button>
          ))}
        </div>
      </div>

      {/* Checklist */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filtered.map(row=>{
          const urg=urgencyColor(row.daysLeft);
          const isDone=row.status==="done";
          const isScheduled=row.status==="scheduled";
          const expanded=expandedId===row.id;
          const canUndo=!!row._prev;
          return (
            <div key={row.id} style={{background:"#111827",border:`1px solid ${isDone?"#1f2937":isScheduled?"#16a34a44":urg.bg}`,borderRadius:9,overflow:"hidden",opacity:isDone?0.6:1,transition:"all 0.2s"}}>

              {/* ── MAIN ROW ── */}
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",cursor:"pointer",flexWrap:"wrap"}} onClick={()=>setExpandedId(expanded?null:row.id)}>

                {/* Status dot */}
                <div style={{width:10,height:10,borderRadius:"50%",background:isDone?"#4ade80":isScheduled?"#34d399":urg.bg,flexShrink:0,boxShadow:isScheduled?"0 0 6px #16a34a":undefined}}/>

                {/* Unit */}
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:isDone?"#374151":isScheduled?"#34d399":urg.text,minWidth:65,textDecoration:isDone?"line-through":undefined}}>{row.unit}</div>

                {/* PM type */}
                <div style={{background:"#1f2937",color:"#6b7280",borderRadius:4,padding:"1px 7px",fontSize:10,fontWeight:600,flexShrink:0}}>{row.pmType}</div>

                {/* Customer */}
                <div style={{flex:1,fontSize:11,color:isDone?"#374151":"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:80}}>{row.customer}</div>

                {/* Days / status pill */}
                <div style={{background:isDone?"#1f2937":isScheduled?"#064e3b":urg.bg,color:isDone?"#4ade80":isScheduled?"#34d399":urg.text,borderRadius:5,padding:"2px 10px",fontSize:11,fontWeight:700,flexShrink:0,minWidth:88,textAlign:"center"}}>
                  {isDone?"✓ DONE":isScheduled?`📅 ${fmtDate(row.scheduledDate)}`:row.daysLeft<0?`${Math.abs(row.daysLeft)}d overdue`:row.daysLeft===0?"DUE TODAY":`${row.daysLeft}d left`}
                </div>

                {/* Next PM date */}
                <div style={{fontSize:10,color:"#374151",flexShrink:0,minWidth:55}}>{fmtDate(row.nextPM)}</div>

                {/* Action buttons */}
                <div style={{display:"flex",gap:5,flexShrink:0,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
                  {canUndo&&(
                    <button onClick={()=>undoRow(row.id)} style={{background:"#1f2937",border:"1px solid #374151",color:"#9ca3af",borderRadius:5,padding:"4px 8px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}} title="Undo last action">
                      ↩ Undo
                    </button>
                  )}
                  {!isDone&&!isScheduled&&(
                    <button onClick={()=>markDone(row.id)} style={{background:"#064e3b",border:"1px solid #16a34a",color:"#4ade80",borderRadius:5,padding:"4px 9px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                      ✓ Done
                    </button>
                  )}
                  {isDone&&(
                    <span style={{fontSize:10,color:"#4ade80",fontWeight:700}}>✅ Complete</span>
                  )}
                  {/* Delete button */}
                  <button
                    onClick={()=>setS(s=>({...s,pmRows:s.pmRows.filter(r=>r.id!==row.id),pmScheduled:(s.pmScheduled||[]).filter(p=>p.unit!==row.unit)}))}
                    style={{background:"transparent",border:"1px solid #374151",color:"#4b5563",borderRadius:5,padding:"4px 7px",fontSize:11,fontWeight:700,cursor:"pointer",lineHeight:1}}
                    title="Delete this PM row">
                    ✕
                  </button>
                </div>

                <div style={{fontSize:10,color:"#374151",flexShrink:0}}>{expanded?"▲":"▼"}</div>
              </div>

              {/* ── EXPANDED PANEL ── */}
              {expanded&&(
                <div style={{borderTop:"1px solid #1f2937",padding:"14px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>

                  {/* Left: details */}
                  <div>
                    <div style={{fontSize:10,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Details</div>
                    <div style={{fontSize:12,color:"#6b7280",lineHeight:2}}>
                      <div><span style={{color:"#4b5563"}}>Customer: </span><span style={{color:"#9ca3af"}}>{row.customer}</span></div>
                      <div><span style={{color:"#4b5563"}}>PM Type: </span><span style={{color:"#9ca3af"}}>{row.pmType}</span></div>
                      <div><span style={{color:"#4b5563"}}>Due Date: </span><span style={{color:"#f59e0b"}}>{fmtDate(row.nextPM)}</span></div>
                      <div><span style={{color:"#4b5563"}}>Deferral: </span><span style={{color:"#9ca3af"}}>{row.defeDays}</span></div>
                      {row.comment&&<div><span style={{color:"#4b5563"}}>PM #: </span><span style={{color:"#9ca3af"}}>{row.comment}</span></div>}
                      {row.scheduledDate&&<div><span style={{color:"#4b5563"}}>Scheduled: </span><span style={{color:"#34d399",fontWeight:700}}>{fmtDate(row.scheduledDate)}</span></div>}
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    <div style={{fontSize:10,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:2}}>Actions</div>

                    {/* Schedule date picker + confirm */}
                    {!isDone&&(
                      <div style={{background:"#1f2937",borderRadius:7,padding:"10px"}}>
                        <div style={{fontSize:10,color:"#6b7280",marginBottom:5}}>📅 Schedule PM for date:</div>
                        <input
                          type="date"
                          value={row.scheduledDate||""}
                          onChange={e=>updateRow(row.id,{scheduledDate:e.target.value})}
                          style={{background:"#111827",border:"1px solid #374151",color:"#e2e8f0",borderRadius:5,padding:"6px 10px",fontFamily:"inherit",fontSize:12,width:"100%",outline:"none",marginBottom:6}}
                        />
                        <button
                          onClick={()=>markScheduled(row.id, row.scheduledDate)}
                          style={{width:"100%",background:isScheduled?"#064e3b":"#1e3a5f",border:`1px solid ${isScheduled?"#16a34a":"#2d5080"}`,color:isScheduled?"#4ade80":"#93c5fd",borderRadius:5,padding:"6px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                          {isScheduled?"✓ Scheduled — update date":"📧 Mark Scheduled + Email Sent"}
                        </button>
                      </div>
                    )}

                    {/* Swap required */}
                    <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",background:"#1f2937",borderRadius:6,padding:"7px 10px"}}>
                      <input type="checkbox" checked={!!row.swapRequired} onChange={e=>updateRow(row.id,{swapRequired:e.target.checked})} style={{width:14,height:14,accentColor:"#f59e0b",cursor:"pointer"}}/>
                      <span style={{fontSize:12,color:row.swapRequired?"#f59e0b":"#6b7280",fontWeight:row.swapRequired?"600":"400"}}>🔄 Swap Required</span>
                    </label>
                    {row.swapRequired&&(
                      <input placeholder="Swap unit #..." value={row.swapUnit} onChange={e=>updateRow(row.id,{swapUnit:e.target.value})}
                        style={{background:"#1f2937",border:"1px solid #f59e0b55",borderRadius:5,padding:"6px 10px",fontFamily:"inherit",fontSize:12,color:"#e2e8f0",outline:"none",width:"100%"}}/>
                    )}



                    {/* Mark done from expanded */}
                    {!isDone&&(
                      <button onClick={()=>markDone(row.id)} style={{background:"#064e3b",border:"1px solid #16a34a",color:"#4ade80",borderRadius:5,padding:"6px 10px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                        ✅ Confirm PM Done
                      </button>
                    )}

                    {/* Undo from expanded */}
                    {canUndo&&(
                      <button onClick={()=>undoRow(row.id)} style={{background:"#1f2937",border:"1px solid #374151",color:"#9ca3af",borderRadius:5,padding:"6px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                        ↩ Undo Last Action
                      </button>
                    )}

                    {/* Notes */}
                    <textarea placeholder="Notes..." value={row.notes} onChange={e=>updateRow(row.id,{notes:e.target.value})}
                      style={{background:"#1f2937",border:"1px solid #374151",borderRadius:5,padding:"7px 10px",fontFamily:"inherit",fontSize:11,color:"#9ca3af",outline:"none",width:"100%",resize:"vertical",minHeight:56}}/>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── UPLOAD SECTION ── */}
      <div style={{marginTop:20,background:"#111827",border:"1px solid #1f2937",borderRadius:10,padding:"16px"}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,color:"#fb923c",letterSpacing:"0.06em",marginBottom:4}}>UPLOAD NEW PM TABLE</div>
        <div style={{fontSize:10,color:"#4b5563",marginBottom:12}}>Upload an Excel (.xlsx), CSV (.csv), or screenshot image — new units are merged in, duplicates are ignored, existing statuses are preserved</div>

        {/* File drop zone */}
        <label style={{display:"block",border:"2px dashed #374151",borderRadius:8,padding:"20px",textAlign:"center",cursor:"pointer",transition:"border-color 0.15s",background:"#0b0e14"}}
          onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="#f59e0b";}}
          onDragLeave={e=>{e.currentTarget.style.borderColor="#374151";}}
          onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="#374151";handlePMUpload(e.dataTransfer.files[0]);}}>
          <input type="file" accept=".xlsx,.xls,.csv,.png,.jpg,.jpeg" style={{display:"none"}} onChange={e=>handlePMUpload(e.target.files[0])}/>
          <div style={{fontSize:24,marginBottom:6}}>📎</div>
          <div style={{fontSize:12,color:"#6b7280"}}>Drop file here or tap to browse</div>
          <div style={{fontSize:10,color:"#374151",marginTop:3}}>Excel · CSV · Screenshot image</div>
        </label>

        {uploadStatus&&(
          <div style={{marginTop:10,padding:"8px 12px",background:uploadStatus.ok?"#052e16":"#450a0a",border:`1px solid ${uploadStatus.ok?"#16a34a":"#ef4444"}`,borderRadius:6,fontSize:11,color:uploadStatus.ok?"#4ade80":"#fca5a5"}}>
            {uploadStatus.msg}
          </div>
        )}
      </div>
    </div>
  );

  // ── UPLOAD HANDLER ── defined inside PMTab scope so it can access state
  function handlePMUpload(file){
    if(!file){ return; }
    const ext = file.name.split('.').pop().toLowerCase();

    if(ext==="csv"){
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const text = e.target.result;
          const parsed = parseCSVtoPMRows(text);
          mergePMRows(parsed);
        } catch(err){ setUploadStatus({ok:false,msg:"Could not parse CSV: "+err.message}); }
      };
      reader.readAsText(file);
    } else if(ext==="xlsx"||ext==="xls"){
      const reader = new FileReader();
      reader.onload = e => {
        try {
          // Use SheetJS if available, otherwise show message
          if(typeof XLSX !== "undefined"){
            const wb = XLSX.read(e.target.result, {type:"array"});
            const ws = wb.Sheets[wb.SheetNames[0]];
            const csv = XLSX.utils.sheet_to_csv(ws);
            const parsed = parseCSVtoPMRows(csv);
            mergePMRows(parsed);
          } else {
            setUploadStatus({ok:false,msg:"Excel parsing unavailable — please export as CSV from Excel and upload that instead"});
          }
        } catch(err){ setUploadStatus({ok:false,msg:"Could not parse Excel: "+err.message}); }
      };
      reader.readAsArrayBuffer(file);
    } else if(["png","jpg","jpeg"].includes(ext)){
      // Image upload — show instructions since we can't OCR in browser
      setUploadStatus({ok:false,msg:"Image uploaded — currently screenshots can't be auto-read. Please export your PM table as CSV from Excel and upload that for auto-import."});
    } else {
      setUploadStatus({ok:false,msg:"Unsupported file type. Please use .xlsx, .xls, or .csv"});
    }
  }
}

// ── APP ───────────────────────────────────────────────────────────────────
export default function App() {
  const [S, setS_]       = useState(BLANK());
  const [history, setHistory] = useState([]); // array of { dayNum, label, snap }
  const [dayNum, setDayNum]   = useState(1);  // current operational day number
  const [dayLabel, setDayLabel] = useState(todayStr()); // label shown in header
  const [tab, setTab]  = useState("dash");
  const [modal, setModal] = useState(null); // { type, tt, card }
  const [form, setForm]   = useState({});
  const [search, setSearch] = useState("");
  const [histOpen, setHistOpen] = useState(false);
  const [historyViewDay, setHistoryViewDay] = useState(null); // snapshot being viewed
  const [goModal, setGoModal] = useState(null); // { card, tt }
  const [goForm, setGoForm]   = useState({ customer:"", returnDate:"" });
  const [removeQ, setRemoveQ] = useState("");
  const [taskInput, setTaskInput] = useState("");
  const [notification, setNotification] = useState("");

  const setS = fn => setS_(s => fn(s));

  function notify(msg){ setNotification(msg); setTimeout(()=>setNotification(""),2500); }

  // ── DAY MANAGEMENT ──────────────────────────────────────────────────────
  function newDay(){
    // Save current operational day to history (keyed by day number, never overwrites)
    const snap = JSON.parse(JSON.stringify(S));
    const currentLabel = dayLabel;
    const currentNum = dayNum;
    setHistory(h => [...h, { dayNum: currentNum, label: currentLabel, snap }]);

    // Next operational day
    const nextNum = currentNum + 1;
    const nextLabel = todayStr(); // use real date for the label
    setDayNum(nextNum);
    setDayLabel(nextLabel);

    // Build new day state
    const ns = BLANK();

    // Yard: keep units physically present (not wentOut), reset daily flags
    TRUCK_TYPES.forEach(tt=>{
      ns.yard[tt] = (S.yard[tt]||[])
        .filter(c => !c.wentOut)
        .map(c=>({...c, goingOut:false, wentOut:false}));
    });

    // Reso: all cards carry forward until checked in
    TRUCK_TYPES.forEach(tt=>{
      ns.reso[tt] = (S.reso[tt]||[]).map(c=>({...c, checkInPending:false}));
    });

    // PM board + hikes carry forward
    ns.pm    = (S.pm||[]).map(c=>({...c}));
    ns.hikes = (S.hikes||[]).map(c=>({...c}));
    ns.pmScheduled = (S.pmScheduled||[]).map(c=>({...c}));
    // PM checklist rows: only carry pending + scheduled — done rows stay in history only
    ns.pmRows = (S.pmRows||[]).filter(r=>r.status!=="done").map(r=>({...r,_prev:null}));

    // Auto return reminders
    TRUCK_TYPES.forEach(tt=>{
      (ns.reso[tt]||[]).forEach(card=>{
        const d = daysUntil(card.returnDate);
        if(d===1) ns.tasks.push({ id:uid(), done:false, type:"return", unit:card.unit, tt,
          text:`Remind customer to drop off unit ${card.unit} — due TOMORROW` });
        if(d===0) ns.tasks.push({ id:uid(), done:false, type:"return", unit:card.unit, tt,
          text:`Unit ${card.unit} is due back TODAY — confirm drop-off` });
        if(d<0) ns.tasks.push({ id:uid(), done:false, type:"overdue", unit:card.unit, tt,
          text:`⚠️ Unit ${card.unit} is ${Math.abs(d)} day(s) OVERDUE — follow up with customer` });
      });
    });

    // Auto PM tasks from scheduled PM rows
    (S.pmScheduled||[]).forEach(pmRow=>{
      if(!pmRow.scheduledDate) return;
      const d = daysUntil(pmRow.scheduledDate);
      if(d===1){
        ns.tasks.push({ id:uid(), done:false, type:"pm", unit:pmRow.unit,
          text:`Remind customer to drop off unit ${pmRow.unit} for PM — scheduled TOMORROW` });
        if(pmRow.swapRequired){
          if(pmRow.swapUnit){
            ns.tasks.push({ id:uid(), done:false, type:"pm-swap", unit:pmRow.unit,
              text:`🔄 Make sure swap unit ${pmRow.swapUnit} is available for unit ${pmRow.unit}'s PM tomorrow${pmRow.pmType?" ("+pmRow.pmType+" type)":""}` });
          } else {
            ns.tasks.push({ id:uid(), done:false, type:"pm-swap", unit:pmRow.unit,
              text:`🔄 Unit ${pmRow.unit} PM is tomorrow — make sure a${pmRow.pmType?" "+pmRow.pmType:""} swap unit is available` });
          }
        }
      }
      if(d===0){
        ns.tasks.push({ id:uid(), done:false, type:"pm", unit:pmRow.unit,
          text:`Unit ${pmRow.unit} PM is scheduled TODAY — confirm drop-off` });
        if(pmRow.swapRequired&&pmRow.swapUnit)
          ns.tasks.push({ id:uid(), done:false, type:"pm-swap", unit:pmRow.unit,
            text:`✅ Is swap unit ${pmRow.swapUnit} here for unit ${pmRow.unit}?` });
      }
    });

    setS_(ns);
    setTab("dash");
    notify(`Day ${nextNum} started ✓`);
  }

  // View a past day's snapshot (read-only peek — does not replace live state)
  // History is just for reference, we never go "back"
  function viewDay(entry){ setHistOpen(false); setTab("dash"); /* future: show snapshot modal */ }

  // ── YARD ────────────────────────────────────────────────────────────────
  function saveYard(){
    if(!form.unit?.trim()) return;
    const tt=modal.tt;
    const hikeId = uid();
    const isHikeIn  = !!form.hikeIn  && !modal.card;
    const isHikeOut = !!form.hikeOut && !modal.card;
    const card={
      id:form.id||uid(), unit:form.unit.trim(), line:form.line||"RL",
      isPuro:!!form.isPuro, note:form.note||"", shopDate:form.shopDate||"",
      goingOut:!!form.goingOut, wentOut:!!form.wentOut,
      awaitingArrival: isHikeIn,
      hikeId: isHikeIn ? hikeId : undefined,
    };
    setS(s=>{
      let ns;
      if(isHikeOut){
        // Hike out: don't add to yard, add to hikes outbound + sent
        const hikeCard={id:hikeId,unit:card.unit,tt,dir:"out",location:"",arrival:"",placed:false,ready:false,pmDue:false,note:form.note||""};
        const sentExists=s.sent.find(c=>c.unit===card.unit);
        ns={...s,
          hikes:[...s.hikes,hikeCard],
          sent:sentExists?s.sent:[...s.sent,{id:uid(),unit:card.unit,tt,location:"",note:"Hike out"}],
        };
      } else {
        // Normal add (or hike in — card goes to yard as awaiting arrival)
        const arr=modal.card?s.yard[tt].map(c=>c.id===card.id?card:c):[...s.yard[tt],card];
        ns={...s,yard:{...s.yard,[tt]:arr}};
        // Hike in: also add to hikes inbound
        if(isHikeIn && !ns.hikes.find(h=>h.unit===card.unit&&h.dir==="in")){
          const hikeCard={id:hikeId,unit:card.unit,tt,dir:"in",location:"",arrival:"",placed:false,ready:false,pmDue:false,note:form.note||""};
          ns={...ns,hikes:[...ns.hikes,hikeCard]};
        }
      }
      // Quick action side effects (skip for hike out since unit isn't on yard)
      if(!isHikeOut){
        if(form.addPM && !ns.pm.find(p=>p.unit===card.unit))
          ns={...ns,pm:[...ns.pm,{id:uid(),unit:card.unit,tt,pmDate:"",note:""}]};
        if(form.addTomorrow && !(ns.tomorrow[tt]||[]).find(c=>c.unit===card.unit))
          ns={...ns,tomorrow:{...ns.tomorrow,[tt]:[...(ns.tomorrow[tt]||[]),{id:uid(),unit:card.unit,note:"From yard",hold:true}]}};
        if(form.addCheckin){
          if(!ns.tasks.find(t=>t.unit===card.unit&&t.type==="checkin"))
            ns={...ns,tasks:[...ns.tasks,{id:uid(),done:false,type:"checkin",unit:card.unit,text:`Check in unit ${card.unit} (${tt})`}]};
          if(!ns.checkins.find(c=>c.unit===card.unit))
            ns={...ns,checkins:[...ns.checkins,{id:uid(),unit:card.unit,tt,hikedFrom:"",note:""}]};
        }
      }
      return ns;
    });
    closeModal();
    notify(isHikeOut?`Unit ${form.unit.trim()} hiked out → Hikes ↑ ✓`:isHikeIn?`Unit ${form.unit.trim()} added as Awaiting Arrival → Hikes ↓ ✓`:"Unit saved ✓");
  }

  function markGoingOut(tt,card){
    setS(s=>({...s,yard:{...s.yard,[tt]:s.yard[tt].map(c=>c.id===card.id?{...c,goingOut:!c.goingOut,wentOut:c.goingOut?false:c.wentOut}:c)}}));
  }

  function openWentOut(tt,card){
    setGoModal({card,tt});
    setGoForm({customer:card.customer||"",returnDate:twoWeeks()});
  }

  function confirmWentOut(){
    const {card,tt}=goModal;
    const {customer,returnDate}=goForm;
    if(!returnDate) return;
    setS(s=>({
      ...s,
      yard:{...s.yard,[tt]:s.yard[tt].filter(c=>c.id!==card.id)},
      reso:{...s.reso,[tt]:[...(s.reso[tt]||[]),{id:uid(),unit:card.unit,returnDate,customer,note:"Going out today",tt}]},
    }));
    setGoModal(null);
    notify(`Unit ${card.unit} moved to Short Term Reso ✓`);
  }

  function quickPM(tt,card){
    setS(s=>s.pm.find(p=>p.unit===card.unit)?s:{...s,pm:[...s.pm,{id:uid(),unit:card.unit,tt,pmDate:"",note:""}]});
    notify(`Unit ${card.unit} added to PM schedule ✓`);
  }
  function quickTomorrow(tt,card){
    setS(s=>(s.tomorrow[tt]||[]).find(c=>c.unit===card.unit)?s:{...s,tomorrow:{...s.tomorrow,[tt]:[...(s.tomorrow[tt]||[]),{id:uid(),unit:card.unit,note:"From yard",hold:true}]}});
    notify(`Unit ${card.unit} added to Tomorrow ✓`);
  }

  // Quick hike out — opens a destination modal before acting
  const [hikeOutModal, setHikeOutModal] = useState(null); // { card, tt }
  const [hikeOutDest, setHikeOutDest]   = useState("");

  function quickHikeOut(tt, card){
    setHikeOutModal({card, tt});
    setHikeOutDest("");
  }

  function confirmHikeOut(){
    const {card, tt} = hikeOutModal;
    const location = hikeOutDest.trim();
    setS(s=>{
      const hikeExists = s.hikes.find(h=>h.unit===card.unit&&h.dir==="out");
      if(hikeExists) return s;
      const hikeCard = {id:uid(),unit:card.unit,tt,dir:"out",location,arrival:"",placed:false,ready:false,pmDue:false,note:"Hike out from yard"};
      const sentExists = s.sent.find(c=>c.unit===card.unit);
      const newSent = sentExists ? s.sent : [...s.sent,{id:uid(),unit:card.unit,tt,location,note:"Hike out"}];
      const newYard = {...s.yard,[tt]:s.yard[tt].filter(c=>c.id!==card.id)};
      return {...s, hikes:[...s.hikes,hikeCard], sent:newSent, yard:newYard};
    });
    notify(`Unit ${card.unit} hiked out to ${location||"unknown"} ✓`);
    setHikeOutModal(null);
    setHikeOutDest("");
  }

  // Quick hike in — marks unit as awaiting arrival, adds to hikes section (inbound)
  const [hikeInModal, setHikeInModal]   = useState(null); // { card, tt }
  const [hikeInFrom,  setHikeInFrom]    = useState("");

  function quickHikeIn(tt, card){
    setHikeInModal({card, tt});
    setHikeInFrom("");
  }

  function confirmHikeIn(){
    const {card, tt} = hikeInModal;
    const location = hikeInFrom.trim();
    setS(s=>{
      const hikeExists = s.hikes.find(h=>h.unit===card.unit&&h.dir==="in");
      if(hikeExists) return s;
      const hikeCard = {id:uid(),unit:card.unit,tt,dir:"in",location,arrival:"",placed:false,ready:false,pmDue:false,note:"Hike in to yard"};
      const newYard = {...s.yard,[tt]:s.yard[tt].map(c=>c.id===card.id?{...c,awaitingArrival:true,hikeId:hikeCard.id,note:`Hiked from ${location||"other location"}`}:c)};
      return {...s, hikes:[...s.hikes,hikeCard], yard:newYard};
    });
    notify(`Unit ${card.unit} awaiting arrival from ${location||"other location"} ✓`);
    setHikeInModal(null);
    setHikeInFrom("");
  }

  // ── RESO ────────────────────────────────────────────────────────────────
  function saveReso(){
    if(!form.unit?.trim()) return;
    const tt=modal.tt;
    const card={id:form.id||uid(),unit:form.unit.trim(),returnDate:form.returnDate||"",customer:form.customer||"",note:form.note||"",tt};
    setS(s=>{ const arr=modal.card?s.reso[tt].map(c=>c.id===card.id?card:c):[...s.reso[tt],card]; return {...s,reso:{...s.reso,[tt]:arr}}; });
    closeModal();
  }

  function checkInFromReso(tt,card){
    setS(s=>{
      // Don't move to yard yet — add a pending task, user ticks it when unit physically arrives
      const taskExists=s.tasks.find(t=>t.unit===card.unit&&t.type==="checkin"&&!t.done);
      if(taskExists) return s; // already pending
      const taskId=uid();
      const newTask={
        id:taskId, done:false, type:"checkin", unit:card.unit,
        text:`Check in unit ${card.unit} (${tt}) — returning from reso`,
        resoCardId:card.id, resoTT:tt, customer:card.customer||"",
      };
      // Mark reso card as check-in pending so button changes state
      const newReso={...s.reso,[tt]:s.reso[tt].map(c=>c.id===card.id?{...c,checkInPending:true}:c)};
      return {...s, tasks:[...s.tasks,newTask], reso:newReso};
    });
    notify(`Unit ${card.unit} added to daily tasks — tick it off when unit arrives ✓`);
  }

  // ── TOMORROW ────────────────────────────────────────────────────────────
  function saveTomorrow(){
    if(!form.unit?.trim()) return;
    const tt=modal.tt;
    const card={id:form.id||uid(),unit:form.unit.trim(),note:form.note||"",hold:!!form.hold};
    setS(s=>{ const arr=modal.card?s.tomorrow[tt].map(c=>c.id===card.id?card:c):[...s.tomorrow[tt],card]; return {...s,tomorrow:{...s.tomorrow,[tt]:arr}}; });
    closeModal();
  }
  function toggleHold(tt,id){ setS(s=>({...s,tomorrow:{...s.tomorrow,[tt]:s.tomorrow[tt].map(c=>c.id===id?{...c,hold:!c.hold}:c)}})); }

  // ── PM ──────────────────────────────────────────────────────────────────
  function savePM(){
    if(!form.unit?.trim()) return;
    const card={id:form.id||uid(),unit:form.unit.trim(),tt:form.tt||"",pmDate:form.pmDate||"",note:form.note||""};
    setS(s=>({...s,pm:modal.card?s.pm.map(c=>c.id===card.id?card:c):[...s.pm,card]}));
    closeModal();
  }

  // ── HIKES ───────────────────────────────────────────────────────────────
  function saveHike(){
    if(!form.unit?.trim()) return;
    const card={id:form.id||uid(),unit:form.unit.trim(),tt:form.tt||"",dir:form.dir||"in",location:form.location||"",arrival:form.arrival||"",placed:!!form.placed,ready:!!form.ready,pmDue:!!form.pmDue,note:form.note||"",awaitingArrival:form.dir==="in"};
    setS(s=>{
      const newHikes=modal.card?s.hikes.map(c=>c.id===card.id?card:c):[...s.hikes,card];
      let ns={...s,hikes:newHikes};
      // PM side effect
      if(card.pmDue&&!ns.pm.find(p=>p.unit===card.unit))
        ns={...ns,pm:[...ns.pm,{id:uid(),unit:card.unit,tt:card.tt,pmDate:"",note:"Via hike"}]};
      // Outbound hike: also add to Sent panel so it's tracked there
      if(card.dir==="out"&&!ns.sent.find(c=>c.unit===card.unit))
        ns={...ns,sent:[...ns.sent,{id:uid(),unit:card.unit,tt:card.tt,location:card.location,note:`Hike out · arrival ${card.arrival||"TBD"}`}]};
      // Inbound hike: add to yard as "Awaiting Arrival" so it shows on the board
      if(card.dir==="in"&&!modal.card){
        const ttKey=card.tt||TRUCK_TYPES[0];
        if(!(ns.yard[ttKey]||[]).find(c=>c.unit===card.unit))
          ns={...ns,yard:{...ns.yard,[ttKey]:[...(ns.yard[ttKey]||[]),{id:uid(),unit:card.unit,line:"RL",isPuro:false,note:"Awaiting arrival",shopDate:"",goingOut:false,wentOut:false,awaitingArrival:true,hikeId:card.id}]}};
      }
      return ns;
    });
    closeModal();
    notify(card.dir==="out"?`Outbound hike for ${card.unit} placed — added to Sent ✓`:`Inbound hike for ${card.unit} — added to yard as Awaiting Arrival ✓`);
  }
  function toggleHikeField(id,f){ setS(s=>({...s,hikes:s.hikes.map(h=>h.id===id?{...h,[f]:!h[f]}:h)})); }

  // Confirm inbound hike arrived — removes awaiting flag, becomes normal yard unit
  function confirmHikeArrival(tt, card){
    setS(s=>({...s,
      yard:{...s.yard,[tt]:s.yard[tt].map(c=>c.id===card.id?{...c,awaitingArrival:false,note:"",hikeId:undefined}:c)},
      hikes:s.hikes.map(h=>h.id===card.hikeId?{...h,placed:true,ready:true}:h),
    }));
    notify(`Unit ${card.unit} arrived — now a regular yard unit ✓`);
  }

  // ── SENT / CHECKINS ─────────────────────────────────────────────────────
  function saveSent(){
    if(!form.unit?.trim()) return;
    const card={id:form.id||uid(),unit:form.unit.trim(),tt:form.tt||"",location:form.location||"",note:form.note||""};
    setS(s=>({...s,sent:modal.card?s.sent.map(c=>c.id===card.id?card:c):[...s.sent,card]}));
    closeModal();
  }
  function saveCheckin(){
    if(!form.unit?.trim()) return;
    const card={id:form.id||uid(),unit:form.unit.trim(),tt:form.tt||"",hikedFrom:form.customer||"",note:form.note||""};
    setS(s=>{
      const newCI = modal.card ? s.checkins.map(c=>c.id===card.id?card:c) : [...s.checkins,card];
      // If new check-in (hike placed), add unit to yard as awaiting arrival
      if(!modal.card && card.tt){
        const yardExists = (s.yard[card.tt]||[]).find(c=>c.unit===card.unit);
        if(!yardExists){
          const newYardCard = {id:uid(),unit:card.unit,line:"RL",isPuro:false,note:`Hiked from ${card.hikedFrom||"other location"}`,shopDate:"",goingOut:false,wentOut:false,awaitingArrival:true};
          return {...s, checkins:newCI, yard:{...s.yard,[card.tt]:[...(s.yard[card.tt]||[]),newYardCard]}};
        }
      }
      return {...s, checkins:newCI};
    });
    closeModal();
    notify(`Unit ${form.unit.trim()} added to yard as Awaiting Arrival ✓`);
  }

  // ── TASKS ───────────────────────────────────────────────────────────────
  function toggleTask(id){
    setS(s=>{
      const task = s.tasks.find(t=>t.id===id);
      if(!task) return s;
      const nowDone = !task.done;
      // Base: toggle the task
      let ns={...s, tasks:s.tasks.map(t=>t.id===id?{...t,done:nowDone}:t)};
      // If completing a reso check-in task → move unit to yard + remove from reso
      if(nowDone && task.type==="checkin" && task.resoCardId && task.resoTT){
        const tt=task.resoTT;
        // Add to yard as WL (just returned from rental)
        const yardExists=(ns.yard[tt]||[]).find(c=>c.unit===task.unit);
        if(!yardExists){
          ns={...ns,yard:{...ns.yard,[tt]:[...(ns.yard[tt]||[]),
            {id:uid(),unit:task.unit,line:"WL",isPuro:false,note:"Returned from reso",shopDate:"",goingOut:false,wentOut:false}
          ]}};
        }
        // Remove from reso
        ns={...ns,reso:{...ns.reso,[tt]:ns.reso[tt].filter(c=>c.id!==task.resoCardId)}};
      }
      // If un-completing a reso check-in task → restore reso card pending state
      if(!nowDone && task.type==="checkin" && task.resoCardId && task.resoTT){
        const tt=task.resoTT;
        // Remove from yard if it was added
        ns={...ns,yard:{...ns.yard,[tt]:ns.yard[tt].filter(c=>c.unit!==task.unit||c.note!=="Returned from reso")}};
        // Restore reso card (it may have been removed — can't restore if gone, but mark un-pending if still there)
        ns={...ns,reso:{...ns.reso,[tt]:ns.reso[tt].map(c=>c.id===task.resoCardId?{...c,checkInPending:false}:c)}};
      }
      return ns;
    });
  }
  function addTask(text){ if(!text.trim()) return; setS(s=>({...s,tasks:[...s.tasks,{id:uid(),done:false,type:"general",unit:"",text:text.trim()}]})); }
  function delTask(id){ setS(s=>({...s,tasks:s.tasks.filter(t=>t.id!==id)})); }

  // ── REMOVE UNIT EVERYWHERE ──────────────────────────────────────────────
  function removeUnit(u){
    if(!u.trim()) return;
    setS(s=>{
      const y={},r={},t={};
      TRUCK_TYPES.forEach(tt=>{ y[tt]=(s.yard[tt]||[]).filter(c=>c.unit!==u); r[tt]=(s.reso[tt]||[]).filter(c=>c.unit!==u); t[tt]=(s.tomorrow[tt]||[]).filter(c=>c.unit!==u); });
      return {...s,yard:y,reso:r,tomorrow:t,pm:s.pm.filter(c=>c.unit!==u),tasks:s.tasks.filter(c=>c.unit!==u),hikes:s.hikes.filter(c=>c.unit!==u),sent:s.sent.filter(c=>c.unit!==u),checkins:s.checkins.filter(c=>c.unit!==u)};
    });
    notify(`Unit ${u} removed from all sections ✓`);
    setRemoveQ("");
  }

  // ── MODAL HELPERS ────────────────────────────────────────────────────────
  function openModal(type,tt=null,card=null){
    setModal({type,tt,card});
    if(card && type==="yard"){
      // Check both the yard PM list AND the imported PM checklist (pmRows)
    const hasPM=S.pm.find(p=>p.unit===card.unit) || (S.pmRows||[]).find(p=>p.unit===card.unit&&p.status!=="done");
      const hasTom=Object.values(S.tomorrow).flat().find(c=>c.unit===card.unit);
      const hasCI=S.checkins.find(c=>c.unit===card.unit);
      setForm({...card,addPM:!!hasPM,addTomorrow:!!hasTom,addCheckin:!!hasCI,goingOut:!!card.goingOut});
    } else {
      setForm(card?{...card}:{unit:"",line:"RL",isPuro:false,note:"",shopDate:"",returnDate:"",customer:"",pmDate:"",dir:"in",location:"",arrival:"",placed:false,ready:false,pmDue:false,hold:false,addPM:false,addTomorrow:false,addCheckin:false,tt:tt||""});
    }
  }
  function closeModal(){ setModal(null); setForm({}); }
  const sf = k => e => setForm(f=>({...f,[k]:e.target.type==="checkbox"?e.target.checked:e.target.value}));

  // ── STATS ────────────────────────────────────────────────────────────────
  const totalYard  = TRUCK_TYPES.reduce((a,t)=>a+(S.yard[t]||[]).length,0);
  const totalReso  = TRUCK_TYPES.reduce((a,t)=>a+(S.reso[t]||[]).length,0);
  const totalTom   = TRUCK_TYPES.reduce((a,t)=>a+(S.tomorrow[t]||[]).length,0);
  const avail      = TRUCK_TYPES.reduce((a,t)=>a+(S.yard[t]||[]).filter(c=>["RL","WL","SRL"].includes(c.line)&&!c.isPuro&&!c.goingOut).length,0);
  const goingOut   = TRUCK_TYPES.reduce((a,t)=>a+(S.yard[t]||[]).filter(c=>c.goingOut).length,0);
  const tasksDone  = S.tasks.filter(t=>t.done).length;
  const returnAlerts = [];
  TRUCK_TYPES.forEach(tt=>{ (S.reso[tt]||[]).forEach(c=>{ const d=daysUntil(c.returnDate); if(d===0||d===-1||d<0) returnAlerts.push({...c,tt,days:d}); else if(d===1) returnAlerts.push({...c,tt,days:d}); }); });

  // ── SEARCH ───────────────────────────────────────────────────────────────
  const searchResults = !search.trim() ? null : (() => {
    const q=search.trim().toLowerCase(), res=[];
    TRUCK_TYPES.forEach(tt=>{
      (S.yard[tt]||[]).forEach(c=>{ if(c.unit.toLowerCase().includes(q)) res.push({where:"Yard",tt,unit:c.unit,detail:c.line}); });
      (S.reso[tt]||[]).forEach(c=>{ if(c.unit.toLowerCase().includes(q)) res.push({where:"Reso",tt,unit:c.unit,detail:c.returnDate?`Back ${fmtDate(c.returnDate)}`:""}); });
      (S.tomorrow[tt]||[]).forEach(c=>{ if(c.unit.toLowerCase().includes(q)) res.push({where:"Tomorrow",tt,unit:c.unit,detail:c.hold?"HOLD":""}); });
    });
    S.pm.forEach(c=>{ if(c.unit.toLowerCase().includes(q)) res.push({where:"PM",tt:c.tt,unit:c.unit,detail:c.pmDate?fmtDate(c.pmDate):""}); });
    S.hikes.forEach(c=>{ if(c.unit.toLowerCase().includes(q)) res.push({where:`Hike ${c.dir==="in"?"↓":"↑"}`,tt:c.tt,unit:c.unit,detail:c.location}); });
    S.sent.forEach(c=>{ if(c.unit.toLowerCase().includes(q)) res.push({where:"Sent",tt:c.tt,unit:c.unit,detail:c.location}); });
    return res;
  })();

  const TABS = [["dash","📋 Dashboard"],["pm","🔧 PM"],["hikes","✈️ Hikes"],["other","📤 Sent & CI"],["tasks","✅ Tasks"]];

  // ── YARD CARD (reused in both dashboard and yard tab) ────────────────────
  const YardCard = ({card,tt}) => {
    const ls=card.isPuro?LINE.PUR:(LINE[card.line]||LINE.RL);
    // Check both the yard PM list AND the imported PM checklist (pmRows)
    const hasPM=S.pm.find(p=>p.unit===card.unit) || (S.pmRows||[]).find(p=>p.unit===card.unit&&p.status!=="done");
    const hasTom=Object.values(S.tomorrow||{}).flat().find(c=>c.unit===card.unit);

    // Awaiting arrival (inbound hike) — special state
    if(card.awaitingArrival){
      return (
        <div className="ucard" style={{background:"#0f2010",border:"2px dashed #16a34a",color:"#4ade80",position:"relative"}}>
          <div className="unum">{card.unit}</div>
          <div className="usub" style={{color:"#4ade80",opacity:0.7}}>✈️ Awaiting arrival</div>
          {card.note&&<div className="usub">{card.note}</div>}
          <div className="qa-row" onClick={e=>e.stopPropagation()}>
            <button style={{background:"#16a34a",border:"none",borderRadius:4,color:"#0b0e14",fontSize:9,fontWeight:700,padding:"3px 8px",cursor:"pointer",fontFamily:"inherit"}}
              onClick={()=>confirmHikeArrival(tt,card)}>✅ Arrived</button>
          </div>
          <button className="xcbtn" onClick={e=>{e.stopPropagation();setS(s=>({...s,yard:{...s.yard,[tt]:s.yard[tt].filter(c=>c.id!==card.id)}}));}}>✕</button>
        </div>
      );
    }

    const tomEntry = hasTom; // the tomorrow entry for this unit
    return (
      <div className={`ucard ${card.goingOut?"ucard-go":""}`} style={{background:ls.bg,color:ls.text,outline:hasTom&&!card.goingOut?"2px solid #f59e0b":undefined,outlineOffset:hasTom&&!card.goingOut?"1px":undefined}} onClick={()=>openModal("yard",tt,card)}>
        <div className={`unum ${hasPM?"pm-b":""}`}>{card.unit}</div>
        <div className="usub">{card.isPuro?"PURO":card.line}{card.note?" · "+card.note:""}</div>
        {card.shopDate&&<div className="usub">Out: {fmtDate(card.shopDate)}</div>}
        {hasPM&&<div className="usub">🔧 PM sch.</div>}
        {/* Tomorrow strip — shown on card body */}
        {hasTom&&!card.goingOut&&(
          <div style={{marginTop:4,background:"#78350f",border:"1px solid #f59e0b",borderRadius:3,padding:"2px 5px",fontSize:8,color:"#fcd34d",fontWeight:700}}>
            📅 NEEDED TOMORROW{tomEntry?.hold?" · 🔴 HOLD":""}
          </div>
        )}
        {card.goingOut&&(
          <div className="go-strip" style={{background:card.wentOut?"#14532d":undefined,borderColor:card.wentOut?"#16a34a":undefined}}>
            {card.wentOut?"✅ WENT OUT":"🚀 GOING OUT"}{card.returnDate?` · back ${fmtDate(card.returnDate)}`:""}
          </div>
        )}
        <div className="qa-row" onClick={e=>e.stopPropagation()}>
          <button className={`qa-go ${card.goingOut?"on":""}`} onClick={()=>markGoingOut(tt,card)}>{card.goingOut?"✓ Out":"🚀 Out"}</button>
          {card.goingOut&&!card.wentOut&&<button className="qa-btn" style={{background:"#1e3a5f",color:"#93c5fd"}} onClick={()=>openWentOut(tt,card)}>📋 Went Out</button>}
          {card.wentOut&&<span className="qa-badge green">✓ In Reso</span>}
          {/* Hike Out — removes from yard, adds to hikes outbound */}
          {!card.goingOut&&!card.wentOut&&!card.awaitingArrival&&(
            <button className="qa-btn" style={{background:"#4c1d95",color:"#c4b5fd"}} onClick={()=>quickHikeOut(tt,card)}>↑ Hike Out</button>
          )}
          {/* Hike In — marks awaiting arrival, adds to hikes inbound */}
          {!card.awaitingArrival&&(
            <button className="qa-btn" style={{background:"#14532d",color:"#86efac"}} onClick={()=>quickHikeIn(tt,card)}>↓ Hike In</button>
          )}
          {hasPM&&<span className="qa-badge orange">🔧 PM</span>}
        </div>
        <button className="xcbtn" onClick={e=>{e.stopPropagation();setS(s=>({...s,yard:{...s.yard,[tt]:s.yard[tt].filter(c=>c.id!==card.id)}}));}}>✕</button>
      </div>
    );
  };

  // ── RESO CARD (reused) ───────────────────────────────────────────────────
  const ResoCard = ({card,tt}) => {
    const days=daysUntil(card.returnDate);
    const overdue=days!==null&&days<0, urgent=days===0, soon=days===1;
    const cdLabel=days===null?"":overdue?`${Math.abs(days)}d overdue`:urgent?"due TODAY":soon?"due TOMORROW":`${days}d left`;
    const cdColor=overdue||urgent?"#ef4444":soon?"#f59e0b":"#475569";
    return (
      <div className={`reso-card ${urgent||overdue?"r-urgent":soon?"r-soon":""}`} onClick={()=>openModal("reso",tt,card)}>
        <div style={{fontSize:13,fontWeight:700,color:"#93c5fd"}}>{card.unit}</div>
        {card.customer&&<div style={{fontSize:9,color:"#7dd3fc",marginTop:1}}>{card.customer}</div>}
        {card.returnDate&&<div style={{fontSize:9,color:"#64748b",marginTop:2}}>Back {urgent?"TODAY":soon?"TOMORROW":`${fmtDate(card.returnDate)}`}</div>}
        {cdLabel&&<div style={{fontSize:10,fontWeight:700,color:cdColor}}>{cdLabel}</div>}
        {!card.checkInPending&&(
          <button onClick={e=>{e.stopPropagation();checkInFromReso(tt,card);}} className="ci-btn">✅ Add to Daily Tasks</button>
        )}
        {card.checkInPending&&(
          <div className="ci-pending">⏳ In tasks — tick off when unit arrives → moves to yard</div>
        )}
        <button className="xcbtn" onClick={e=>{e.stopPropagation();setS(s=>({...s,reso:{...s.reso,[tt]:s.reso[tt].filter(c=>c.id!==card.id)}}));}}>✕</button>
      </div>
    );
  };

  // ── BOARD GRID (reused) ──────────────────────────────────────────────────
  const BoardGrid = ({data,renderCard,addCard,style={}}) => (
    <div className="grid" style={style}>
      {TRUCK_TYPES.map(tt=>(
        <div key={tt}>
          <div className="col-hdr" title={tt}>{tt}</div>
          <div className="bcol">
            {(data[tt]||[]).map(c=>renderCard(c,tt))}
            {addCard&&<div className="add-btn" onClick={()=>addCard(tt)}>+</div>}
          </div>
        </div>
      ))}
    </div>
  );

  // ── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{fontFamily:"'IBM Plex Mono',monospace",minHeight:"100vh",background:"#0b0e14",color:"#e2e8f0"}}>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;height:4px;}::-webkit-scrollbar-thumb{background:#2d3147;border-radius:2px;}
        input,select,textarea{background:#111827;border:1px solid #1f2937;color:#e2e8f0;border-radius:6px;padding:8px 10px;font-family:inherit;font-size:13px;width:100%;outline:none;transition:border 0.15s;}
        input:focus,select:focus,textarea:focus{border-color:#f59e0b;}
        select option{background:#111827;} textarea{resize:vertical;min-height:56px;}
        .btn{cursor:pointer;border:none;border-radius:6px;font-family:inherit;font-size:12px;font-weight:600;padding:8px 16px;transition:all 0.15s;}
        .btn-amber{background:#f59e0b;color:#0b0e14;}.btn-amber:hover{background:#fbbf24;}
        .btn-ghost{background:transparent;color:#64748b;border:1px solid #1f2937;}.btn-ghost:hover{color:#e2e8f0;border-color:#374151;}
        .btn-green{background:#15803d;color:#dcfce7;}.btn-green:hover{background:#16a34a;}
        .btn-red{background:#7f1d1d;color:#fca5a5;border:1px solid #ef4444;}.btn-red:hover{background:#991b1b;}
        .btn-sm{padding:4px 10px;font-size:11px;}
        .overlay{position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;}
        .modal{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:22px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;}
        .field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px;}
        .field label{font-size:10px;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;}
        .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
        .section-title{font-family:'Bebas Neue',sans-serif;letter-spacing:0.08em;font-size:20px;margin-bottom:4px;}
        .section-sub{font-size:10px;color:#4b5563;margin-bottom:10px;}
        .grid{display:grid;grid-template-columns:repeat(10,minmax(105px,1fr));gap:1px;background:#1f2937;border:1px solid #1f2937;border-radius:8px;overflow:hidden;}
        .col-hdr{font-size:9px;color:#4b5563;text-transform:uppercase;letter-spacing:0.07em;text-align:center;padding:5px 3px;border-bottom:1px solid #1f2937;background:#0d1018;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .bcol{background:#0d1018;padding:6px;min-height:100px;display:flex;flex-direction:column;gap:5px;}
        .ucard{border-radius:7px;padding:7px 8px 5px;cursor:pointer;position:relative;transition:transform 0.1s,box-shadow 0.1s;}
        .ucard:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,0,0,0.5);}
        .ucard-go{outline:2px solid #f97316;outline-offset:1px;box-shadow:0 0 10px #f9731644;}
        .unum{font-size:13px;font-weight:700;line-height:1.2;}.pm-b{text-decoration:underline dotted;text-underline-offset:2px;}
        .usub{font-size:9px;opacity:0.75;margin-top:1px;line-height:1.3;}
        .go-strip{margin-top:4px;background:#431407;border:1px solid #f97316;border-radius:3px;padding:2px 5px;font-size:8px;color:#fdba74;font-weight:700;}
        .qa-row{display:flex;gap:3px;margin-top:5px;flex-wrap:wrap;}
        .qa-go{border:none;border-radius:3px;cursor:pointer;font-size:8px;padding:2px 6px;font-family:inherit;font-weight:700;background:#431407;color:#fb923c;transition:all 0.1s;}
        .qa-go.on{background:#f97316;color:#fff;}
        .qa-btn{border:none;border-radius:3px;cursor:pointer;font-size:8px;padding:2px 6px;font-family:inherit;font-weight:700;background:#1e3a5f;color:#93c5fd;}
        .qa-badge{border-radius:3px;font-size:8px;padding:2px 6px;font-weight:700;display:inline-flex;align-items:center;}
        .qa-badge.green{background:#064e3b;color:#34d399;}.qa-badge.amber{background:#78350f;color:#fcd34d;}.qa-badge.orange{background:#7c2d12;color:#fb923c;}
        .add-btn{background:#111827;border:1px dashed #1f2937;border-radius:6px;color:#374151;font-size:18px;text-align:center;cursor:pointer;padding:6px;user-select:none;transition:all 0.15s;}
        .add-btn:hover{border-color:#f59e0b;color:#f59e0b;}
        .xcbtn{position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.3);border:none;border-radius:3px;cursor:pointer;font-size:9px;padding:1px 4px;color:#9ca3af;}
        .tab{cursor:pointer;padding:8px 14px;font-size:11px;font-weight:600;border:none;background:transparent;color:#6b7280;font-family:inherit;border-bottom:2px solid transparent;transition:all 0.15s;}
        .tab.on{color:#f59e0b;border-bottom:2px solid #f59e0b;}.tab:hover:not(.on){color:#d1d5db;}
        .reso-card{background:#0f1e38;border:1px solid #1e3a5f;border-radius:7px;padding:8px;cursor:pointer;position:relative;transition:transform 0.1s;}
        .reso-card:hover{transform:translateY(-1px);}
        .r-urgent{border-color:#ef4444!important;box-shadow:0 0 8px #ef444433;}
        .r-soon{border-color:#f59e0b!important;}
        .ci-btn{margin-top:6px;width:100%;background:#064e3b;border:1px solid #16a34a;border-radius:4px;color:#4ade80;font-size:9px;font-weight:700;padding:4px;cursor:pointer;font-family:inherit;}
        .ci-btn:hover{background:#065f46;}
        .ci-pending{margin-top:5px;background:#1a2e05;border:1px solid #4ade80;border-radius:4px;color:#86efac;font-size:9px;padding:3px 6px;text-align:center;}
        .tom-card{background:#1c1000;border:1px solid #78350f;border-radius:7px;padding:7px 8px;cursor:pointer;position:relative;}
        .hold-badge{background:#7f1d1d;color:#fca5a5;border-radius:3px;font-size:8px;padding:1px 5px;font-weight:700;display:inline-block;margin-top:3px;}
        .pm-card{background:#1c1500;border:1px solid #92400e;border-radius:7px;padding:9px 11px;cursor:pointer;position:relative;transition:border-color 0.15s;}.pm-card:hover{border-color:#f59e0b;}
        .hike-card{border-radius:8px;padding:10px 12px;position:relative;}
        .hike-in{background:#0a1f12;border:1px solid #166534;}.hike-out{background:#12071e;border:1px solid #6b21a8;}
        .side-card{background:#111827;border:1px solid #1f2937;border-radius:7px;padding:9px 11px;position:relative;transition:border-color 0.15s;cursor:pointer;}.side-card:hover{border-color:#f59e0b;}
        .chk-box{width:16px;height:16px;border-radius:3px;border:2px solid #374151;background:transparent;cursor:pointer;appearance:none;flex-shrink:0;margin-top:2px;transition:all 0.15s;}
        .chk-box:checked{background:#f59e0b;border-color:#f59e0b;}
        .tog{display:flex;align-items:center;gap:7px;cursor:pointer;}
        .tog input[type=checkbox]{width:14px;height:14px;cursor:pointer;accent-color:#f59e0b;}
        .stat-box{text-align:center;}
        .stat-num{font-family:'Bebas Neue',sans-serif;font-size:22px;line-height:1;}
        .stat-lbl{font-size:9px;color:#4b5563;text-transform:uppercase;letter-spacing:0.07em;margin-top:1px;}
        .avail{background:#14532d;border:1px solid #16a34a;border-radius:6px;padding:4px 12px;display:inline-flex;flex-direction:column;align-items:center;}
        .notif{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1f2937;border:1px solid #374151;border-radius:8px;padding:10px 20px;font-size:12px;color:#d1d5db;z-index:200;pointer-events:none;animation:fadein 0.2s;white-space:nowrap;}
        @keyframes fadein{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .alert-bar{background:#450a0a;border-bottom:1px solid #ef4444;padding:6px 18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;}
        .alert-chip{background:#7f1d1d;color:#fca5a5;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;}
        .alert-chip.soon{background:#431407;color:#fdba74;}
        .search-res{display:flex;flex-wrap:wrap;gap:7px;padding:12px 18px;border-bottom:1px solid #1f2937;}
        .search-chip{background:#1f2937;border:1px solid #374151;border-radius:6px;padding:6px 10px;min-width:110px;}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{borderBottom:"1px solid #1f2937",padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:"#f59e0b",letterSpacing:"0.1em"}}>BRANCH OPS</div>
          <div style={{fontSize:10,color:"#4b5563"}}>Day {dayNum} · {dayLabel}</div>
        </div>

        {/* Stats */}
        <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
          {[["Yard",totalYard,"#7dd3fc"],["Reso",totalReso,"#f59e0b"],["Tmrw",totalTom,"#fcd34d"],["PM",(S.pmRows||[]).filter(r=>r.status!=="done").length,"#fb923c"],["Hikes",S.hikes.length,"#67e8f9"]].map(([l,v,c])=>(
            <div key={l} className="stat-box"><div className="stat-num" style={{color:c}}>{v}</div><div className="stat-lbl">{l}</div></div>
          ))}
          <div className="avail">
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#4ade80"}}>{avail}</div>
            <div style={{fontSize:9,color:"#166534",textTransform:"uppercase",letterSpacing:"0.06em"}}>Available</div>
          </div>
          {goingOut>0&&<div className="stat-box"><div className="stat-num" style={{color:"#f97316"}}>{goingOut}</div><div className="stat-lbl">Going Out</div></div>}
          {S.tasks.length>0&&<div className="stat-box"><div className="stat-num" style={{color:tasksDone===S.tasks.length?"#4ade80":"#6b7280"}}>{tasksDone}/{S.tasks.length}</div><div className="stat-lbl">Tasks</div></div>}
        </div>

        {/* Controls */}
        <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
          {/* Search */}
          <div style={{position:"relative"}}>
            <input style={{background:"#111827",border:"1px solid #1f2937",borderRadius:6,padding:"6px 12px",fontFamily:"inherit",fontSize:12,color:"#e2e8f0",outline:"none",width:170}} placeholder="🔍 Search unit #" value={search} onChange={e=>setSearch(e.target.value)}/>
            {search&&<button style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#4b5563",cursor:"pointer"}} onClick={()=>setSearch("")}>✕</button>}
          </div>
          {/* Remove */}
          <div style={{display:"flex",gap:5}}>
            <input style={{background:"#1c0a0a",border:"1px solid #ef444466",borderRadius:6,padding:"6px 10px",fontFamily:"inherit",fontSize:12,color:"#fca5a5",outline:"none",width:130}} placeholder="Unit # remove" value={removeQ} onChange={e=>setRemoveQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&removeQ&&removeUnit(removeQ)}/>
            <button className="btn btn-red btn-sm" onClick={()=>removeQ&&removeUnit(removeQ)}>🗑</button>
          </div>
          {/* History */}
          <button className="btn btn-ghost btn-sm" onClick={()=>setHistOpen(true)}>📅 History {history.length>0?`(${history.length})`:""}</button>
          <button className="btn btn-green btn-sm" onClick={newDay}>🌅 Start Day {dayNum+1}</button>
        </div>
      </div>

      {/* Return Alerts */}
      {returnAlerts.length>0&&(
        <div className="alert-bar">
          <span style={{fontSize:10,color:"#ef4444",fontWeight:700}}>⚠️ RETURNS:</span>
          {returnAlerts.map((a,i)=>(
            <span key={i} className={`alert-chip ${a.days===1?"soon":""}`}>
              #{a.unit} — {a.days<0?`${Math.abs(a.days)}d OVERDUE`:a.days===0?"TODAY":"TOMORROW"} ({fmtDate(a.returnDate)})
            </span>
          ))}
        </div>
      )}

      {/* Search results */}
      {searchResults&&(
        <div className="search-res">
          {searchResults.length===0
            ?<div style={{fontSize:11,color:"#4b5563"}}>No results for "{search}"</div>
            :searchResults.map((r,i)=>(
              <div key={i} className="search-chip">
                <div style={{fontSize:12,fontWeight:700,color:"#e2e8f0"}}>{r.unit}</div>
                <div style={{fontSize:9,color:"#6b7280",marginTop:1}}>{r.where}{r.tt?" · "+r.tt:""}</div>
                {r.detail&&<div style={{fontSize:9,color:"#f59e0b",marginTop:1}}>{r.detail}</div>}
              </div>
            ))
          }
        </div>
      )}

      {/* Legend */}
      <div style={{padding:"5px 18px",borderBottom:"1px solid #1f2937",display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        {Object.entries(LINE).map(([k,v])=>(
          <div key={k} style={{display:"flex",alignItems:"center",gap:4}}>
            <div style={{width:8,height:8,borderRadius:2,background:v.bg,flexShrink:0}}/>
            <span style={{fontSize:9,color:"#6b7280"}}>{k} – {v.label}</span>
          </div>
        ))}
        <span style={{fontSize:9,color:"#6b7280",marginLeft:4}}>· <strong style={{color:"#e2e8f0",textDecoration:"underline dotted"}}>underline</strong> = PM due</span>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",padding:"0 18px",borderBottom:"1px solid #1f2937",overflowX:"auto"}}>
        {TABS.map(([id,label])=>(
          <button key={id} className={`tab ${tab===id?"on":""}`} onClick={()=>setTab(id)}>{label}</button>
        ))}
      </div>

      <div style={{padding:"16px 18px",overflowX:"auto"}}>

        {/* ══ DASHBOARD ══ */}
        {tab==="dash"&&(
          <div style={{display:"flex",flexDirection:"column",gap:28}}>

            {/* MY YARD TODAY */}
            <div>
              <div className="section-title" style={{color:"#e2e8f0"}}>MY YARD TODAY</div>
              <div className="section-sub">Tap card to edit · 🚀 Out = going out today → Went Out moves to Reso</div>
              <BoardGrid
                data={S.yard}
                renderCard={(card,tt)=><YardCard key={card.id} card={card} tt={tt}/>}
                addCard={tt=>openModal("yard",tt)}
              />
            </div>

            {/* SHORT TERM RESO */}
            <div>
              <div className="section-title" style={{color:"#93c5fd"}}>SHORT TERM RESO</div>
              <div className="section-sub">Carries forward daily · Check In returns unit to yard as WL</div>
              <BoardGrid
                data={S.reso}
                style={{background:"#0d1822",borderColor:"#1e3a5f"}}
                renderCard={(card,tt)=><ResoCard key={card.id} card={card} tt={tt}/>}
                addCard={tt=>openModal("reso",tt)}
              />
            </div>

            {/* NEED FOR TOMORROW */}
            <div>
              <div className="section-title" style={{color:"#fcd34d"}}>NEED FOR TOMORROW</div>
              <div className="section-sub">🔴 HOLD = reserved for reso — do not give out</div>
              <div className="grid" style={{background:"#1c1000",borderColor:"#78350f"}}>
                {TRUCK_TYPES.map(tt=>(
                  <div key={tt}>
                    <div className="col-hdr" style={{background:"#110a00",borderBottom:"1px solid #78350f",color:"#92400e"}} title={tt}>{tt}</div>
                    <div className="bcol" style={{background:"#0d0700"}}>
                      {(S.tomorrow[tt]||[]).map(card=>(
                        <div key={card.id} className="tom-card" onClick={()=>openModal("tomorrow",tt,card)}>
                          <div style={{fontSize:13,fontWeight:700,color:"#fcd34d"}}>{card.unit}</div>
                          {card.note&&<div style={{fontSize:9,color:"#92400e",marginTop:1}}>{card.note}</div>}
                          {card.hold?<span className="hold-badge">🔴 HOLD</span>:<span style={{fontSize:8,color:"#78350f",display:"inline-block",marginTop:2}}>available</span>}
                          <div style={{marginTop:4}} onClick={e=>e.stopPropagation()}>
                            <label className="tog">
                              <input type="checkbox" checked={!!card.hold} onChange={()=>toggleHold(tt,card.id)}/>
                              <span style={{fontSize:9,color:"#92400e"}}>Hold for reso</span>
                            </label>
                          </div>
                          <button className="xcbtn" onClick={e=>{e.stopPropagation();setS(s=>({...s,tomorrow:{...s.tomorrow,[tt]:s.tomorrow[tt].filter(c=>c.id!==card.id)}}));}}>✕</button>
                        </div>
                      ))}
                      <div className="add-btn" style={{borderColor:"#78350f",color:"#78350f"}} onClick={()=>openModal("tomorrow",tt)}>+</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── SERVICE / SHOP ── */}
            {(() => {
              const serviceUnits = TRUCK_TYPES.flatMap(tt =>
                (S.yard[tt]||[]).filter(c=>c.line==="SL"||c.line==="SHOP").map(c=>({...c,tt})) // SRL excluded — it's ready
              );
              if(serviceUnits.length===0) return null;
              return (
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:8,marginBottom:8}}>
                    <div>
                      <div className="section-title" style={{color:"#f87171"}}>🔧 SUB & DEAD — SERVICE PROGRESS</div>
                      <div className="section-sub">SL = Service Line · SHOP = In shop/deadline · set ready date · mark done when fixed</div>
                    </div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#f87171"}}>{serviceUnits.length} unit{serviceUnits.length!==1?"s":""}</div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {serviceUnits.map(card=>{
                      const ls=card.line==="SHOP"?LINE.SHOP:LINE.SL;
                      const daysLeft=card.shopDate?daysUntil(card.shopDate):null;
                      const overdue=daysLeft!==null&&daysLeft<0;
                      const today=daysLeft===0;
                      return (
                        <div key={card.id} style={{background:"#111827",border:`1px solid ${overdue?"#ef4444":today?"#f59e0b":card.line==="SHOP"?"#374151":"#7f1d1d"}`,borderRadius:9,padding:"12px 14px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                          {/* Line badge */}
                          <div style={{background:ls.bg,color:ls.text,borderRadius:5,padding:"3px 10px",fontSize:11,fontWeight:700,flexShrink:0}}>{card.line}</div>
                          {/* Unit + truck type */}
                          <div>
                            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:card.line==="SHOP"?"#9ca3af":"#f87171"}}>{card.unit}</div>
                            <div style={{fontSize:9,color:"#4b5563"}}>{card.tt}</div>
                          </div>
                          {/* Note */}
                          {card.note&&<div style={{fontSize:11,color:"#6b7280",flex:1}}>{card.note}</div>}
                          {/* Ready date picker */}
                          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                            <span style={{fontSize:10,color:"#4b5563"}}>Ready date:</span>
                            <input
                              type="date"
                              value={card.shopDate||""}
                              onChange={e=>{
                                const val=e.target.value;
                                setS(s=>({...s,yard:{...s.yard,[card.tt]:s.yard[card.tt].map(c=>c.id===card.id?{...c,shopDate:val}:c)}}));
                              }}
                              onClick={e=>e.stopPropagation()}
                              style={{background:"#1f2937",border:"1px solid #374151",color:"#e2e8f0",borderRadius:5,padding:"4px 8px",fontFamily:"inherit",fontSize:11,outline:"none"}}
                            />
                          </div>
                          {/* Countdown */}
                          {daysLeft!==null&&(
                            <div style={{background:overdue?"#7f1d1d":today?"#78350f":"#1f2937",color:overdue?"#fca5a5":today?"#f59e0b":"#6b7280",borderRadius:5,padding:"3px 10px",fontSize:11,fontWeight:700,flexShrink:0}}>
                              {overdue?`${Math.abs(daysLeft)}d overdue`:today?"Ready TODAY":`${daysLeft}d left`}
                            </div>
                          )}
                          {/* Mark fixed — moves to RL */}
                          <button
                            onClick={()=>{
                              setS(s=>({...s,yard:{...s.yard,[card.tt]:s.yard[card.tt].map(c=>c.id===card.id?{...c,line:"SRL",note:"Fixed — Service Ready",shopDate:""}:c)}}));
                              notify(`Unit ${card.unit} marked fixed — moved to SRL ✓`);
                            }}
                            style={{background:"#1e293b",border:"1px solid #94a3b8",color:"#f1f5f9",borderRadius:5,padding:"4px 10px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
                            ✓ Fixed → SRL
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ── PUROLATOR ── */}
            {(() => {
              const puroUnits = TRUCK_TYPES.flatMap(tt =>
                (S.yard[tt]||[]).filter(c=>c.isPuro).map(c=>({...c,tt}))
              );
              const puroReso = TRUCK_TYPES.flatMap(tt =>
                (S.reso[tt]||[]).filter(c=>c.customer&&c.customer.toUpperCase().includes("PURO")).map(c=>({...c,tt}))
              );
              if(puroUnits.length===0&&puroReso.length===0) return null;
              return (
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:8,marginBottom:8}}>
                    <div>
                      <div className="section-title" style={{color:"#a855f7"}}>🟣 PUROLATOR UNITS</div>
                      <div className="section-sub">All Purolator units on yard + in reso at a glance</div>
                    </div>
                    <div style={{display:"flex",gap:12}}>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#a855f7"}}>{puroUnits.length}</div>
                        <div style={{fontSize:9,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.06em"}}>On Yard</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#7dd3fc"}}>{puroReso.length}</div>
                        <div style={{fontSize:9,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.06em"}}>In Reso</div>
                      </div>
                    </div>
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                    {puroUnits.map(card=>(
                      <div key={card.id} style={{background:"#1a0a2e",border:"1px solid #7c3aed",borderRadius:8,padding:"10px 14px",minWidth:140}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                          <div style={{width:8,height:8,borderRadius:"50%",background:"#a855f7"}}/>
                          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#c4b5fd"}}>{card.unit}</span>
                        </div>
                        <div style={{fontSize:9,color:"#6b21a8"}}>{card.tt}</div>
                        <div style={{fontSize:9,color:"#7c3aed",marginTop:2}}>{card.line} · On Yard</div>
                        {card.note&&<div style={{fontSize:9,color:"#4b5563",marginTop:2}}>{card.note}</div>}
                      </div>
                    ))}
                    {puroReso.map(card=>(
                      <div key={card.id} style={{background:"#0f0a1e",border:"1px solid #4c1d95",borderRadius:8,padding:"10px 14px",minWidth:140,opacity:0.85}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                          <div style={{width:8,height:8,borderRadius:"50%",background:"#7c3aed"}}/>
                          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#a78bfa"}}>{card.unit}</span>
                        </div>
                        <div style={{fontSize:9,color:"#6b21a8"}}>{card.tt}</div>
                        <div style={{fontSize:9,color:"#7c3aed",marginTop:2}}>In Reso · back {fmtDate(card.returnDate)}</div>
                        {card.customer&&<div style={{fontSize:9,color:"#4b5563",marginTop:2}}>{card.customer}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

          </div>
        )}

        {/* ══ PM ══ */}
        {tab==="pm"&&(
          <PMTab S={S} setS={setS_} notify={notify} openModal={openModal}/>
        )}

                {/* ══ HIKES ══ */}
        {tab==="hikes"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div><div className="section-title" style={{color:"#67e8f9"}}>HIKE TRACKER</div><div className="section-sub">↓ Inbound = coming to you · ↑ Outbound = sent out</div></div>
              <button className="btn btn-amber btn-sm" onClick={()=>openModal("hike")}>+ Add Hike</button>
            </div>
            {S.hikes.length===0&&<div style={{color:"#374151",fontSize:12,padding:"24px 0",textAlign:"center"}}>No hikes tracked</div>}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
              {S.hikes.map(h=>(
                <div key={h.id} className={`hike-card ${h.dir==="in"?"hike-in":"hike-out"}`}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <span style={{fontSize:15,fontWeight:700,color:h.dir==="in"?"#4ade80":"#c084fc"}}>{h.unit}</span>
                      <span style={{fontSize:9,marginLeft:6,color:h.dir==="in"?"#166534":"#6b21a8",background:h.dir==="in"?"#d1fae511":"#f3e8ff11",padding:"1px 5px",borderRadius:3}}>{h.dir==="in"?"↓ IN":"↑ OUT"}</span>
                    </div>
                    <button className="xcbtn" style={{position:"static"}} onClick={()=>setS(s=>({...s,hikes:s.hikes.filter(x=>x.id!==h.id)}))}>✕</button>
                  </div>
                  <div style={{fontSize:9,color:"#6b7280",marginTop:3}}>{h.tt}</div>
                  {h.location&&<div style={{fontSize:10,color:"#9ca3af",marginTop:2}}>{h.dir==="in"?"From":"To"}: {h.location}</div>}
                  {h.arrival&&<div style={{fontSize:10,color:"#f59e0b",marginTop:2}}>📅 {fmtDate(h.arrival)}</div>}
                  {h.note&&<div style={{fontSize:9,color:"#4b5563",marginTop:3}}>{h.note}</div>}
                  <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:4}}>
                    {[["placed","Hike Placed","#4ade80"],["ready","Unit Ready","#7dd3fc"],["pmDue","PM Due","#fb923c"]].map(([f,l,c])=>(
                      <label key={f} className="tog">
                        <input type="checkbox" checked={!!h[f]} onChange={()=>toggleHikeField(h.id,f)}/>
                        <span style={{fontSize:10,color:h[f]?c:"#4b5563",fontWeight:h[f]?"600":"400"}}>{l}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ SENT & CI ══ */}
        {tab==="other"&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,maxWidth:800}}>
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div><div className="section-title" style={{fontSize:17,color:"#a78bfa"}}>NON-REV'D UNITS</div><div className="section-sub">Sent to other locations</div></div>
                <button className="btn btn-amber btn-sm" onClick={()=>openModal("sent")}>+ Add</button>
              </div>
              {S.sent.length===0&&<div style={{color:"#374151",fontSize:12,padding:"20px 0",textAlign:"center"}}>None sent out</div>}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {S.sent.map(card=>(
                  <div key={card.id} className="side-card" onClick={()=>openModal("sent",null,card)}>
                    <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:13,fontWeight:700,color:"#a78bfa"}}>{card.unit}</span><span style={{fontSize:9,color:"#6b7280"}}>{card.tt}</span></div>
                    {card.location&&<div style={{fontSize:10,color:"#7c3aed",marginTop:2}}>→ {card.location}</div>}
                    {card.note&&<div style={{fontSize:9,color:"#4b5563",marginTop:2}}>{card.note}</div>}
                    <button className="xcbtn" onClick={e=>{e.stopPropagation();setS(s=>({...s,sent:s.sent.filter(c=>c.id!==card.id)}));}}>✕</button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div><div className="section-title" style={{fontSize:17,color:"#34d399"}}>CHECK IN'S</div><div className="section-sub">Off contract — auto-added via CI action</div></div>
                <button className="btn btn-amber btn-sm" onClick={()=>openModal("checkin")}>+ Add</button>
              </div>
              {S.checkins.length===0&&<div style={{color:"#374151",fontSize:12,padding:"20px 0",textAlign:"center"}}>No check-ins</div>}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {S.checkins.map(card=>(
                  <div key={card.id} className="side-card" style={{borderColor:"#064e3b"}} onClick={()=>openModal("checkin",null,card)}>
                    <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:13,fontWeight:700,color:"#34d399"}}>{card.unit}</span><span style={{fontSize:9,color:"#6b7280"}}>{card.tt}</span></div>
                    {(card.hikedFrom||card.customer)&&<div style={{fontSize:10,color:"#059669",marginTop:2}}>✈️ From: {card.hikedFrom||card.customer}</div>}
                    {card.note&&<div style={{fontSize:9,color:"#4b5563",marginTop:2}}>{card.note}</div>}
                    <button className="xcbtn" onClick={e=>{e.stopPropagation();setS(s=>({...s,checkins:s.checkins.filter(c=>c.id!==card.id)}));}}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══ TASKS ══ */}
        {tab==="tasks"&&(
          <div style={{maxWidth:600}}>
            <div className="section-title" style={{color:"#a3e635",marginBottom:4}}>DAILY TASKS</div>
            <div className="section-sub">Return reminders auto-appear · check-ins auto-added via CI action</div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              <input placeholder="Add a task..." value={taskInput} onChange={e=>setTaskInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){addTask(taskInput);setTaskInput("");}}}/>
              <button className="btn btn-amber" style={{flexShrink:0,padding:"8px 14px"}} onClick={()=>{addTask(taskInput);setTaskInput("");}}>Add</button>
            </div>
            {S.tasks.length===0&&<div style={{color:"#374151",fontSize:12,padding:"20px 0",textAlign:"center"}}>No tasks yet</div>}
            {[["overdue","🚨 Overdue Units","#ef4444"],["return","⚠️ Return Reminders","#f59e0b"],["pm","🔧 PM Reminders","#fb923c"],["pm-swap","🔄 Swap Checks","#f59e0b"],["checkin","✅ Check In Tasks","#34d399"],["general","General","#6b7280"]].map(([type,label,color])=>{
              const group=S.tasks.filter(t=>t.type===type);
              if(group.length===0) return null;
              return (
                <div key={type} style={{marginBottom:16}}>
                  <div style={{fontSize:10,color,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{label}</div>
                  {group.map(t=>(
                    <div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 0",borderBottom:"1px solid #1f2937"}}>
                      <input type="checkbox" className="chk-box" checked={t.done} onChange={()=>toggleTask(t.id)}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,color:t.done?"#374151":"#e2e8f0",textDecoration:t.done?"line-through":"none"}}>
                          {t.unit&&<span style={{color:"#f59e0b",marginRight:5,fontWeight:700}}>#{t.unit}</span>}
                          {t.text}
                        </div>
                      </div>
                      <button style={{background:"none",border:"none",color:"#374151",cursor:"pointer",fontSize:11}} onClick={()=>delTask(t.id)}>✕</button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* ══ WENT OUT MODAL ══ */}
      {goModal&&(
        <div className="overlay" onClick={()=>setGoModal(null)}>
          <div className="modal" style={{background:"#1c0800",border:"1px solid #f97316",maxWidth:360}} onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#f97316",marginBottom:4}}>WENT OUT — #{goModal.card.unit}</div>
            <div style={{fontSize:10,color:"#92400e",marginBottom:16}}>{goModal.tt} · unit left the yard · will move to Short Term Reso</div>
            <div className="field"><label>Customer</label><input placeholder="Customer name" value={goForm.customer} onChange={e=>setGoForm(f=>({...f,customer:e.target.value}))}/></div>
            <div className="field">
              <label>Return Date <span style={{color:"#78350f"}}>(default 2 weeks)</span></label>
              <input type="date" value={goForm.returnDate} onChange={e=>setGoForm(f=>({...f,returnDate:e.target.value}))}/>
            </div>
            <div style={{background:"#0b0e14",borderRadius:6,padding:"8px 10px",fontSize:10,color:"#4b5563",marginBottom:14}}>
              Unit removed from yard · added to Short Term Reso · return reminder auto-added on due date
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn btn-ghost" onClick={()=>setGoModal(null)}>Cancel</button>
              <button className="btn" style={{background:"#ea580c",color:"#fff7ed"}} onClick={confirmWentOut}>Confirm Went Out</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MAIN MODAL ══ */}
      {modal&&(
        <div className="overlay" onClick={closeModal}>
          <div className="modal" onClick={e=>e.stopPropagation()}>

            {modal.type==="yard"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#f59e0b",marginBottom:14}}>{modal.card?"EDIT":"ADD"} UNIT — {modal.tt}</div>
              <div className="row2">
                <div className="field"><label>Unit #</label><input placeholder="e.g. 529835" value={form.unit||""} onChange={sf("unit")}/></div>
                <div className="field"><label>Line</label>
                  <select value={form.line||"RL"} onChange={sf("line")}>
                    <option value="RL">RL – Ready Line</option>
                    <option value="WL">WL – Wash Line</option>
                    <option value="SRL">SRL – Service Ready Line</option>
                    <option value="SL">SL – Service Line</option>
                    <option value="SHOP">SHOP – Shop/Deadline</option>
                  </select>
                </div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
                {[["isPuro","Purolator unit","#a855f7"],["addTomorrow","📅 Need Tomorrow","#fcd34d"],["addPM","🔧 PM Due","#fb923c"],["addCheckin","✅ Check In","#34d399"]].map(([k,l,c])=>(
                  <label key={k} className="tog" style={{background:"#111827",border:"1px solid #1f2937",borderRadius:6,padding:"6px 10px",cursor:"pointer"}}>
                    <input type="checkbox" checked={!!form[k]} onChange={sf(k)}/>
                    <span style={{fontSize:11,color:form[k]?c:"#6b7280"}}>{l}</span>
                  </label>
                ))}
              </div>
              {/* Hike actions — mutually exclusive */}
              <div style={{marginBottom:12}}>
                <div style={{fontSize:10,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>Hike</div>
                <div style={{display:"flex",gap:8}}>
                  <label className="tog" style={{flex:1,background:form.hikeOut?"#2e1065":"#111827",border:`1px solid ${form.hikeOut?"#7c3aed":"#1f2937"}`,borderRadius:6,padding:"8px 10px",cursor:"pointer"}}
                    onClick={()=>setForm(f=>({...f,hikeOut:!f.hikeOut,hikeIn:false}))}>
                    <input type="checkbox" checked={!!form.hikeOut} onChange={()=>{}} style={{accentColor:"#a855f7"}}/>
                    <span style={{fontSize:11,color:form.hikeOut?"#c4b5fd":"#6b7280"}}>↑ Hike Out</span>
                  </label>
                  <label className="tog" style={{flex:1,background:form.hikeIn?"#052e16":"#111827",border:`1px solid ${form.hikeIn?"#16a34a":"#1f2937"}`,borderRadius:6,padding:"8px 10px",cursor:"pointer"}}
                    onClick={()=>setForm(f=>({...f,hikeIn:!f.hikeIn,hikeOut:false}))}>
                    <input type="checkbox" checked={!!form.hikeIn} onChange={()=>{}} style={{accentColor:"#4ade80"}}/>
                    <span style={{fontSize:11,color:form.hikeIn?"#86efac":"#6b7280"}}>↓ Hike In</span>
                  </label>
                </div>
                {form.hikeOut&&<div style={{fontSize:10,color:"#a855f7",marginTop:5,padding:"5px 8px",background:"#1a0a2e",borderRadius:5}}>Unit will be removed from yard and added to Hikes ↑ outbound</div>}
                {form.hikeIn&&<div style={{fontSize:10,color:"#4ade80",marginTop:5,padding:"5px 8px",background:"#0a1f12",borderRadius:5}}>Unit will stay on yard as Awaiting Arrival and added to Hikes ↓ inbound</div>}
              </div>
              {form.line==="SHOP"&&<div className="field"><label>Expected Out</label><input type="date" value={form.shopDate||""} onChange={sf("shopDate")}/></div>}
              <div className="field"><label>Note</label><textarea placeholder="Any notes..." value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={saveYard}>{modal.card?"Save":"Add Unit"}</button>
              </div>
            </>}

            {modal.type==="reso"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#93c5fd",marginBottom:14}}>{modal.card?"EDIT":"ADD"} RESO — {modal.tt}</div>
              <div className="field"><label>Unit #</label><input value={form.unit||""} onChange={sf("unit")}/></div>
              <div className="field"><label>Customer</label><input value={form.customer||""} onChange={sf("customer")}/></div>
              <div className="field"><label>Return Date</label><input type="date" value={form.returnDate||""} onChange={sf("returnDate")}/></div>
              <div className="field"><label>Note</label><textarea value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={saveReso}>{modal.card?"Save":"Add"}</button>
              </div>
            </>}

            {modal.type==="tomorrow"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#fcd34d",marginBottom:14}}>{modal.card?"EDIT":"ADD"} TOMORROW — {modal.tt}</div>
              <div className="field"><label>Unit #</label><input value={form.unit||""} onChange={sf("unit")}/></div>
              <label className="tog" style={{marginBottom:12,display:"flex"}}>
                <input type="checkbox" checked={!!form.hold} onChange={sf("hold")}/>
                <span style={{fontSize:12,color:"#fca5a5"}}>🔴 Hold — do not give out</span>
              </label>
              <div className="field"><label>Note</label><textarea value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={saveTomorrow}>{modal.card?"Save":"Add"}</button>
              </div>
            </>}

            {modal.type==="pm"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#fb923c",marginBottom:14}}>{modal.card?"EDIT":"SCHEDULE"} PM</div>
              <div className="row2">
                <div className="field"><label>Unit #</label><input value={form.unit||""} onChange={sf("unit")}/></div>
                <div className="field"><label>Truck Type</label>
                  <select value={form.tt||""} onChange={sf("tt")}>
                    <option value="">Select...</option>
                    {TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="field"><label>PM Date</label><input type="date" value={form.pmDate||""} onChange={sf("pmDate")}/></div>
              <div className="field"><label>Note</label><textarea value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={savePM}>{modal.card?"Save":"Schedule"}</button>
              </div>
            </>}

            {modal.type==="hike"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#67e8f9",marginBottom:14}}>{modal.card?"EDIT":"ADD"} HIKE</div>
              <div className="row2">
                <div className="field"><label>Unit #</label><input value={form.unit||""} onChange={sf("unit")}/></div>
                <div className="field"><label>Direction</label>
                  <select value={form.dir||"in"} onChange={sf("dir")}>
                    <option value="in">↓ Inbound</option>
                    <option value="out">↑ Outbound</option>
                  </select>
                </div>
              </div>
              <div className="row2">
                <div className="field"><label>Truck Type</label>
                  <select value={form.tt||""} onChange={sf("tt")}>
                    <option value="">Select...</option>
                    {TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field"><label>{form.dir==="out"?"To":"From"} Location</label><input value={form.location||""} onChange={sf("location")}/></div>
              </div>
              <div className="field"><label>Expected Date</label><input type="date" value={form.arrival||""} onChange={sf("arrival")}/></div>
              <div style={{display:"flex",gap:12,marginBottom:10,flexWrap:"wrap"}}>
                {[["placed","Hike Placed"],["ready","Unit Ready"],["pmDue","PM Due"]].map(([k,l])=>(
                  <label key={k} className="tog">
                    <input type="checkbox" checked={!!form[k]} onChange={sf(k)}/>
                    <span style={{fontSize:12,color:"#9ca3af"}}>{l}</span>
                  </label>
                ))}
              </div>
              {form.pmDue&&<div style={{fontSize:10,color:"#fb923c",marginBottom:10,background:"#1c1500",borderRadius:5,padding:"6px 10px"}}>⚠️ PM Due auto-adds to PM Schedule</div>}
              <div className="field"><label>Note</label><textarea value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={saveHike}>{modal.card?"Save":"Add Hike"}</button>
              </div>
            </>}

            {modal.type==="sent"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#a78bfa",marginBottom:14}}>{modal.card?"EDIT":"ADD"} NON-REV'D</div>
              <div className="row2">
                <div className="field"><label>Unit #</label><input value={form.unit||""} onChange={sf("unit")}/></div>
                <div className="field"><label>Truck Type</label>
                  <select value={form.tt||""} onChange={sf("tt")}>
                    <option value="">Select...</option>
                    {TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="field"><label>Sent To</label><input value={form.location||""} onChange={sf("location")}/></div>
              <div className="field"><label>Note</label><textarea value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={saveSent}>{modal.card?"Save":"Add"}</button>
              </div>
            </>}

            {modal.type==="checkin"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#34d399",marginBottom:14}}>{modal.card?"EDIT":"ADD"} CHECK IN</div>
              <div className="row2">
                <div className="field"><label>Unit #</label><input value={form.unit||""} onChange={sf("unit")}/></div>
                <div className="field"><label>Truck Type</label>
                  <select value={form.tt||""} onChange={sf("tt")}>
                    <option value="">Select...</option>
                    {TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="field"><label>Hiked From</label><input placeholder="e.g. Concord" value={form.customer||""} onChange={sf("customer")}/></div>
              <div className="field"><label>Note</label><textarea value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={saveCheckin}>{modal.card?"Save":"Add"}</button>
              </div>
            </>}

          </div>
        </div>
      )}

      {/* ══ HIKE IN SOURCE MODAL ══ */}
      {hikeInModal&&(
        <div className="overlay" onClick={()=>setHikeInModal(null)}>
          <div className="modal" style={{background:"#0a1f12",border:"1px solid #16a34a",maxWidth:340}} onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#4ade80",marginBottom:4}}>HIKE IN — #{hikeInModal.card.unit}</div>
            <div style={{fontSize:10,color:"#166534",marginBottom:14}}>{hikeInModal.tt} · where is this unit coming from?</div>
            <div className="field">
              <label>Coming From</label>
              <input
                placeholder="e.g. Concord, Belfield..."
                value={hikeInFrom}
                onChange={e=>setHikeInFrom(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&confirmHikeIn()}
                autoFocus
              />
            </div>
            <div style={{fontSize:10,color:"#4b5563",marginBottom:14,padding:"6px 8px",background:"#0b0e14",borderRadius:5}}>
              Unit stays on yard as Awaiting Arrival · added to Hikes ↓ inbound
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn btn-ghost" onClick={()=>setHikeInModal(null)}>Cancel</button>
              <button className="btn" style={{background:"#16a34a",color:"#f0fdf4"}} onClick={confirmHikeIn}>Confirm Hike In</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ HIKE OUT DESTINATION MODAL ══ */}
      {hikeOutModal&&(
        <div className="overlay" onClick={()=>setHikeOutModal(null)}>
          <div className="modal" style={{background:"#12071e",border:"1px solid #7c3aed",maxWidth:340}} onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#c4b5fd",marginBottom:4}}>HIKE OUT — #{hikeOutModal.card.unit}</div>
            <div style={{fontSize:10,color:"#6b21a8",marginBottom:14}}>{hikeOutModal.tt} · where is this unit going?</div>
            <div className="field">
              <label>Destination Location</label>
              <input
                placeholder="e.g. Concord, Belfield..."
                value={hikeOutDest}
                onChange={e=>setHikeOutDest(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&confirmHikeOut()}
                autoFocus
              />
            </div>
            <div style={{fontSize:10,color:"#4b5563",marginBottom:14,padding:"6px 8px",background:"#0b0e14",borderRadius:5}}>
              Unit will be removed from yard · added to Hikes ↑ and Sent Out
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn btn-ghost" onClick={()=>setHikeOutModal(null)}>Cancel</button>
              <button className="btn" style={{background:"#7c3aed",color:"#f5f3ff"}} onClick={confirmHikeOut}>Confirm Hike Out</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {notification&&<div className="notif">{notification}</div>}

      {/* ══ HISTORY LIST MODAL ══ */}
      {histOpen&&!historyViewDay&&(
        <div className="overlay" onClick={()=>setHistOpen(false)}>
          <div className="modal" style={{maxWidth:520,maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#f59e0b",letterSpacing:"0.08em"}}>OPERATIONS HISTORY</div>
              <button onClick={()=>setHistOpen(false)} style={{background:"none",border:"none",color:"#4b5563",cursor:"pointer",fontSize:18}}>✕</button>
            </div>
            {history.length===0&&(
              <div style={{textAlign:"center",padding:"32px 0",color:"#374151",fontSize:12}}>
                No history yet — hit 🌅 New Day to save today's operations
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[...history].reverse().map(h=>{
                const yardTotal = TRUCK_TYPES.reduce((a,t)=>a+(h.snap.yard[t]||[]).length,0);
                const resoTotal = TRUCK_TYPES.reduce((a,t)=>a+(h.snap.reso[t]||[]).length,0);
                const wentOut   = TRUCK_TYPES.reduce((a,t)=>a+(h.snap.yard[t]||[]).filter(c=>c.wentOut).length,0);
                const tasksDone = (h.snap.tasks||[]).filter(t=>t.done).length;
                const tasksTotal= (h.snap.tasks||[]).length;
                const pmDone    = (h.snap.pmRows||[]).filter(r=>r.status==="done").length;
                return (
                  <div key={h.dayNum} style={{background:"#1f2937",border:"1px solid #374151",borderRadius:9,padding:"12px 14px",cursor:"pointer",transition:"border-color 0.15s"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor="#f59e0b"}
                    onMouseLeave={e=>e.currentTarget.style.borderColor="#374151"}
                    onClick={()=>{setHistoryViewDay(h);setHistOpen(false);}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#f59e0b"}}>Day {h.dayNum}</div>
                        <div style={{fontSize:11,color:"#6b7280",marginTop:1}}>{h.label}</div>
                      </div>
                      <span style={{fontSize:10,color:"#f59e0b",marginTop:4}}>View →</span>
                    </div>
                    <div style={{display:"flex",gap:16,marginTop:10,flexWrap:"wrap"}}>
                      {[
                        ["🚛 On Yard", yardTotal, "#7dd3fc"],
                        ["📋 In Reso", resoTotal, "#f59e0b"],
                        ["🚀 Went Out", wentOut, "#f97316"],
                        ["✅ Tasks", `${tasksDone}/${tasksTotal}`, tasksDone===tasksTotal&&tasksTotal>0?"#4ade80":"#6b7280"],
                        ["🔧 PM Done", pmDone, "#fb923c"],
                      ].map(([l,v,c])=>(
                        <div key={l} style={{textAlign:"center"}}>
                          <div style={{fontSize:14,fontWeight:700,color:c}}>{v}</div>
                          <div style={{fontSize:9,color:"#4b5563"}}>{l}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══ HISTORY DAY DETAIL MODAL ══ */}
      {historyViewDay&&(
        <div className="overlay" onClick={()=>setHistoryViewDay(null)}>
          <div style={{background:"#0b0e14",border:"1px solid #1f2937",borderRadius:12,width:"100%",maxWidth:980,maxHeight:"92vh",overflowY:"auto",padding:20}} onClick={e=>e.stopPropagation()}>
            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,paddingBottom:12,borderBottom:"1px solid #1f2937"}}>
              <div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#f59e0b",letterSpacing:"0.08em"}}>DAY {historyViewDay.dayNum} — SNAPSHOT</div>
                <div style={{fontSize:11,color:"#4b5563",marginTop:2}}>{historyViewDay.label} · read-only</div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={()=>{setHistoryViewDay(null);setHistOpen(true);}} style={{background:"#1f2937",border:"1px solid #374151",color:"#9ca3af",borderRadius:6,padding:"5px 12px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
                <button onClick={()=>setHistoryViewDay(null)} style={{background:"none",border:"none",color:"#4b5563",cursor:"pointer",fontSize:18}}>✕</button>
              </div>
            </div>

            {(() => {
              const h = historyViewDay.snap;
              const LINE_H = { RL:{bg:"#84cc16",text:"#1a2e05"}, WL:{bg:"#7dd3fc",text:"#0c2a3e"}, SRL:{bg:"#f1f5f9",text:"#0f172a"}, SL:{bg:"#f87171",text:"#3b0a0a"}, SHOP:{bg:"#374151",text:"#f9fafb"}, PUR:{bg:"#a855f7",text:"#f5f3ff"} };

              const Section = ({title,color,children}) => (
                <div style={{marginBottom:20}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:color||"#e2e8f0",letterSpacing:"0.06em",marginBottom:8,paddingBottom:4,borderBottom:"1px solid #1f2937"}}>{title}</div>
                  {children}
                </div>
              );

              const yardUnits = TRUCK_TYPES.flatMap(tt=>(h.yard[tt]||[]).map(c=>({...c,tt})));
              const resoUnits = TRUCK_TYPES.flatMap(tt=>(h.reso[tt]||[]).map(c=>({...c,tt})));
              const tomUnits  = TRUCK_TYPES.flatMap(tt=>(h.tomorrow[tt]||[]).map(c=>({...c,tt})));
              const tasks     = h.tasks||[];
              const pmRows    = h.pmRows||[];
              const hikes     = h.hikes||[];
              const sent      = h.sent||[];

              return (
                <div>
                  {/* Yard */}
                  <Section title={`🚛 My Yard (${yardUnits.length} units)`} color="#7dd3fc">
                    {yardUnits.length===0?<div style={{fontSize:11,color:"#374151"}}>No units on yard</div>:(
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {yardUnits.map(c=>{
                          const ls=c.isPuro?LINE_H.PUR:(LINE_H[c.line]||LINE_H.RL);
                          return (
                            <div key={c.id} style={{background:ls.bg,color:ls.text,borderRadius:6,padding:"5px 10px",fontSize:11}}>
                              <div style={{fontWeight:700}}>{c.unit}</div>
                              <div style={{fontSize:9,opacity:0.75}}>{c.isPuro?"PURO":c.line} · {c.tt}</div>
                              {c.wentOut&&<div style={{fontSize:8,fontWeight:700}}>✅ WENT OUT</div>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Section>

                  {/* Reso */}
                  <Section title={`📋 Short Term Reso (${resoUnits.length} units)`} color="#93c5fd">
                    {resoUnits.length===0?<div style={{fontSize:11,color:"#374151"}}>No units in reso</div>:(
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {resoUnits.map(c=>(
                          <div key={c.id} style={{background:"#0f1e38",border:"1px solid #1e3a5f",borderRadius:6,padding:"6px 10px",fontSize:11}}>
                            <div style={{fontWeight:700,color:"#93c5fd"}}>{c.unit}</div>
                            {c.customer&&<div style={{fontSize:9,color:"#7dd3fc"}}>{c.customer}</div>}
                            {c.returnDate&&<div style={{fontSize:9,color:"#f59e0b"}}>Back {fmtDate(c.returnDate)}</div>}
                            <div style={{fontSize:9,color:"#4b5563"}}>{c.tt}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>

                  {/* Tomorrow */}
                  {tomUnits.length>0&&(
                    <Section title={`📅 Need for Tomorrow (${tomUnits.length})`} color="#fcd34d">
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {tomUnits.map(c=>(
                          <div key={c.id} style={{background:"#1c1000",border:"1px solid #78350f",borderRadius:6,padding:"5px 10px",fontSize:11}}>
                            <div style={{fontWeight:700,color:"#fcd34d"}}>{c.unit}</div>
                            <div style={{fontSize:9,color:"#92400e"}}>{c.tt}{c.hold?" · 🔴 HOLD":""}</div>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Tasks */}
                  <Section title={`✅ Daily Tasks (${tasks.filter(t=>t.done).length}/${tasks.length} done)`} color="#a3e635">
                    {tasks.length===0?<div style={{fontSize:11,color:"#374151"}}>No tasks</div>:(
                      <div style={{display:"flex",flexDirection:"column",gap:5}}>
                        {tasks.map(t=>(
                          <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:t.done?"#374151":"#9ca3af",textDecoration:t.done?"line-through":"none"}}>
                            <span style={{fontSize:14}}>{t.done?"✅":"⬜"}</span>
                            {t.unit&&<span style={{color:"#f59e0b",fontWeight:700}}>#{t.unit}</span>}
                            {t.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>

                  {/* PM */}
                  {pmRows.length>0&&(
                    <Section title={`🔧 PM Checklist (${pmRows.filter(r=>r.status==="done").length} done)`} color="#fb923c">
                      <div style={{display:"flex",flexDirection:"column",gap:5}}>
                        {pmRows.map(r=>(
                          <div key={r.id} style={{display:"flex",alignItems:"center",gap:10,fontSize:12,background:"#1f2937",borderRadius:5,padding:"6px 10px",opacity:r.status==="done"?0.6:1}}>
                            <span style={{fontSize:13}}>{r.status==="done"?"✅":r.status==="scheduled"?"📅":"⬜"}</span>
                            <span style={{fontWeight:700,color:r.status==="done"?"#4ade80":r.status==="scheduled"?"#34d399":"#fb923c"}}>{r.unit}</span>
                            <span style={{color:"#6b7280",fontSize:10}}>{r.pmType} · {r.customer}</span>
                            {r.scheduledDate&&<span style={{color:"#f59e0b",fontSize:10,marginLeft:"auto"}}>📅 {fmtDate(r.scheduledDate)}</span>}
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Hikes */}
                  {hikes.length>0&&(
                    <Section title={`✈️ Hikes (${hikes.length})`} color="#67e8f9">
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {hikes.map(h=>(
                          <div key={h.id} style={{background:h.dir==="in"?"#0a1f12":"#12071e",border:`1px solid ${h.dir==="in"?"#166534":"#6b21a8"}`,borderRadius:6,padding:"5px 10px",fontSize:11}}>
                            <div style={{fontWeight:700,color:h.dir==="in"?"#4ade80":"#c084fc"}}>{h.unit} {h.dir==="in"?"↓":"↑"}</div>
                            <div style={{fontSize:9,color:"#4b5563"}}>{h.location||"—"}</div>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Sent */}
                  {sent.length>0&&(
                    <Section title={`📤 Sent Out (${sent.length})`} color="#a78bfa">
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {sent.map(c=>(
                          <div key={c.id} style={{background:"#1f2937",border:"1px solid #374151",borderRadius:6,padding:"5px 10px",fontSize:11}}>
                            <div style={{fontWeight:700,color:"#a78bfa"}}>{c.unit}</div>
                            <div style={{fontSize:9,color:"#6b7280"}}>{c.location||"—"}</div>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

    </div>
  );
}
