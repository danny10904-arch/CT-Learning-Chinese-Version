'use strict';

const $ = id => document.getElementById(id);
const planeNames = ['水平切面', '冠狀切面', '矢狀切面'];
const axes = [2, 1, 0];
const ends = [['頭側', '足側'], ['前方', '後方'], ['病人右側', '病人左側']];
const windows = {soft:[40,400], lung:[-600,1500], bone:[500,2000], brain:[40,80]};
const categoryOrder = ['腦葉','腦溝','深部灰質','白質束','腦室系統','邊緣系統','腦幹','小腦','腦池與中線','神經','呼吸','心血管','內臟','泌尿生殖','骨骼','肌肉','其他'];
const targets = {
  head:['brain'], neck:['vertebrae_C5','thyroid_gland'], chest:['heart','lung_upper_lobe_right'],
  abdomen:['liver','pancreas'], pelvis:['urinary_bladder','hip_left'], legs:['femur_left','femur_right'],
  feet:['tarsal','metatarsal','phalanges_feet']
};

let meta, ct, seg, pos = [0,0,0], active = 0, chosen = 0, chosenLandmark = '';
let brainLandmarks = [], request = 0, ready = false, organsById = new Map();
let cineTimer = 0, cineDirection = 1;
const views = [], cache = new Map();

