// 快捷宠物：桌面小橘猫 → 点开选标签 → 选话术 → 复制/发送
// 猫会走动、睡觉、时不时冒出有趣的话（纯前端动画，不影响功能）
const $ = s => document.querySelector(s);

// ── 猫的随机话术（奶牛猫搞笑梗库）──
const CAT_SAYINGS = [
  '摸我！',
  '又在敲代码？',
  '摸鱼才是第一生产力',
  '今天也要好好摆烂',
  '要不要喝奶茶',
  '别卷了休息一会',
  '你的CPU还好吗',
  '快给我小鱼干',
  '人类干活好慢啊',
  '偷偷看你屏幕ing',
  '代码又bug了？',
  '阿乐是叼毛',
  '说错了，阿乐是精英！！！！！',
  '阿乐今天又抓到一个大行情，牛！',
  '阿乐哥的操作，我喵喵佩服',
  '阿乐说：稳住，我们能赢 🐾',
  '跟着阿乐混，三天吃九顿',
  '阿乐一出手，市场抖三抖',
  '阿乐的仓位管理，教科书级别',
  '今天阿乐又教了我一招，学到了喵',
  '阿乐说别慌，钱是慢慢赚的',
];

// ── 猫的状态机：idle / walk / sleep ──
let catState = 'idle';
let catTimer = null;
let bubbleTimer = null;

function setCatState(s) {
  catState = s;
  const el = $('#cat-anim');
  if (!el) return;
  el.classList.remove('walk', 'sleep');
  if (s === 'walk') el.classList.add('walk');
  else if (s === 'sleep') el.classList.add('sleep');
  // 睡觉：闭眼；其它：睁眼
  const eyeL = $('#eyeL'), eyeR = $('#eyeR'), hlL = $('#hlL'), hlR = $('#hlR');
  if (eyeL && eyeR) {
    if (s === 'sleep') {
      eyeL.setAttribute('ry', '2'); eyeR.setAttribute('ry', '2');
      if (hlL) hlL.style.display = 'none';
      if (hlR) hlR.style.display = 'none';
    } else {
      eyeL.setAttribute('ry', '8.5'); eyeR.setAttribute('ry', '8.5');
      if (hlL) hlL.style.display = 'block';
      if (hlR) hlR.style.display = 'block';
    }
  }
}

function scheduleCat() {
  clearTimeout(catTimer);
  const delay = 4000 + Math.random() * 6000;  // 4~10 秒随机切换（更频繁，容易看到）
  catTimer = setTimeout(() => {
    if (mode > 0) { scheduleCat(); return; }  // 面板打开时不打扰
    const r = Math.random();
    if (r < 0.4) setCatState('walk');        // 走一会儿
    else if (r < 0.6) setCatState('sleep');   // 睡一会儿
    else setCatState('idle');                 // 发会儿呆
    // 走/睡 3~6 秒后回 idle
    if (catState !== 'idle') {
      setTimeout(() => { if (mode === 0) setCatState('idle'); }, 2500 + Math.random() * 2500);
    }
    scheduleCat();
  }, delay);
}

function scheduleBubble() {
  clearTimeout(bubbleTimer);
  const delay = 12000 + Math.random() * 20000;  // 12~32 秒冒一句
  bubbleTimer = setTimeout(() => {
    if (mode === 0) {
      const b = $('#bubble');
      if (b) {
        b.textContent = CAT_SAYINGS[Math.floor(Math.random() * CAT_SAYINGS.length)];
        b.classList.add('show');
        $('#ball').classList.add('bubble-show');  // 猫沉到底部，气泡在顶部不挡猫
        void 0; // 极客桌宠不改变窗口尺寸显示气泡
        setTimeout(() => {
          b.classList.remove('show');
          $('#ball').classList.remove('bubble-show');
          if (mode === 0) void 0; // 保持独立桌宠窗口尺寸
        }, 3800);
      }
    }
    scheduleBubble();
  }, delay);
}

// 状态：0=圆球 1=标签列表 2=话术列表
let mode = 0;
let currentCat = '';

// 从极客主进程拉取全局快捷话术（直接复用蓝拓标签→序列结构）
async function loadScripts() {
  return window.api.quickScripts.list();
}

function show(m) {
  mode = m;
  $('#ball').style.display = m === 0 ? 'flex' : 'none';
  $('#panel').style.display = m === 0 ? 'none' : 'flex';
  // 同步窗口尺寸：圆球 104×104，展开 330×屏幕高
  window.api.quickPet.shape(m === 0 ? 'ball' : 'open');
  if (m === 1) {
    $('#scripts').style.display = 'none';
    $('#cats').style.display = 'block';
    $('#back').style.display = 'none';
    $('#panel-title').textContent = '快捷话术';
  } else if (m === 2) {
    $('#cats').style.display = 'none';
    $('#scripts').style.display = 'block';
    $('#back').style.display = 'inline-block';
    $('#panel-title').textContent = currentCat;
  }
}

