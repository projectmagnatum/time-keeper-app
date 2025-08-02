if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch(err => console.error("SW registration failed:", err));
  });
}

// Navigation
const navButtons = document.querySelectorAll(".app-nav button");
navButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const view = btn.getAttribute("data-view");
    document.querySelectorAll(".app-view").forEach(v => v.classList.remove("active"));
    document.getElementById(view + "View").classList.add("active");
    if (view === "analytics") renderAnalytics(selectedDate);
  });
});

// IndexedDB setup
let db;
let selectedDate = new Date().toISOString().split("T")[0];
let categoriesCache = [];

const request = indexedDB.open("TimeKeeperDB", 2);
request.onupgradeneeded = event => {
  db = event.target.result;
  const oldVersion = event.oldVersion;
  if (oldVersion < 1) db.createObjectStore("categories", { keyPath: "id", autoIncrement: true });
  if (oldVersion < 2) db.createObjectStore("logs", { keyPath: "key" });
};
request.onsuccess = event => {
  db = event.target.result;
  db.onerror = e => console.error("DB error:", e.target.error);

  // initialize
  loadCategories();
  document.getElementById("selectedDate").value = selectedDate;
  loadDay(selectedDate);
  updateDayProgress();
  setInterval(updateDayProgress, 60*1000);
  cacheCategories();
};
request.onerror = event => console.error("IndexedDB open error:", event.target.error);

// Cache categories for analytics lookups
function cacheCategories() {
  db.transaction("categories","readonly").objectStore("categories")
    .getAll().onsuccess = e => categoriesCache = e.target.result;
}

// -------------------- Categories --------------------
function loadCategories() {
  const store = db.transaction("categories","readonly").objectStore("categories");
  store.getAll().onsuccess = e => {
    const list = document.getElementById("categoryList");
    list.innerHTML = "";
    e.target.result.forEach(cat => {
      const li = document.createElement("li");
      const swatch = document.createElement("span");
      Object.assign(swatch.style, {
        display: "inline-block",
        width: "16px",
        height: "16px",
        backgroundColor: cat.color,
        border: "1px solid #ccc",
        marginRight: "8px",
        verticalAlign: "middle"
      });
      li.appendChild(swatch);
      li.insertAdjacentHTML("beforeend", `${cat.name} (<strong>${cat.type}</strong>)`);
      list.appendChild(li);
    });
    cacheCategories();
  };
}

document.getElementById("categoryForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("categoryName").value.trim();
  const type = document.getElementById("categoryType").value;
  const color = document.getElementById("categoryColor").value;
  if (!name) return;
  db.transaction("categories","readwrite").objectStore("categories")
    .add({ name, type, color }).onsuccess = () => {
      loadCategories();
      document.getElementById("categoryForm").reset();
      document.getElementById("categoryColor").value = "#0096B1";
    };
});

// -------------------- Dashboard & Date --------------------
function changeDateBy(days) {
  const dt = new Date(selectedDate);
  dt.setDate(dt.getDate()+days);
  selectedDate = dt.toISOString().split("T")[0];
  document.getElementById("selectedDate").value = selectedDate;
  loadDay(selectedDate);
}
document.getElementById("prevDate").addEventListener("click", ()=>changeDateBy(-1));
document.getElementById("nextDate").addEventListener("click", ()=>changeDateBy(1));
document.getElementById("selectedDate").addEventListener("change", e => {
  selectedDate = e.target.value;
  loadDay(selectedDate);
});

function loadDay(date) {
  generateTimeBlocks(date);
  setTimeout(()=>loadPreviousAssignments(date), 50);
}

function generateTimeBlocks(date) {
  const container = document.getElementById("timeBlocksContainer");
  if (!container) return;
  container.innerHTML = "";
  for (let hour=7; hour<=23; hour++) {
    for (let min=0; min<60; min+=15) {
      if (hour===23 && min>0) break;
      const label = `${hour.toString().padStart(2,'0')}:${min.toString().padStart(2,'0')}`;
      const block = document.createElement("div");
      block.className = "time-block";
      block.dataset.time = label;
      block.textContent = label;
      block.addEventListener("click", ()=>showCategoryDropdown(block,date));
      container.appendChild(block);
    }
  }
}