for (let p = 0; p < 3; p++) {
  const article = document.createElement('article');
  article.className = 'viewer';
  article.innerHTML = `<div class="vhead"><b>${planeNames[p]}</b><strong>—</strong></div><canvas width="600" height="600" tabindex="0" aria-label="${planeNames[p]}，點選定位，方向鍵切片"></canvas><div class="slider"><div class="slab"><span>${ends[p][0]}</span><span>${ends[p][1]}</span></div><input type="range" min="0" max="1" value="0" disabled aria-label="${planeNames[p]}切片位置"></div>`;
  $('viewers').append(article);
  const canvas = article.querySelector('canvas');
  const slider = article.querySelector('input');
  const view = {article, canvas, slider, geometry:null, imageData:null, buffer:null, imageW:0, imageH:0, a:article, c:canvas, g:null};
  views.push(view);

  slider.oninput = () => {
    if (!ready) return;
    active = p;
    pos[axes[p]] = p === 2 ? Number(slider.value) : meta.shape[axes[p]] - 1 - Number(slider.value);
    render();
  };
  canvas.addEventListener('wheel', event => {
    if (!ready) return;
    event.preventDefault();
    stopCine();
    step(p, event.deltaY > 0 ? -1 : 1);
  }, {passive:false});
  canvas.onkeydown = event => {
    if (!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    stopCine();
    step(p, ['ArrowUp','ArrowRight'].includes(event.key) ? 1 : -1);
  };
  canvas.onclick = event => {
    if (!ready) return;
    stopCine();
    const xyz = point(p, event);
    if (!xyz) return;
    active = p;
    pos = xyz;
    chosenLandmark = '';
    chosen = seg[index(...xyz)];
    showSelected(chosen);
    render();
  };
  canvas.onmousemove = event => showHover(p, event);
  canvas.onmouseleave = () => {
    if (ready) $('density').textContent = '移動指標或點選影像查看構造';
  };
}

function index(x, y, z) {
  return x + meta.shape[0] * (y + meta.shape[1] * z);
}

function voxel(p, u, v) {
  const [nx, ny, nz] = meta.shape;
  if (p === 0) return [nx - 1 - u, ny - 1 - v, pos[2]];
  if (p === 1) return [nx - 1 - u, pos[1], nz - 1 - v];
  return [pos[0], ny - 1 - u, nz - 1 - v];
}

function dimensions(p) {
  if (p === 0) return [meta.shape[0], meta.shape[1]];
  if (p === 1) return [meta.shape[0], meta.shape[2]];
  return [meta.shape[1], meta.shape[2]];
}

function point(p, event) {
  const geometry = views[p].geometry;
  if (!geometry) return null;
  const rect = views[p].canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * 600 / rect.width;
  const y = (event.clientY - rect.top) * 600 / rect.height;
  const u = Math.floor((x - geometry.x) / geometry.scale);
  const v = Math.floor((y - geometry.y) / geometry.scale);
  if (u < 0 || v < 0 || u >= geometry.width || v >= geometry.height) return null;
  return voxel(p, u, v);
}

function step(p, delta) {
  if (!ready) return;
  active = p;
  const axis = axes[p];
  pos[axis] = Math.max(0, Math.min(meta.shape[axis] - 1, pos[axis] + delta));
  render();
}

function projected(p, [x,y,z]) {
  const [nx, ny, nz] = meta.shape;
  if (p === 0) return [nx - 1 - x, ny - 1 - y];
  if (p === 1) return [nx - 1 - x, nz - 1 - z];
  return [ny - 1 - y, nz - 1 - z];
}

function landmarksOn(p) {
  if (meta.id !== 's1456') return [];
  const axis = axes[p];
  return brainLandmarks.filter(item => Math.abs(pos[axis] - item.center[axis]) <= item.range[axis]);
}

function nearestLandmark(p, event) {
  const geometry = views[p].geometry;
  if (!geometry || meta.id !== 's1456') return null;
  const rect = views[p].canvas.getBoundingClientRect();
  const mouseX = (event.clientX - rect.left) * 600 / rect.width;
  const mouseY = (event.clientY - rect.top) * 600 / rect.height;
  let closest = null;
  let distance = Infinity;
  for (const item of landmarksOn(p)) {
    const [u,v] = projected(p, item.center);
    const d = (geometry.x + (u + .5) * geometry.scale - mouseX) ** 2 + (geometry.y + (v + .5) * geometry.scale - mouseY) ** 2;
    if (d < distance) {
      distance = d;
      closest = item;
    }
  }
  return distance <= 18 ** 2 ? closest : null;
}

function showHover(p, event) {
  if (!ready) return;
  const xyz = point(p, event);
  if (!xyz) return;
  const landmark = nearestLandmark(p, event);
  const organ = organsById.get(seg[index(...xyz)]);
  $('density').textContent = `${landmark ? landmark.name + '（精細定位導引）' : organ ? organ.name : '未標註區域'} · ${ct[index(...xyz)]} HU（重新取樣）`;
}

function showSelected(id) {
  chosenLandmark = '';
  const organ = organsById.get(id);
  $('selection').textContent = organ
    ? `已選取：${organ.name}。此名稱來自資料集的逐像素分割。`
    : '目前位置沒有對應分割標註；不代表沒有解剖構造。';
}

function showLandmark(item) {
  chosen = 0;
  chosenLandmark = item.key;
  $('selection').textContent = `精細定位：${item.name}。${item.description} 此標記為解剖教學定位，並非逐像素分割。`;
}

function labelBox(ctx, occupied, color, label, x, y, width, highlighted) {
  let textX = Math.min(585 - width, Math.max(15, x + 10));
  let textY = Math.min(560, Math.max(38, y));
  while (occupied.some(box => Math.abs(box.y - textY) < 30 && Math.abs(box.x - textX) < Math.max(width, box.w)) && textY < 530) textY += 31;
  occupied.push({x:textX, y:textY, w:width});
  ctx.strokeStyle = `rgb(${color})`;
  ctx.lineWidth = highlighted ? 2.5 : 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(textX, textY - 7);
  ctx.stroke();
  ctx.fillStyle = highlighted ? 'rgba(18,45,59,.97)' : 'rgba(2,8,13,.92)';
  ctx.fillRect(textX, textY - 24, width, 31);
  ctx.fillStyle = '#f2f7fa';
  ctx.fillText(label, textX + 6, textY);
  ctx.lineWidth = 1;
}

function prepareImage(view, context, width, height) {
  if (!view.imageData || view.imageW !== width || view.imageH !== height) {
    view.imageData = context.createImageData(width, height);
    view.imageW = width;
    view.imageH = height;
    view.buffer = document.createElement('canvas');
    view.buffer.width = width;
    view.buffer.height = height;
  }
  return view.imageData;
}

function render() {
  if (!ready) return;
  let visible = [];
  const [windowLevel, windowWidth] = windows[$('window').value];
  const colorMode = $('mode').value === 'color';
  const showLabels = $('labels').checked;

  for (let p = 0; p < 3; p++) {
    const view = views[p];
    const context = view.canvas.getContext('2d');
    const [width,height] = dimensions(p);
    const imageData = prepareImage(view, context, width, height);
    const pixels = imageData.data;
    const slice = new Uint8Array(width * height);
    const counts = new Map();

    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const volumeIndex = index(...voxel(p, x, y));
      const segmentId = seg[volumeIndex];
      const pixelIndex = (x + y * width) * 4;
      const gray = Math.max(0, Math.min(255, (ct[volumeIndex] - (windowLevel - windowWidth / 2)) * 255 / windowWidth));
      const organ = organsById.get(segmentId);
      slice[x + y * width] = segmentId;
      let red = gray, green = gray, blue = gray;
      if (organ) {
        let statistic = counts.get(segmentId);
        if (!statistic) {
          statistic = {n:0, x:0, y:0};
          counts.set(segmentId, statistic);
        }
        statistic.n++;
        statistic.x += x;
        statistic.y += y;
        if (colorMode) {
          const alpha = chosen === segmentId ? .68 : .30;
          red = gray * (1 - alpha) + organ.color[0] * alpha;
          green = gray * (1 - alpha) + organ.color[1] * alpha;
          blue = gray * (1 - alpha) + organ.color[2] * alpha;
        }
      }
      pixels[pixelIndex] = red;
      pixels[pixelIndex + 1] = green;
      pixels[pixelIndex + 2] = blue;
      pixels[pixelIndex + 3] = 255;
    }

    const bufferContext = view.buffer.getContext('2d');
    bufferContext.putImageData(imageData, 0, 0);
    const scale = Math.min(552 / width, 552 / height);
    const offsetX = (600 - width * scale) / 2;
    const offsetY = (600 - height * scale) / 2;
    view.geometry = {x:offsetX, y:offsetY, scale, width, height};
    view.g = {x:offsetX, y:offsetY, s:scale, w:width, h:height};
    context.fillStyle = '#03070b';
    context.fillRect(0, 0, 600, 600);
    context.imageSmoothingEnabled = true;
    context.drawImage(view.buffer, offsetX, offsetY, width * scale, height * scale);

    if (colorMode || chosen) {
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const segmentId = slice[x + y * width];
        const organ = organsById.get(segmentId);
        if (!organ || (!colorMode && segmentId !== chosen)) continue;
        if (slice[x + 1 + y * width] !== segmentId || slice[x + (y + 1) * width] !== segmentId) {
          context.fillStyle = segmentId === chosen ? '#fff' : `rgb(${organ.color})`;
          context.fillRect(offsetX + x * scale, offsetY + y * scale, Math.max(1, scale), Math.max(1, scale));
        }
      }
    }

    const horizontalCrosshair = p === 2 ? meta.shape[1] - 1 - pos[1] : meta.shape[0] - 1 - pos[0];
    const verticalCrosshair = p === 0 ? meta.shape[1] - 1 - pos[1] : meta.shape[2] - 1 - pos[2];
    context.strokeStyle = 'rgba(93,216,239,.65)';
    context.lineWidth = 1;
    context.setLineDash([6,5]);
    context.beginPath();
    context.moveTo(offsetX + (horizontalCrosshair + .5) * scale, offsetY);
    context.lineTo(offsetX + (horizontalCrosshair + .5) * scale, offsetY + height * scale);
    context.moveTo(offsetX, offsetY + (verticalCrosshair + .5) * scale);
    context.lineTo(offsetX + width * scale, offsetY + (verticalCrosshair + .5) * scale);
    context.stroke();
    context.setLineDash([]);

    const planeLandmarks = landmarksOn(p);
    if (showLabels) {
      const occupied = [];
      context.font = '18px system-ui';
      const markers = [...counts]
        .filter(([, statistic]) => statistic.n >= 5)
        .sort((a,b) => (b[0] === chosen) - (a[0] === chosen) || b[1].n - a[1].n)
        .slice(0, 12);
      for (const [segmentId, statistic] of markers) {
        const organ = organsById.get(segmentId);
        const x = offsetX + (statistic.x / statistic.n + .5) * scale;
        const y = offsetY + (statistic.y / statistic.n + .5) * scale;
        const width = context.measureText(organ.name).width + 12;
        labelBox(context, occupied, organ.color, organ.name, x, y, width, chosen === segmentId);
        context.fillStyle = `rgb(${organ.color})`;
        context.fillRect(x - 2, y - 2, 4, 4);
      }
      const detailed = planeLandmarks
        .sort((a,b) => (b.key === chosenLandmark) - (a.key === chosenLandmark) || Math.abs(pos[axes[p]] - a.center[axes[p]]) - Math.abs(pos[axes[p]] - b.center[axes[p]]))
        .slice(0, 14);
      for (const item of detailed) {
        const [u,v] = projected(p, item.center);
        const x = offsetX + (u + .5) * scale;
        const y = offsetY + (v + .5) * scale;
        const width = Math.min(270, context.measureText(item.name).width + 12);
        labelBox(context, occupied, item.color, item.name, x, y, width, item.key === chosenLandmark);
        context.fillStyle = `rgb(${item.color})`;
        context.beginPath();
        context.arc(x, y, item.key === chosenLandmark ? 6 : 4, 0, Math.PI * 2);
        context.fill();
      }
    }

    context.font = 'bold 19px system-ui';
    context.fillStyle = '#b5cbd8';
    context.textAlign = 'center';
    context.fillText(p === 0 ? '前' : '頭側', 300, 21);
    context.fillText(p === 0 ? '後' : '足側', 300, 588);
    context.textAlign = 'left';
    context.fillText(p === 2 ? '前' : '右', 8, 300);
    context.textAlign = 'right';
    context.fillText(p === 2 ? '後' : '左', 592, 300);
    context.textAlign = 'left';
    view.article.classList.toggle('active', active === p);
    view.article.querySelector('strong').textContent = `${meta.shape[axes[p]] - pos[axes[p]]} / ${meta.shape[axes[p]]}`;
    view.slider.max = meta.shape[axes[p]] - 1;
    view.slider.value = p === 2 ? pos[axes[p]] : meta.shape[axes[p]] - 1 - pos[axes[p]];
    view.slider.disabled = false;
    if (p === active) {
      visible = [...counts.keys()].map(id => ({...organsById.get(id), kind:'segment'}));
      visible.push(...planeLandmarks.map(item => ({...item, kind:'landmark'})));
    }
  }
  renderOrganList(visible);
  const [currentLevel, currentWidth] = windows[$('window').value];
  $('position').textContent = `目前：${planeNames[active]}`;
  $('windowText').textContent = `窗位 ${currentLevel}／窗寬 ${currentWidth} HU`;
}

