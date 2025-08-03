// script.js
document.addEventListener("DOMContentLoaded", () => {
  // --- State ---
  let db;
  let selectedDate = new Date().toISOString().split("T")[0];
  let categoriesCache = [];
  let editingId = null;

  // --- Service Worker ---
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./service-worker.js")
        .catch(err => console.error("SW registration failed:", err));
    });
  }

  // --- Navigation ---
  document.querySelectorAll(".app-nav button").forEach(btn =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".app-view").forEach(v => v.classList.remove("active"));
      const view = btn.getAttribute("data-view");
      document.getElementById(view + "View").classList.add("active");
      if (view === "analytics") renderAnalytics(selectedDate);
    })
  );

  // --- IndexedDB for categories & logs (unchanged) ---
  const rq = indexedDB.open("TimeKeeperDB", 3);
  rq.onupgradeneeded = e => {
    db = e.target.result;
    const oldV = e.oldVersion;
    if (oldV < 1) db.createObjectStore("categories", { keyPath: "id", autoIncrement: true });
    if (oldV < 2) db.createObjectStore("logs",       { keyPath: "key" });
  };
  rq.onsuccess = () => {
    db = rq.result;
    db.onerror = ev => console.error("DB error:", ev.target.error);
    init();
  };
  rq.onerror = e => console.error("IndexedDB open error:", e.target.error);

  // --- Initialization ---
  function init() {
    // Date picker
    document.getElementById("selectedDate").value = selectedDate;
    document.getElementById("prevDate").addEventListener("click", () => changeDateBy(-1));
    document.getElementById("nextDate").addEventListener("click", () => changeDateBy(1));
    document.getElementById("selectedDate").addEventListener("change", e => {
      selectedDate = e.target.value;
      loadDay(selectedDate);
    });

    // Presets UI
    document.getElementById("addPresetColor").addEventListener("click", addPreset);
    document.getElementById("presetColorList").addEventListener("change", e => {
      if (e.target.value) {
        document.getElementById("categoryColor").value = e.target.value;
      }
    });

    // Category form
    document.getElementById("categoryForm").addEventListener("submit", onCategorySubmit);

    // Initial render
    loadPresets();
    loadCategories();
    loadDay(selectedDate);
    updateDayProgress();
    setInterval(updateDayProgress, 60 * 1000);
  }

  // --- Presets (localStorage) ---
  function loadPresets() {
    const arr = JSON.parse(localStorage.getItem("presetColors") || "[]");
    const sw = document.getElementById("presetSwatches");
    const dd = document.getElementById("presetColorList");
    sw.innerHTML = "";
    dd.innerHTML = `<option value="">— Quick pick —</option>`;
    arr.forEach(color => {
      // swatch
      const btn = document.createElement("button");
      btn.className = "swatch-btn";
      btn.style.background = color;
      btn.title = color;
      btn.addEventListener("click", () => {
        document.getElementById("categoryColor").value = color;
      });
      sw.appendChild(btn);
      // dropdown
      const opt = document.createElement("option");
      opt.value = color;
      opt.textContent = color;
      dd.appendChild(opt);
    });
  }

  function addPreset() {
    const color = document.getElementById("categoryColor").value;
    if (!color) return;
    const arr = JSON.parse(localStorage.getItem("presetColors") || "[]");
    if (!arr.includes(color)) {
      arr.push(color);
      localStorage.setItem("presetColors", JSON.stringify(arr));
      loadPresets();
    }
  }

  // --- Categories: load, add & edit ---
  function loadCategories() {
    db.transaction("categories", "readonly")
      .objectStore("categories")
      .getAll()
      .onsuccess = e => {
        const list = document.getElementById("categoryList");
        list.innerHTML = "";
        e.target.result.forEach(cat => {
          const li = document.createElement("li");
          li.style.display = "flex";
          li.style.alignItems = "center";
          li.style.gap = "8px";
          li.style.marginBottom = "8px";

          // color swatch
          const sw = document.createElement("span");
          Object.assign(sw.style, {
            display: "inline-block",
            width: "16px",
            height: "16px",
            backgroundColor: cat.color,
            marginRight: "8px",
          });
          li.appendChild(sw);

          // name text
          li.appendChild(document.createTextNode(cat.name));
          li.dataset.type = cat.type;

          const buttonContainer = document.createElement("div");
          buttonContainer.style.marginLeft = "auto";
          buttonContainer.style.display = "flex";
          buttonContainer.style.gap = "8px";

          // edit button
          const editBtn = document.createElement("button");
          editBtn.textContent = "Edit";
          editBtn.addEventListener("click", () => startEdit(cat));
          buttonContainer.appendChild(editBtn);

          // delete button
          const deleteBtn = document.createElement("button");
          deleteBtn.textContent = "Delete";
          deleteBtn.style.backgroundColor = "#dc3545";
          deleteBtn.addEventListener("click", () => deleteCategory(cat.id));
          buttonContainer.appendChild(deleteBtn);

          li.appendChild(buttonContainer);
          list.appendChild(li);
        });

        // cache for analytics
        categoriesCache = e.target.result;
      };
  }

  function deleteCategory(categoryId) {
    if (!confirm("Are you sure you want to delete this category?")) return;

    const tx = db.transaction(["categories", "logs"], "readwrite");
    
    // Delete the category
    tx.objectStore("categories").delete(categoryId);

    // Delete all logs for this category
    tx.objectStore("logs").openCursor().onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.categoryId === categoryId) {
          cursor.delete();
        }
        cursor.continue();
      }
    };

    tx.oncomplete = () => {
      loadCategories();
      loadDay(selectedDate);
      if (document.querySelector("#analyticsView.active")) {
        renderAnalytics(selectedDate);
      }
    };
  }

  function startEdit(cat) {
    editingId = cat.id;
    document.getElementById("categoryName").value  = cat.name;
    document.getElementById("categoryType").value  = cat.type;
    document.getElementById("categoryColor").value = cat.color;
    document.getElementById("saveCategoryBtn").textContent = "Save Changes";
  }

  function resetForm() {
    editingId = null;
    document.getElementById("categoryForm").reset();
    document.getElementById("categoryColor").value = "#0096B1";
    document.getElementById("saveCategoryBtn").textContent = "Add Category";
  }

  function onCategorySubmit(e) {
    e.preventDefault();
    const name  = document.getElementById("categoryName").value.trim();
    const type  = document.getElementById("categoryType").value;
    const color = document.getElementById("categoryColor").value;
    if (!name) return;

    const tx = db.transaction("categories", "readwrite");
    const store = tx.objectStore("categories");
    const data = editingId
      ? { id: editingId, name, type, color }
      : { name, type, color };

    store.put(data).onsuccess = () => {
      resetForm();
      loadCategories();
    };
  }

  // --- Dashboard & time-blocks ---
  function changeDateBy(days) {
    const dt = new Date(selectedDate);
    dt.setDate(dt.getDate() + days);
    selectedDate = dt.toISOString().split("T")[0];
    document.getElementById("selectedDate").value = selectedDate;
    loadDay(selectedDate);
  }

  function loadDay(date) {
    generateTimeBlocks();
    setTimeout(() => loadPreviousAssignments(date), 50);
  }

  function generateTimeBlocks() {
    const c = document.getElementById("timeBlocksContainer");
    c.innerHTML = "";
    for (let h = 7; h <= 23; h++) {
      for (let m = 0; m < 60; m += 15) {
        if (h === 23 && m > 0) break;
        const lbl = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        const block = document.createElement("div");
        block.className = "time-block";
        block.dataset.time = lbl;
        block.textContent = lbl;
        block.addEventListener("click", () => showCategoryDropdown(block, selectedDate));
        c.appendChild(block);
      }
    }
  }

  function showCategoryDropdown(block, date) {
    if (block.querySelector("select")) return;
    const sel = document.createElement("select");
    db.transaction("categories", "readonly")
      .objectStore("categories")
      .getAll().onsuccess = e => {
        const cats = e.target.result;
        const ph = document.createElement("option");
        ph.textContent = "-- Choose Category --";
        ph.disabled = ph.selected = true;
        sel.appendChild(ph);
        cats.forEach(cat => {
          const o = document.createElement("option");
          o.value = cat.id;
          o.textContent = cat.name;
          sel.appendChild(o);
        });
        sel.addEventListener("change", () => {
          const chosen = cats.find(c => c.id == sel.value);
          assignCategoryToBlock(block, chosen);
          saveBlockAssignment(block.dataset.time, chosen, date);
          setTimeout(() => loadPreviousAssignments(date), 50);
        });
        block.appendChild(sel);
      };
  }

  function assignCategoryToBlock(block, category) {
    block.classList.add("assigned");
    block.style.background = category.color;
    block.dataset.type = category.type;
    block.textContent = `${block.dataset.time} — ${category.name}`;
  }

  function saveBlockAssignment(time, category, date) {
    const key = `${date}_${time}`;
    db.transaction("logs", "readwrite")
      .objectStore("logs")
      .put({ key, time, categoryId: category.id });
  }

  function loadPreviousAssignments(date) {
    const tx = db.transaction(["logs", "categories"], "readonly");
    tx.objectStore("logs").getAll().onsuccess = e => {
      const logs = e.target.result.filter(l => l.key.startsWith(date));
      if (!logs.length) return;
      tx.objectStore("categories").getAll().onsuccess = ev => {
        const cats = ev.target.result;
        logs.forEach(l => {
          const cat = cats.find(c => c.id === l.categoryId);
          const blk = document.querySelector(`.time-block[data-time="${l.time}"]`);
          if (blk && cat) assignCategoryToBlock(blk, cat);
        });
      };
    };
  }

  // --- Day Progress Bar ---
  function updateDayProgress() {
    const now = new Date();
    const ln = new Date(now.toLocaleString("en-GB", { timeZone: "Europe/London" }));
    const total = 16 * 60;
    const mins = ln.getHours() * 60 + ln.getMinutes() - 7 * 60;
    const pct = Math.max(0, Math.min(mins, total)) / total * 100;
    const bar = document.getElementById("dayProgress");
    if (bar) bar.style.width = pct + "%";
  }

  // --- Analytics ---
  function renderAnalytics(date) {
    if (!categoriesCache.length) return setTimeout(() => renderAnalytics(date), 100);
    const totalBlocks = 16 * 4 + 1;
    db.transaction("logs", "readonly")
      .objectStore("logs")
      .getAll().onsuccess = e => {
        const logs = e.target.result.filter(l => l.key.startsWith(date));
        const noiseCount = logs.filter(l => {
          const c = categoriesCache.find(x => x.id === l.categoryId);
          return c && c.type === "NOISE";
        }).length;
        const signalCount = logs.length - noiseCount;
        const noisePct = ((noiseCount / totalBlocks) * 100).toFixed(1);
        const signalPct = ((signalCount / totalBlocks) * 100).toFixed(1);
        drawDonut("noiseChart", noisePct, "#F44336");
        drawDonut("signalChart", signalPct, "#4CAF50");
        renderBreakdown(logs, totalBlocks);
      };
  }

  function drawDonut(id, pct, color) {
    const r = 50, c = 2 * Math.PI * r;
    const dash = (pct / 100) * c, rem = c - dash;
    document.getElementById(id).innerHTML = `
      <svg viewBox="0 0 120 120">
        <circle class="circle-bg" cx="60" cy="60" r="${r}" />
        <circle class="circle" cx="60" cy="60" r="${r}"
          stroke="${color}" stroke-dasharray="${dash} ${rem}" />
        <text x="60" y="60" transform="rotate(90 60 60)">${pct}%</text>
      </svg>`;
  }

  function renderBreakdown(logs, totalBlocks) {
    const container = document.getElementById("analyticsBreakdown");
    container.innerHTML = "";
    const counts = {};
    logs.forEach(l => counts[l.categoryId] = (counts[l.categoryId] || 0) + 1);

    categoriesCache.forEach(cat => {
      const count = counts[cat.id] || 0;
      if (!count) return;
      const hours = (count * 15) / 60;
      const pct = ((count / totalBlocks) * 100).toFixed(1);
      const item = document.createElement("div");
      item.className = "breakdown-item";
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

});
