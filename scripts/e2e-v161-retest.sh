#!/usr/bin/env bash
# Focused retest: CAF menu, mobile export via Download btn, landscape paint,
# distinct dock label probe, zoom-fit with preset.
set -u
cd /home/z/my-project
setsid nohup bun run dev > /tmp/devserver.log 2>&1 < /dev/null &
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "SERVER_HTTP=$code"
ev() { agent-browser eval "$1" 2>&1 | tail -1; }

echo "=== desktop CAF menu ==="
agent-browser set viewport 1920 1080 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 2.5
agent-browser eval "(()=>{const tr=[...document.querySelectorAll('[role=menubar] > *')].find(x=>x.textContent.trim()==='Edit')||[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Edit');if(!tr)return 'NO_TRIGGER';tr.click();return 'CLICKED:'+tr.tagName;})()" 2>&1 | tail -1
sleep 0.8
ev "(()=>{const items=[...document.querySelectorAll('[role=menuitem]')].map(x=>x.textContent.trim());return 'n='+items.length+' caf='+(items.find(x=>/Content-aware/.test(x))||'NONE');})()"
agent-browser press Escape >/dev/null 2>&1

echo "=== zoom fit with preset ==="
ev "window.__pfStore.getState().zoomBy(3)" >/dev/null 2>&1; sleep 0.4
ev "window.dispatchEvent(new Event('pf:fit'))" >/dev/null 2>&1; sleep 0.6
ev "Math.round(window.__pfStore.getState().view.zoom*100)"

echo "=== phone portrait: export via Download button ==="
agent-browser set viewport 390 844 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 2.5
ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Export');if(!b)return 'NO_BTN';b.click();return 'CLICKED';})()"
sleep 1
ev "(()=>{const dd=document.querySelector('[data-slot=dialog-content]');if(!dd)return 'NOT_RENDERED';const t=dd.textContent||'';return 'ok png='+t.includes('PNG')+' jpeg='+/JPe?G/i.test(t);})()"
agent-browser press Escape >/dev/null 2>&1

echo "=== duplicate aria-label More count (a11y finding) ==="
ev "[...document.querySelectorAll('button')].filter(x=>x.getAttribute('aria-label')==='More').length"

echo "=== landscape 844x390 paint debug ==="
agent-browser set viewport 844 390 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 2.5
ev "window.__pfStore.getState().history.entries.length + ':' + window.__pfStore.getState().history.index + ' tool=' + window.__pfStore.getState().tool"
coords=$(ev "(()=>{const c=document.querySelector('.pf-workspace canvas');if(!c)return 'NO_CANVAS';const r=c.getBoundingClientRect();return Math.round(r.left+r.width*0.35)+' '+Math.round(r.top+r.height*0.45)+' rect='+Math.round(r.width)+'x'+Math.round(r.height);})()" | tr -d '"')
echo "coords: $coords"
x=${coords%% *}; rest=${coords#* }; y=${rest%% *}
agent-browser mouse move "$x" "$y" >/dev/null 2>&1
ev "(()=>{const el=document.elementFromPoint($x,$y);return el?el.tagName+'.'+(el.className||'').toString().slice(0,30):'NULL';})()"
agent-browser mouse down >/dev/null 2>&1
agent-browser mouse move "$((x+50))" "$y" >/dev/null 2>&1
agent-browser mouse move "$((x+60))" "$((y+8))" >/dev/null 2>&1
agent-browser mouse up >/dev/null 2>&1
sleep 0.6
ev "window.__pfStore.getState().history.entries.length + ':' + window.__pfStore.getState().history.index"

echo "RETEST_DONE"
pkill -f "[n]ext-server" 2>/dev/null
pkill -f "[n]ext dev" 2>/dev/null