function renderOrganList(visible) {
  const query = $('organSearch').value.trim().toLocaleLowerCase('zh-Hant');
  const rank = category => {
    const position = categoryOrder.indexOf(category);
    return position < 0 ? 99 : position;
  };
  const filtered = visible
    .filter(item => !query || `${item.name} ${item.category}`.toLocaleLowerCase('zh-Hant').includes(query))
    .sort((a,b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name, 'zh-Hant'));
  const segments = visible.filter(item => item.kind === 'segment').length;
  const guides = visible.filter(item => item.kind === 'landmark').length;
  $('listTitle').textContent = `${planeNames[active]}可見構造`;
  $('organCount').textContent = guides ? `${segments} 個分割標註・${guides} 個腦部定位導引` : `${segments} 個逐像素分割標註`;
  const list = $('organs');
  list.replaceChildren();
  for (const item of filtered) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = item.kind === 'landmark' ? (chosenLandmark === item.key ? 'active' : '') : (chosen === item.id && !chosenLandmark ? 'active' : '');
    button.title = `定位至${item.name}`;
    const dot = document.createElement('i');
    const name = document.createElement('span');
    const group = document.createElement('small');
    dot.style.background = `rgb(${item.color})`;
    name.textContent = item.name;
    group.textContent = item.kind === 'landmark' ? `${item.category}・定位` : `${item.category}・分割`;
    button.append(dot, name, group);
    button.onclick = () => {
      stopCine();
      pos = [...item.center];
      if (item.kind === 'landmark') showLandmark(item);
      else {
        chosen = item.id;
        showSelected(chosen);
      }
      render();
    };
    list.append(button);
  }
  if (!visible.length) list.textContent = '此層沒有已標註構造。可繼續移動切片。';
  else if (!filtered.length) list.textContent = '目前切片沒有符合搜尋內容的構造。';
}