async function renderCats() {
  const shown = await loadScripts();
  const cats = [...new Set(shown.map(r => r.label))];
  $('#ball-badge').textContent = shown.length;
  $('#ball-badge').style.display = shown.length ? 'flex' : 'none';
  $('#cats').innerHTML = cats.map(c => {
    const n = shown.filter(r => r.label === c).length;
    return `<div class="cat-item" data-cat="${escapeHtml(c)}"><span>▸</span><span>${escapeHtml(c)}</span><span class="n">${n}</span></div>`;
  }).join('') || '<div class="empty">还没有话术<br>点击右上角「话术」添加</div>';
}

async function renderScripts() {
  const shown = await loadScripts();
  const list = shown.filter(r => r.label === currentCat);
  $('#scripts').innerHTML = list.map(r => {
    const en = (r.translation || '').trim();
    return `<div class="script-item" data-id="${escapeHtml(r.id)}" title="双击填入当前聊天">
      <span class="zh">${escapeHtml(r.zh || '')}</span>
      ${en ? `<span class="en">${escapeHtml(en)}</span>` : ''}
      <button class="script-edit" data-script-edit="${escapeHtml(r.id)}">编辑</button>
      <span>↵</span>
    </div>`;
  }).join('') || '<div class="empty">这个标签下还没有话术</div>';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 拖拽 + 点击（标准桌宠做法，参照 StarJourney）
// - document 级 mousemove：鼠标移出窗口也能收到（窗口跟随移动）
// - movementX/Y > 5px = 拖拽；按住 <200ms 且没拖 = 点击
// - 圆球态：点宠物 = 展开；面板态：点头部/空白 = 拖窗口（避开按钮）
let mouseDownTime = null;
let isDragging = false;
let hasDragged = false;
const CLICK_THRESHOLD = 200;  // ms
const MOVE_THRESHOLD = 5;     // px

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || mode > 0) return;
  // 面板态：点在按钮/列表项上不启动拖拽（那是点击操作）；头部和空白区可拖
  if (mode > 0 && e.target.closest('button, .cat-item, .script-item')) return;
  mouseDownTime = Date.now();
  isDragging = false;
  hasDragged = false;
  window.api.quickPet.dragStart({ x: e.screenX, y: e.screenY });
});

document.addEventListener('mousemove', (e) => {
  if (!mouseDownTime) return;
  // 检测是否开始拖拽（移动超过阈值）
  if (!isDragging) {
    const mv = Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
    if (mv > MOVE_THRESHOLD) {
      isDragging = true;
      hasDragged = true;
    }
  }
  if (isDragging) {
    window.api.quickPet.dragMove({ x: e.screenX, y: e.screenY });
  }
});

document.addEventListener('mouseup', async () => {
  if (!mouseDownTime) return;
  const holdTime = Date.now() - mouseDownTime;
  if (isDragging) {
    window.api.quickPet.dragEnd();
  } else if (holdTime < CLICK_THRESHOLD && !hasDragged && mode === 0) {
    // 圆球态轻点：展开标签面板
    await renderCats();
    show(1);
  }
  mouseDownTime = null;
  isDragging = false;
  hasDragged = false;
});

$('#add-script').addEventListener('click', () => window.api.quickScripts.requestEditor(''));
$('#import-scripts').addEventListener('click', async () => { const r = await window.api.quickScripts.importFile(); if (!r?.canceled) { await renderCats(); $('#panel-title').textContent = `已导入 ${r.added} 条`; setTimeout(() => { if (mode === 1) $('#panel-title').textContent = '快捷话术'; }, 1800); } });
$('#export-scripts').addEventListener('click', async () => { const r = await window.api.quickScripts.exportFile(); if (!r?.canceled) { $('#panel-title').textContent = `已导出 ${r.count} 条`; setTimeout(() => { $('#panel-title').textContent = mode === 2 ? currentCat : '快捷话术'; }, 1800); } });
window.api.quickScripts.onChanged(async () => { if (mode === 2) await renderScripts(); else await renderCats(); });

// 面板按钮
$('#close').addEventListener('click', () => window.close());
$('#back').addEventListener('click', () => show(1));

// 点标签 → 显示话术
$('#cats').addEventListener('click', async e => {
  const item = e.target.closest('.cat-item');
  if (!item) return;
  currentCat = item.dataset.cat;
  await renderScripts();
  show(2);
});

// 双击话术 → 请求极客主窗口填入当前聊天；单击只高亮
let lastScriptClick = null;
$('#scripts').addEventListener('click', async e => {
  const item = e.target.closest('.script-item');
  if (!item) return;
  const id = String(item.dataset.id), now = Date.now();
  if (e.target.closest('[data-script-edit]')) { lastScriptClick = null; await window.api.quickScripts.requestEditor(id); return; }
  if (lastScriptClick && lastScriptClick.id === id && now - lastScriptClick.t < 350) {
    lastScriptClick = null;
    await window.api.quickScripts.fill(id);
    item.classList.add('clicked'); setTimeout(() => item.classList.remove('clicked'), 300);
    return;
  }
  lastScriptClick = { id, t: now };
  item.classList.add('clicked'); setTimeout(() => item.classList.remove('clicked'), 300);
});

// 启动猫的动画与话术
setCatState('idle');
scheduleCat();
scheduleBubble();
