#!/usr/bin/env bash
# v1.6.1 comprehensive QA sweep — dev server + agent-browser in ONE bash call.
# Matrix: desktop interactions & all dialogs, tablet drawer/tabs/tools sheet,
# phone portrait, phone landscape, language switch, console/error probes.
set -u
cd /home/z/my-project
SHOT=/home/z/my-project/download/e2e-v161
mkdir -p "$SHOT"

setsid nohup bun run dev > /tmp/devserver.log 2>&1 < /dev/null &
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "SERVER_HTTP=$code"

ev()  { agent-browser eval "$1" 2>&1 | tail -1; }
err() { agent-browser errors 2>&1 | tail -3; }

# paint a stroke at fractions of the canvas element box via real mouse events
paint_at() { # $1 $2 = fx fy ; $3 = drag length px
  local coords
  coords=$(ev "(()=>{const c=document.querySelector('.pf-workspace canvas');if(!c)return '0 0';const r=c.getBoundingClientRect();return Math.round(r.left+r.width*$1)+' '+Math.round(r.top+r.height*$2);})()" | tr -d '"')
  local x=${coords%% *} y=${coords##* }
  agent-browser mouse move "$x" "$y" >/dev/null 2>&1
  agent-browser mouse down >/dev/null 2>&1
  local nx=$((x+$3))
  agent-browser mouse move "$nx" "$((y+10))" >/dev/null 2>&1
  agent-browser mouse move "$((nx+10))" "$((y-6))" >/dev/null 2>&1
  agent-browser mouse up >/dev/null 2>&1
  sleep 0.5
}

hist() { ev "window.__pfStore.getState().history.entries.length + ':' + window.__pfStore.getState().history.index"; }

echo "================ DESKTOP 1920x1080 ================"
agent-browser set viewport 1920 1080 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
agent-browser errors --clear >/dev/null 2>&1
sleep 2.5
echo -n "tier: "; ev "document.querySelector('.pf-workspace')?.dataset.tier"
echo -n "hist0: "; hist
paint_at 0.4 0.4 60
echo -n "hist-after-paint: "; hist
agent-browser press Control+z >/dev/null 2>&1; sleep 0.4
echo -n "hist-after-ctrlz (undo must work): "; hist
agent-browser press Control+Shift+z >/dev/null 2>&1; sleep 0.4
echo -n "hist-after-redo: "; hist
# selection via store tool + drag
ev "window.__pfStore.getState().setTool('marquee-rect')" >/dev/null 2>&1
paint_at 0.55 0.55 40
echo -n "selection: "; ev "(window.__pfStore.getState().selection ? 'sel' : 'none')"
# Edit menu CAF item present & enabled
agent-browser click "text=Edit" >/dev/null 2>&1; sleep 0.6
echo -n "caf-menu: "; ev "(()=>{const it=[...document.querySelectorAll('[role=menuitem]')].find(x=>/Content-aware fill/.test(x.textContent||''));if(!it)return 'MISSING';return it.getAttribute('aria-disabled')==='true'?'DISABLED':'ENABLED';})()"
agent-browser press Escape >/dev/null 2>&1; sleep 0.3
# every dialog opens & closes (renders without runtime error)
for d in export new-document image-size canvas-size settings storage about shortcuts filter-gallery; do
  ev "window.__pfStore.getState().setDialog('$d')" >/dev/null 2>&1
  sleep 0.7
  echo -n "dialog $d: "
  ev "(()=>{const dd=document.querySelector('[data-slot=dialog-content]');if(!dd)return 'NOT_RENDERED';return 'ok-h='+Math.round(dd.getBoundingClientRect().height);})()"
  agent-browser press Escape >/dev/null 2>&1; sleep 0.3
done
# language switch
ev "window.__pfStore.getState().updateSettings({language:'id'})" >/dev/null 2>&1; sleep 0.5
echo -n "i18n-id: "; ev "document.body.innerText.includes('Berkas') ? 'ID-OK' : 'FAIL'"
ev "window.__pfStore.getState().updateSettings({language:'en'})" >/dev/null 2>&1; sleep 0.4
# zoom fit event
ev "window.dispatchEvent(new Event('pf:fit'))" >/dev/null 2>&1; sleep 0.5
echo -n "zoom-fit: "; ev "Math.round(window.__pfStore.getState().view.zoom*100)"
echo -n "desktop-errors: "; err

echo "================ TABLET 820x1180 ================"
agent-browser set viewport 820 1180 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
agent-browser errors --clear >/dev/null 2>&1
sleep 2.5
echo -n "tier: "; ev "document.querySelector('.pf-workspace')?.dataset.tier"
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Panels');b&&b.click();return 1;})()" >/dev/null 2>&1
sleep 1
for tab in Layers History Adjustments Color Histogram Properties; do
  agent-browser eval "(()=>{const t=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim().startsWith('$tab'));t&&t.click();return 1;})()" >/dev/null 2>&1
  sleep 0.6
  echo -n "tab $tab: "
  ev "(()=>{const a=document.querySelector('[role=tab][data-state=active]');const p=document.querySelector('[role=tabpanel][data-state=active]');return (a&&a.textContent.trim().startsWith('$tab')?'tab-ok':'tab?')+(p&&p.offsetHeight>50?' render-ok':' render-empty');})()"
done
agent-browser screenshot "$SHOT/tablet-tabs.png" >/dev/null 2>&1
agent-browser press Escape >/dev/null 2>&1; sleep 0.5
# tools grid sheet
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='More');b&&b.click();return 1;})()" >/dev/null 2>&1
sleep 0.8
echo -n "tools-grid: "; ev "document.querySelectorAll('[data-slot=sheet-content] [role=dialog], [data-slot=sheet-content] button').length"
agent-browser press Escape >/dev/null 2>&1; sleep 0.4
# paint + undo button
paint_at 0.35 0.35 50
echo -n "tablet-hist: "; hist
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Undo');b&&b.click();return 1;})()" >/dev/null 2>&1; sleep 0.5
echo -n "tablet-after-undo-btn: "; hist
echo -n "tablet-errors: "; err