function updateCineButton() {
  const button = $('cine');
  const playing = Boolean(cineTimer);
  button.textContent = playing ? '❚❚ 暫停捲動' : '▶ 自動捲動';
  button.setAttribute?.('aria-pressed', String(playing));
}

function stopCine() {
  if (cineTimer) clearInterval(cineTimer);
  cineTimer = 0;
  cineDirection = 1;
  updateCineButton();
}

function toggleCine() {
  if (!ready) return;
  if (cineTimer) return stopCine();
  cineTimer = setInterval(() => {
    const axis = axes[active];
    const next = pos[axis] + cineDirection;
    if (next < 0 || next >= meta.shape[axis]) cineDirection *= -1;
    pos[axis] += cineDirection;
    render();
  }, 260);
  updateCineButton();
}

async function unpack(url, Type) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`影像檔載入失敗 ${response.status}`);
  if (!('DecompressionStream' in window)) throw Error('請更新 Safari／Chrome 以支援影像解壓縮');
  const buffer = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return new Type(buffer);
}

async function load(id, region) {
  const token = ++request;
  stopCine();
  ready = false;
  $('controls').disabled = true;
  for (const view of views) view.slider.disabled = true;
  $('status').className = 'status';
  $('status').textContent = '正在下載真實 CT 與器官標註，首次載入請稍候…';
  try {
    let data = cache.get(id);
    if (!data) {
      const metadataResponse = await fetch(`data/${id}.json`);
      if (!metadataResponse.ok) throw Error('無法載入影像說明');
      const metadata = await metadataResponse.json();
      const landmarks = id === 's1456'
        ? await fetch('data/brain-landmarks.json').then(response => {
          if (!response.ok) throw Error('無法載入腦部精細標籤');
          return response.json();
        })
        : [];
      const [volume, mask] = await Promise.all([
        unpack(`data/${id}-ct.gz`, Int16Array),
        unpack(`data/${id}-seg.gz`, Uint8Array)
      ]);
      if (volume.length !== metadata.shape.reduce((total, n) => total * n, 1) || mask.length !== volume.length) throw Error('影像與標註尺寸不符');
      data = {metadata, volume, mask, landmarks};
      cache.set(id, data);
    }
    if (token !== request) return;
    meta = data.metadata;
    ct = data.volume;
    seg = data.mask;
    brainLandmarks = data.landmarks || [];
    organsById = new Map(meta.organs.map(organ => [organ.id, organ]));
    pos = meta.shape.map(n => Math.floor(n / 2));
    chosen = 0;
    chosenLandmark = '';
    ready = true;
    $('controls').disabled = false;
    $('series').value = id;
    $('window').value = id === 's1456' ? 'brain' : id === 's1438' ? 'bone' : 'soft';
    $('status').textContent = id === 's1456'
      ? `已載入：${meta.title}｜${meta.shape[2]} 層水平切片｜${meta.organs.length} 個分割標註＋${brainLandmarks.length} 個腦部精細定位`
      : `已載入：${meta.title}｜${meta.shape[2]} 層水平切片｜${meta.organs.length} 個分割標註`;
    $('coverage').textContent = id === 's1456'
      ? `病例 ${id}：${meta.title}。包含 ${meta.organs.length} 個資料集逐像素分割，以及 ${brainLandmarks.length} 個會隨三切面移動的腦部精細定位導引。精細定位依本病例影像與標準解剖位置建立，並非逐像素分割，不應用於診斷。教學顯示間距 ${meta.spacing.join(' × ')} 毫米。`
      : `病例 ${id}：${meta.title}。顯影資訊：${meta.contrast}。教學顯示間距 ${meta.spacing.join(' × ')} 毫米；原始間距 ${meta.sourceSpacing.map(value => value.toFixed(2)).join(' × ')} 毫米。頭部、軀幹與膝部是不同病例；尚未收錄完整頸部、小腿與足部。`;
    $('selection').textContent = '尚未選取構造';
    if (!region) document.querySelectorAll('[data-region]').forEach(button => button.classList.toggle('active', false));
    if (region) jump(region);
    else render();
  } catch (error) {
    if (token !== request) return;
    $('status').className = 'status error';
    $('status').textContent = `${error.message}。請重新整理重試；目前影像未就緒。`;
  }
}