function showCategoryDropdown(block, date) {
  if (block.querySelector("select")) return;
  const select = document.createElement("select");
  db.transaction("categories","readonly").objectStore("categories")
    .getAll().onsuccess = e => {
      const cats = e.target.result;
      const placeholder = document.createElement("option");
      placeholder.textContent = "-- Choose Category --";
      placeholder.disabled = true;
      placeholder.selected = true;
      select.appendChild(placeholder);
      cats.forEach(cat=>{
        const opt = document.createElement("option");
        opt.value = cat.id;
        opt.textContent = cat.name;
        select.appendChild(opt);
      });
      select.addEventListener("change", ()=>{
        const selectedCat = cats.find(c=>c.id==select.value);
        assignCategoryToBlock(block,selectedCat);
        saveBlockAssignment(block.dataset.time,selectedCat,date);
        setTimeout(()=>loadPreviousAssignments(date),50);
      });
      block.appendChild(select);
    };
}

function assignCategoryToBlock(block, category) {
  block.classList.add("assigned");
  block.style.background = category.color;
  block.textContent = `${block.dataset.time} – ${category.name} (${category.type})`;
}

function saveBlockAssignment(time, category, date) {
  const key = `${date}_${time}`;
  db.transaction("logs","readwrite").objectStore("logs")
    .put({ key, time, categoryId: category.id });
}

function loadPreviousAssignments(date) {
  const tx = db.transaction(["logs","categories"],"readonly");
  tx.objectStore("logs").getAll().onsuccess = e => {
    const logs = e.target.result.filter(l=>l.key.startsWith(date));
    if (!logs.length) return;
    tx.objectStore("categories").getAll().onsuccess = ev => {
      const cats = ev.target.result;
      logs.forEach(log=>{
        const block = document.querySelector(
          `.time-block[data-time="${log.time}"]`
        );
        const cat = cats.find(c=>c.id===log.categoryId);
        if (block && cat) assignCategoryToBlock(block,cat);
      });
    };
  };
}

// -------------------- Day Progress Bar --------------------
function updateDayProgress() {
  const now = new Date();
  const londonNow = new Date(now.toLocaleString("en-GB",{timeZone:"Europe/London"}));
  const totalMinutes = 16*60;
  const minutesSince = londonNow.getHours()*60+londonNow.getMinutes() - 7*60;
  const clamped = Math.max(0,Math.min(minutesSince,totalMinutes));
  const pct = (clamped/totalMinutes)*100;
  const bar = document.getElementById("dayProgress");
  if (bar) bar.style.width = pct+"%";
}

// -------------------- Analytics --------------------
function renderAnalytics(date) {
  if (!categoriesCache.length) {
    cacheCategories();
    return setTimeout(()=>renderAnalytics(date),100);
  }
  const totalBlocks = 16*4 + 1; // 65
  db.transaction("logs","readonly").objectStore("logs").getAll().onsuccess = e => {
    const logs = e.target.result.filter(l=>l.key.startsWith(date));
    const noiseCount = logs.filter(l=>{
      const cat = categoriesCache.find(c=>c.id===l.categoryId);
      return cat && cat.type==="NOISE";
    }).length;
    const signalCount = logs.length - noiseCount;
    const noisePct = ((noiseCount/totalBlocks)*100).toFixed(1);
    const signalPct = ((signalCount/totalBlocks)*100).toFixed(1);
    drawDonut("noiseChart",noisePct,"#F44336");
    drawDonut("signalChart",signalPct,"#4CAF50");
    renderBreakdown(logs,totalBlocks);
  };
}

function drawDonut(containerId,pct,color) {
  const r = 50, c = 2*Math.PI*r;
  const dash = (pct/100)*c, rem = c-dash;
  const svg = `
    <svg viewBox="0 0 120 120">
      <circle class="circle-bg" cx="60" cy="60" r="${r}"/>
      <circle class="circle" cx="60" cy="60" r="${r}"
        stroke="${color}"
        stroke-dasharray="${dash} ${rem}"/>
      <text x="60" y="60" transform="rotate(90 60 60)">${pct}%</text>
    </svg>`;
  document.getElementById(containerId).innerHTML = svg;
}

function renderBreakdown(logs,totalBlocks) {
  const container = document.getElementById("analyticsBreakdown");
  container.innerHTML = "";
  const counts = {};
  logs.forEach(l=>counts[l.categoryId]=(counts[l.categoryId]||0)+1);
  categoriesCache.forEach(cat=>{
    const count = counts[cat.id]||0;
    if (!count) return;
    const hours = (count*15)/60;
    const pct = ((count/totalBlocks)*100).toFixed(1);
    const item = document.createElement("div");
    item.className = "breakdown-item";
    // name on its own line, stats on next
    item.innerHTML = `
      <div class="breakdown-label">
        <div class="breakdown-name">${cat.name}</div>
        <div class="breakdown-stats">${hours.toFixed(2)}h, ${pct}%</div>
      </div>
      <div class="breakdown-bar-container">
        <div class="breakdown-bar" style="width:${(hours/16)*100}%;background:${cat.color}"></div>
      </div>`;
    container.appendChild(item);
  });
}