echo "================ PHONE PORTRAIT 390x844 ================"
agent-browser set viewport 390 844 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
agent-browser errors --clear >/dev/null 2>&1
sleep 2.5
echo -n "tier: "; ev "document.querySelector('.pf-workspace')?.dataset.tier"
paint_at 0.4 0.5 40
echo -n "phone-hist: "; hist
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Panels');b&&b.click();return 1;})()" >/dev/null 2>&1
sleep 1
echo -n "bottom-sheet: "
ev "(()=>{const s=[...document.querySelectorAll('[data-slot=sheet-content]')].find(x=>x.dataset.state==='open');if(!s)return 'NO_SHEET';const r=s.getBoundingClientRect();return 'top='+Math.round(r.top)+'/'+Math.round(innerHeight)+' h='+Math.round(r.height);})()"
agent-browser press Escape >/dev/null 2>&1; sleep 0.4
# export via ⋯
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='More');b&&b.click();return 1;})()" >/dev/null 2>&1
sleep 0.6
agent-browser eval "(()=>{const it=[...document.querySelectorAll('[role=menuitem]')].find(x=>/Export/i.test(x.textContent||''));it&&it.click();return 1;})()" >/dev/null 2>&1
sleep 0.9
echo -n "phone-export-dialog: "
ev "(()=>{const dd=document.querySelector('[data-slot=dialog-content]');return dd?'ok-h='+Math.round(dd.getBoundingClientRect().height):'NOT_RENDERED';})()"
agent-browser press Escape >/dev/null 2>&1
echo -n "phone-errors: "; err

echo "================ PHONE LANDSCAPE 844x390 ================"
agent-browser set viewport 844 390 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
agent-browser errors --clear >/dev/null 2>&1
sleep 2.5
echo -n "tier: "; ev "document.querySelector('.pf-workspace')?.dataset.tier"
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Panels');b&&b.click();return 1;})()" >/dev/null 2>&1
sleep 1
echo -n "landscape-sheet: "
ev "(()=>{const s=[...document.querySelectorAll('[data-slot=sheet-content]')].find(x=>x.dataset.state==='open');if(!s)return 'NO_SHEET';const r=s.getBoundingClientRect();return (r.left>=innerWidth*0.4?'RIGHT':'BOTTOM')+' w='+Math.round(r.width)+' h='+Math.round(r.height);})()"
agent-browser press Escape >/dev/null 2>&1
paint_at 0.3 0.4 40
echo -n "landscape-hist: "; hist
echo -n "landscape-errors: "; err

echo "================ PWA sanity ================"
for u in manifest.json icons/icon-192.png icons/icon-512.png; do
  echo -n "$u: "; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/$u"
done

echo "SWEEP_DONE"
pkill -f "[n]ext-server" 2>/dev/null
pkill -f "[n]ext dev" 2>/dev/null