async function jump(region) {
  const seriesId = region === 'head' ? 's1456' : region === 'legs' ? 's1438' : 's0327';
  if (!ready || meta.id !== seriesId) return load(seriesId, region);
  stopCine();
  const organ = targets[region].map(key => meta.organs.find(item => item.key === key)).find(Boolean);
  if (organ) {
    pos = [...organ.center];
    chosen = organ.id;
    showSelected(chosen);
  } else if (region === 'feet') {
    pos = [Math.floor(meta.shape[0] / 2), Math.floor(meta.shape[1] / 2), Math.round(meta.shape[2] * .04)];
    chosen = 0;
    $('selection').textContent = '掃描下端定位；足部未有可用器官分割標註。';
  } else {
    $('selection').textContent = '此病例沒有此區域的定位標註。';
    render();
    return;
  }
  active = 0;
  document.querySelectorAll('[data-region]').forEach(button => button.classList.toggle('active', button.dataset.region === region));
  render();
}

$('series').onchange = event => load(event.target.value);
$('mode').onchange = render;
$('window').onchange = render;
$('labels').onchange = render;
$('organSearch').oninput = () => ready && render();
$('cine').onclick = toggleCine;
$('reset').onclick = () => {
  if (!ready) return;
  stopCine();
  pos = meta.shape.map(n => Math.floor(n / 2));
  chosen = 0;
  chosenLandmark = '';
  active = 0;
  showSelected(0);
  render();
};
document.querySelectorAll('[data-region]').forEach(button => button.onclick = () => jump(button.dataset.region));
updateCineButton();
load('s0327', 'abdomen');
