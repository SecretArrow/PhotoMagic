#!/usr/bin/env bash
# v1.6 E2E multi-viewport sweep — runs dev server + agent-browser probes in ONE
# bash invocation (sandbox reaps background processes between calls).
set -u
cd /home/z/my-project

SHOT=/home/z/my-project/download/e2e-v16
mkdir -p "$SHOT"

# ---------- start dev server ----------
setsid nohup bun run dev > /tmp/devserver.log 2>&1 < /dev/null &
DEV_PID=$!
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "SERVER_HTTP=$code"

probe() { # single-value eval probe
  agent-browser eval "$1" 2>&1 | tail -1
}

sweep() { # $1=name $2=w $3=h
  local name=$1 w=$2 h=$3
  agent-browser set viewport "$w" "$h" >/dev/null 2>&1
  agent-browser open http://localhost:3000 >/dev/null 2>&1
  sleep 2.5
  echo "=== $name ${w}x${h} ==="
  echo -n "tier: "; probe "document.querySelector('.pf-workspace')?.dataset.tier + '/' + document.querySelector('.pf-workspace')?.dataset.orientation"
  agent-browser screenshot "$SHOT/$name.png" >/dev/null 2>&1
}

open_panels() { # click the Panels button, then report sheet placement
  agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Panels');if(!b)return 'NO_BTN';b.click();return 'CLICKED';})()" 2>&1 | tail -1
  sleep 1.2
  probe "(()=>{const s=[...document.querySelectorAll('[data-slot=\"sheet-content\"]')].find(x=>x.dataset.state==='open');if(!s)return 'NO_SHEET';const r=s.getBoundingClientRect();const w=innerWidth,h=innerHeight;const side=r.left>=w*0.5?'RIGHT':(r.top>=h*0.4?'BOTTOM':'TOP?');return side+'@'+Math.round(r.width)+'x'+Math.round(r.height);})()"
}

close_panels() {
  agent-browser press Escape >/dev/null 2>&1
  sleep 0.6
}

# ---------- tier matrix ----------
sweep pc-1920x1080 1920 1080
sweep laptop-1366x768 1366 768
sweep boundary-1024x768 1024 768
sweep boundary-1023x768 1023 768
sweep tablet-portrait-820x1180 820 1180
echo -n "tablet panels: "; open_panels
agent-browser screenshot "$SHOT/tablet-portrait-panels.png" >/dev/null 2>&1
close_panels
sweep tablet-landscape-1180x820 1180 820
sweep boundary-640x960 640 960
sweep boundary-639x960 639 960
sweep phone-portrait-390x844 390 844
echo -n "phone-portrait panels: "; open_panels
agent-browser screenshot "$SHOT/phone-portrait-panels.png" >/dev/null 2>&1
close_panels
sweep phone-landscape-844x390 844 390
echo -n "phone-landscape panels: "; open_panels
agent-browser screenshot "$SHOT/phone-landscape-panels.png" >/dev/null 2>&1
close_panels
echo -n "phone-landscape topbar-h: "; probe "document.querySelector('.pf-workspace > div:first-child')?.getBoundingClientRect().height"
sweep android-small-360x800 360 800

# ---------- rotation with sheet open (tablet) ----------
agent-browser set viewport 820 1180 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 2.5
echo -n "rotate: open-panels-in-portrait: "; open_panels
agent-browser set viewport 1180 820 >/dev/null 2>&1
sleep 1.5
echo -n "after-rotate tier: "; probe "document.querySelector('.pf-workspace')?.dataset.tier + '/' + document.querySelector('.pf-workspace')?.dataset.orientation"
echo -n "after-rotate sheet: "; probe "(()=>{const s=[...document.querySelectorAll('[data-slot=\"sheet-content\"]')].find(x=>x.dataset.state==='open');if(!s)return 'NO_SHEET';const r=s.getBoundingClientRect();return (r.left>=innerWidth*0.5?'RIGHT':'BOTTOM')+'@'+Math.round(r.width)+'x'+Math.round(r.height);})()"
agent-browser screenshot "$SHOT/tablet-rotate-open.png" >/dev/null 2>&1

# ---------- desktop dialog on short laptop (1366x640 → guard ≤700) ----------
agent-browser set viewport 1366 640 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 2.5
echo -n "short-desktop export dialog: "
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Export');if(!b)return 'NO_BTN';b.click();return 'CLICKED';})()" >/dev/null 2>&1
sleep 1.2
probe "(()=>{const d=document.querySelector('[data-slot=\"dialog-content\"]');if(!d)return 'NO_DIALOG';const r=d.getBoundingClientRect();return 'H='+Math.round(r.height)+'/'+Math.round(innerHeight)+' scrollable='+(d.scrollHeight>d.clientHeight);})()"
agent-browser screenshot "$SHOT/laptop-short-export.png" >/dev/null 2>&1

kill "$DEV_PID" 2>/dev/null
pkill -f "next dev" 2>/dev/null
echo "SWEEP_DONE"
