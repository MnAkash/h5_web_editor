import * as THREE from "/static/vendor_three.module.js";
import { OrbitControls } from "/static/vendor_orbitcontrols.js";
import { TransformControls } from "/static/vendor_transformcontrols.js";

const viewer = document.getElementById("viewer");
const fileInput = document.getElementById("h5File");
const fileStatus = document.getElementById("fileStatus");
const uploadSection = document.getElementById("uploadSection");
const demoSelect = document.getElementById("demoSelect");
const pointInfo = document.getElementById("pointInfo");
const xInput = document.getElementById("xInput");
const yInput = document.getElementById("yInput");
const zInput = document.getElementById("zInput");
const gInput = document.getElementById("gInput");
const applyBtn = document.getElementById("applyBtn");
const deleteBtn = document.getElementById("deleteBtn");
const deselectBtn = document.getElementById("deselectBtn");
const rectSelectBtn = document.getElementById("rectSelectBtn");
const gridToggleBtn = document.getElementById("gridToggleBtn");
const axisButtons = Array.from(document.querySelectorAll(".axisBtn"));
const sizeInput = document.getElementById("sizeInput");
const outputName = document.getElementById("outputName");
const saveBtn = document.getElementById("saveBtn");
const downloadLink = document.getElementById("downloadLink");
const selectionRect = document.getElementById("selectionRect");

let fileId = null;
let eefPos = [];
let liveIndices = [];
let gripperVals = null;
let selectedIdx = null;
let selectedIndices = new Set();
let selectionMode = "point";
let axisMode = "free";
let pointSize = parseFloat(sizeInput?.value || "0.001");
let gridVisible = true;
const undoStack = [];
let dragStart = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf2f2f2);

const camera = new THREE.PerspectiveCamera(60, 1, 0.001, 1000);
camera.position.set(0.8, 0.6, 0.6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const transform = new TransformControls(camera, renderer.domElement);
transform.setMode("translate");
transform.addEventListener("dragging-changed", (event) => {
  controls.enabled = !event.value;
});
scene.add(transform);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const baseColor = new THREE.Color(0x4c78a8);
const selectedColor = new THREE.Color(0xe45756);

let pointsGeom = null;
let pointsObj = null;
let lineObj = null;
let gridHelper = null;
let handle = new THREE.Object3D();
scene.add(handle);
let pointTexture = null;
let clickStart = null;
let rectStart = null;
let rectActive = false;

function resize() {
  const w = viewer.clientWidth;
  const h = viewer.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", resize);
resize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

function buildScene(points, fit = true) {
  if (pointsObj) scene.remove(pointsObj);
  if (lineObj) scene.remove(lineObj);

  if (!pointTexture) {
    pointTexture = createCircleTexture();
  }
  const positions = new Float32Array(points.flat());
  const colors = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    colors[i * 3] = baseColor.r;
    colors[i * 3 + 1] = baseColor.g;
    colors[i * 3 + 2] = baseColor.b;
  }

  pointsGeom = new THREE.BufferGeometry();
  pointsGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  pointsGeom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const pointsMat = new THREE.PointsMaterial({
    size: pointSize,
    vertexColors: true,
    map: pointTexture,
    transparent: true,
    alphaTest: 0.5,
    depthWrite: false,
  });
  pointsObj = new THREE.Points(pointsGeom, pointsMat);
  scene.add(pointsObj);

  const lineGeom = new THREE.BufferGeometry();
  lineGeom.setAttribute("position", new THREE.BufferAttribute(positions.slice(), 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x888888 });
  lineObj = new THREE.Line(lineGeom, lineMat);
  scene.add(lineObj);

  updatePickThreshold();
  updateGrid(points);
  if (fit) {
    fitCamera(points);
  }
}

function createCircleTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2.1, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function fitCamera(points) {
  if (points.length === 0) return;
  const box = new THREE.Box3();
  for (const p of points) {
    box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]));
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim * 2.5 + 0.1;
  camera.position.copy(center.clone().add(new THREE.Vector3(dist, dist, dist)));
  controls.target.copy(center);
  controls.update();
}

function updateGrid(points) {
  if (gridHelper) {
    scene.remove(gridHelper);
    gridHelper = null;
  }
  if (points.length === 0) {
    gridHelper = createGridHelper(1, new THREE.Vector3(0, 0, 0));
    if (gridVisible) scene.add(gridHelper);
    return;
  }
  const box = new THREE.Box3();
  for (const p of points) {
    box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]));
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, 0.001);
  const gridSize = Math.max(maxDim * 2, 0.1);
  gridHelper = createGridHelper(gridSize, center);
  if (gridVisible) scene.add(gridHelper);
}

function createGridHelper(gridSize, center) {
  const divisions = 20;
  const helper = new THREE.GridHelper(gridSize, divisions, 0xc0c0c0, 0xe0e0e0);
  helper.rotation.x = Math.PI / 2;
  helper.position.set(center.x, center.y, center.z);
  if (Array.isArray(helper.material)) {
    for (const mat of helper.material) {
      mat.transparent = true;
      mat.opacity = 0.6;
    }
  } else {
    helper.material.transparent = true;
    helper.material.opacity = 0.6;
  }
  return helper;
}

function setGridVisible(visible) {
  gridVisible = visible;
  if (!gridHelper) {
    updateGrid(eefPos);
  }
  if (gridHelper) {
    if (gridVisible) {
      scene.add(gridHelper);
    } else {
      scene.remove(gridHelper);
    }
  }
  if (gridToggleBtn) {
    gridToggleBtn.classList.toggle("active", !gridVisible);
    gridToggleBtn.setAttribute("aria-pressed", (!gridVisible).toString());
    gridToggleBtn.textContent = gridVisible ? "Hide Grid" : "Show Grid";
  }
}

function setSelection(indices) {
  selectedIndices = new Set(indices);
  selectedIdx = selectedIndices.size === 1 ? indices[0] : null;

  if (pointsGeom) {
    const colors = pointsGeom.getAttribute("color");
    for (let i = 0; i < colors.count; i++) {
      colors.setXYZ(i, baseColor.r, baseColor.g, baseColor.b);
    }
    for (const idx of selectedIndices) {
      if (idx >= 0 && idx < colors.count) {
        colors.setXYZ(idx, selectedColor.r, selectedColor.g, selectedColor.b);
      }
    }
    colors.needsUpdate = true;
  }

  if (selectedIdx !== null && eefPos[selectedIdx]) {
    const pos = getPoint(selectedIdx);
    handle.position.set(pos[0], pos[1], pos[2]);
    transform.attach(handle);
    pointInfo.textContent = `Index ${selectedIdx}`;
    xInput.value = pos[0].toFixed(5);
    yInput.value = pos[1].toFixed(5);
    zInput.value = pos[2].toFixed(5);
    if (gInput) {
      if (gripperVals && gripperVals[selectedIdx] !== undefined) {
        gInput.value = Number(gripperVals[selectedIdx]).toFixed(5);
      } else {
        gInput.value = "";
      }
    }
  } else {
    transform.detach();
    pointInfo.textContent = selectedIndices.size > 1 ? `Selected ${selectedIndices.size}` : "None";
    xInput.value = "";
    yInput.value = "";
    zInput.value = "";
    if (gInput) gInput.value = "";
  }
}

function getPoint(idx) {
  return eefPos[idx];
}

function updatePoint(idx, pos) {
  eefPos[idx] = pos;
  const positions = pointsGeom.getAttribute("position");
  positions.setXYZ(idx, pos[0], pos[1], pos[2]);
  positions.needsUpdate = true;
  const linePos = lineObj.geometry.getAttribute("position");
  linePos.setXYZ(idx, pos[0], pos[1], pos[2]);
  linePos.needsUpdate = true;
}

function setAxisMode(mode) {
  axisMode = mode;
  if (mode === "free") {
    transform.showX = true;
    transform.showY = true;
    transform.showZ = true;
    transform.showXY = true;
    transform.showYZ = true;
    transform.showXZ = true;
  } else {
    transform.showX = mode === "x";
    transform.showY = mode === "y";
    transform.showZ = mode === "z";
    transform.showXY = false;
    transform.showYZ = false;
    transform.showXZ = false;
  }
}

function updateSelectionRectVisual(startX, startY, endX, endY) {
  if (!selectionRect) return;
  const viewerRect = viewer.getBoundingClientRect();
  const left = Math.min(startX, endX) - viewerRect.left;
  const top = Math.min(startY, endY) - viewerRect.top;
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  selectionRect.style.left = `${left}px`;
  selectionRect.style.top = `${top}px`;
  selectionRect.style.width = `${width}px`;
  selectionRect.style.height = `${height}px`;
}

function endRectSelection() {
  rectActive = false;
  if (selectionRect) {
    selectionRect.style.display = "none";
  }
  controls.enabled = selectionMode !== "rect";
}

function selectPointsInRect(startX, startY, endX, endY) {
  if (!pointsGeom) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const minX = Math.min(startX, endX);
  const maxX = Math.max(startX, endX);
  const minY = Math.min(startY, endY);
  const maxY = Math.max(startY, endY);
  const selected = [];
  for (let i = 0; i < eefPos.length; i++) {
    const pos = eefPos[i];
    const proj = new THREE.Vector3(pos[0], pos[1], pos[2]).project(camera);
    const sx = (proj.x * 0.5 + 0.5) * rect.width + rect.left;
    const sy = (-proj.y * 0.5 + 0.5) * rect.height + rect.top;
    if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
      selected.push(i);
    }
  }
  setSelection(selected);
}

function setSelectionMode(mode) {
  selectionMode = mode;
  const isRect = selectionMode === "rect";
  if (rectSelectBtn) {
    rectSelectBtn.classList.toggle("active", isRect);
    rectSelectBtn.setAttribute("aria-pressed", isRect ? "true" : "false");
  }
  if (isRect) {
    controls.enabled = false;
    controls.enableRotate = false;
    controls.enablePan = false;
  } else {
    controls.enabled = true;
    controls.enableRotate = true;
    controls.enablePan = true;
    if (rectActive) endRectSelection();
    rectStart = null;
  }
}

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  clickStart = { x: event.clientX, y: event.clientY };
  if (selectionMode === "rect") {
    rectStart = { x: event.clientX, y: event.clientY };
    rectActive = true;
    if (selectionRect) {
      selectionRect.style.display = "block";
      updateSelectionRectVisual(rectStart.x, rectStart.y, rectStart.x, rectStart.y);
    }
    controls.enabled = false;
  }
});

renderer.domElement.addEventListener("pointermove", (event) => {
  if (!rectActive || !rectStart) return;
  updateSelectionRectVisual(rectStart.x, rectStart.y, event.clientX, event.clientY);
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (event.button !== 0) return;
  if (!clickStart) {
    if (rectActive) endRectSelection();
    rectStart = null;
    return;
  }
  const dx = event.clientX - clickStart.x;
  const dy = event.clientY - clickStart.y;
  const dragDistance = Math.hypot(dx, dy);
  clickStart = null;
  if (!pointsGeom) {
    if (rectActive) endRectSelection();
    rectStart = null;
    return;
  }
  if (transform.dragging) {
    if (rectActive) endRectSelection();
    return;
  }
  if (selectionMode === "rect" && rectActive && rectStart) {
    const start = { ...rectStart };
    endRectSelection();
    rectStart = null;
    if (dragDistance > 4) {
      selectPointsInRect(start.x, start.y, event.clientX, event.clientY);
      return;
    }
  }
  if (dragDistance > 4) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(pointsObj);
  if (intersects.length > 0) {
    let best = null;
    for (const hit of intersects) {
      const idx = hit.index;
      const pos = getPoint(idx);
      const proj = new THREE.Vector3(pos[0], pos[1], pos[2]).project(camera);
      const sx = (proj.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-proj.y * 0.5 + 0.5) * rect.height + rect.top;
      const dist = Math.hypot(event.clientX - sx, event.clientY - sy);
      if (!best || dist < best.dist) {
        best = { idx, dist };
      }
    }
    if (!best) return;
    const idx = best.idx;
    setSelection([idx]);
  }
});

transform.addEventListener("objectChange", () => {
  if (selectedIdx === null) return;
  const pos = [handle.position.x, handle.position.y, handle.position.z];
  updatePoint(selectedIdx, pos);
  xInput.value = pos[0].toFixed(5);
  yInput.value = pos[1].toFixed(5);
  zInput.value = pos[2].toFixed(5);
});

transform.addEventListener("mouseDown", () => {
  if (selectedIdx === null) return;
  dragStart = { idx: selectedIdx, pos: [...getPoint(selectedIdx)] };
});

transform.addEventListener("mouseUp", () => {
  if (!dragStart) return;
  const current = getPoint(dragStart.idx);
  if (current.some((v, i) => Math.abs(v - dragStart.pos[i]) > 1e-9)) {
    undoStack.push({ type: "single", idx: dragStart.idx, prev: dragStart.pos, next: [...current] });
  }
  dragStart = null;
});

async function uploadFileFrom(file) {
  if (!file) {
    fileStatus.textContent = "Select an H5 file first.";
    return;
  }
  const form = new FormData();
  form.append("file", file);
  fileStatus.textContent = "Uploading...";
  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    fileStatus.textContent = "Upload failed.";
    return;
  }
  const data = await res.json();
  fileId = data.file_id;
  fileStatus.textContent = `Loaded ${data.filename}`;
  demoSelect.innerHTML = "";
  for (const key of data.demo_keys) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key;
    demoSelect.appendChild(opt);
  }
  if (data.demo_keys.length > 0) {
    demoSelect.value = data.demo_keys[0];
    await loadDemo();
  }
}

async function uploadFile() {
  await uploadFileFrom(fileInput.files[0]);
}

fileInput.addEventListener("change", uploadFile);

function hasFileDrag(event) {
  return event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files");
}

function setDragHighlight(active) {
  if (!uploadSection) return;
  uploadSection.classList.toggle("drag-over", active);
}

let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (!hasFileDrag(event)) return;
  dragDepth += 1;
  setDragHighlight(true);
});

document.addEventListener("dragover", (event) => {
  if (!hasFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});

document.addEventListener("dragleave", (event) => {
  if (!hasFileDrag(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDragHighlight(false);
});

document.addEventListener("drop", (event) => {
  if (!hasFileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  setDragHighlight(false);
  const file = event.dataTransfer.files[0];
  if (file) uploadFileFrom(file);
});

function normalizeGripperData(gripper) {
  if (!Array.isArray(gripper)) return null;
  const flat = gripper.map((value) => (Array.isArray(value) ? value[0] : value));
  return flat;
}

async function loadDemo() {
  if (!fileId) return;
  const demoKey = demoSelect.value;
  const res = await fetch(`/api/demo?file_id=${fileId}&demo_key=${demoKey}`);
  if (!res.ok) return;
  const data = await res.json();
  eefPos = data.eef_pos;
  gripperVals = normalizeGripperData(data.gripper);
  if (gInput) {
    gInput.disabled = !gripperVals || gripperVals.length === 0;
    gInput.value = "";
  }
  liveIndices = eefPos.map((_, idx) => idx);
  buildScene(eefPos, true);
  setSelection([]);
}

demoSelect.addEventListener("change", loadDemo);

applyBtn.addEventListener("click", () => {
  if (selectedIndices.size === 0) return;
  const xVal = parseFloat(xInput.value);
  const yVal = parseFloat(yInput.value);
  const zVal = parseFloat(zInput.value);
  const gVal = gInput ? parseFloat(gInput.value) : NaN;
  const hasX = !Number.isNaN(xVal);
  const hasY = !Number.isNaN(yVal);
  const hasZ = !Number.isNaN(zVal);
  const hasG = !!gripperVals && !Number.isNaN(gVal);
  if (!hasX && !hasY && !hasZ && !hasG) return;

  const items = [];
  for (const idx of selectedIndices) {
    const prevPos = [...getPoint(idx)];
    const nextPos = [...prevPos];
    if (hasX) nextPos[0] = xVal;
    if (hasY) nextPos[1] = yVal;
    if (hasZ) nextPos[2] = zVal;
    const posChanged = nextPos.some((v, i) => Math.abs(v - prevPos[i]) > 1e-9);

    let prevGrip;
    let nextGrip;
    let gripChanged = false;
    if (gripperVals) {
      prevGrip = gripperVals[idx];
      nextGrip = prevGrip;
      if (hasG) {
        nextGrip = gVal;
        gripChanged = Math.abs(nextGrip - prevGrip) > 1e-9;
      }
    }

    if (posChanged) updatePoint(idx, nextPos);
    if (gripperVals && gripChanged) gripperVals[idx] = nextGrip;

    if (posChanged || gripChanged) {
      items.push({ idx, prev: prevPos, next: nextPos, prevGrip, nextGrip });
    }
  }

  if (items.length === 0) return;
  if (items.length === 1) {
    const only = items[0];
    undoStack.push({ type: "single", idx: only.idx, prev: only.prev, next: [...only.next] });
    if (only.prevGrip !== undefined) {
      undoStack[undoStack.length - 1].prevGrip = only.prevGrip;
      undoStack[undoStack.length - 1].nextGrip = only.nextGrip;
    }
    if (selectedIdx !== null) {
      const pos = getPoint(selectedIdx);
      handle.position.set(pos[0], pos[1], pos[2]);
      xInput.value = pos[0].toFixed(5);
      yInput.value = pos[1].toFixed(5);
      zInput.value = pos[2].toFixed(5);
      if (gInput && gripperVals && gripperVals[selectedIdx] !== undefined) {
        gInput.value = Number(gripperVals[selectedIdx]).toFixed(5);
      }
    }
    return;
  }

  undoStack.push({ type: "bulk", items });
});

function deleteSelectedPoints() {
  if (selectedIndices.size === 0) return;
  const toDelete = Array.from(selectedIndices).sort((a, b) => b - a);
  const removed = toDelete.map((idx) => ({
    idx,
    pos: [...eefPos[idx]],
    originalIdx: liveIndices[idx],
    grip: gripperVals ? gripperVals[idx] : undefined,
  }));

  for (const idx of toDelete) {
    eefPos.splice(idx, 1);
    liveIndices.splice(idx, 1);
    if (gripperVals) gripperVals.splice(idx, 1);
  }

  undoStack.push({
    type: "delete",
    removed: removed.sort((a, b) => a.idx - b.idx),
  });
  setSelection([]);
  buildScene(eefPos, false);
}

if (deleteBtn) {
  deleteBtn.addEventListener("click", () => {
    deleteSelectedPoints();
  });
}

deselectBtn.addEventListener("click", () => {
  setSelection([]);
});

if (rectSelectBtn) {
  rectSelectBtn.addEventListener("click", () => {
    setSelectionMode(selectionMode === "rect" ? "point" : "rect");
  });
}

if (gridToggleBtn) {
  gridToggleBtn.addEventListener("click", () => {
    setGridVisible(!gridVisible);
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setSelection([]);
  }
  if (event.key === "Delete") {
    event.preventDefault();
    deleteSelectedPoints();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    const last = undoStack.pop();
    if (!last) return;
    if (last.type === "delete") {
      for (const item of last.removed) {
        eefPos.splice(item.idx, 0, item.pos);
        liveIndices.splice(item.idx, 0, item.originalIdx);
        if (gripperVals) gripperVals.splice(item.idx, 0, item.grip);
      }
      buildScene(eefPos, false);
      setSelection(last.removed.map((item) => item.idx));
      return;
    }
    if (last.type === "bulk") {
      const indices = [];
      for (const item of last.items) {
        updatePoint(item.idx, item.prev);
        if (gripperVals && item.prevGrip !== undefined) {
          gripperVals[item.idx] = item.prevGrip;
        }
        indices.push(item.idx);
      }
      setSelection(indices);
      return;
    }
    const idx = last.idx;
    updatePoint(idx, last.prev);
    if (gripperVals && last.prevGrip !== undefined) {
      gripperVals[idx] = last.prevGrip;
    }
    setSelection([idx]);
  }
});

axisButtons.forEach((btn) => {
  btn.addEventListener("click", () => setAxisMode(btn.dataset.axis));
});

if (sizeInput) {
  sizeInput.addEventListener("change", () => {
    const value = parseFloat(sizeInput.value);
    if (Number.isNaN(value) || value <= 0) return;
    pointSize = value;
    if (pointsObj && pointsObj.material) {
      pointsObj.material.size = pointSize;
      pointsObj.material.needsUpdate = true;
    }
    updatePickThreshold();
  });
}

function updatePickThreshold() {
  raycaster.params.Points.threshold = Math.max(pointSize * 0.8, 0.001);
}
saveBtn.addEventListener("click", async () => {
  if (!fileId) return;
  const demoKey = demoSelect.value;
  const outName = outputName.value.trim() || "edited.h5";
  const payload = {
    file_id: fileId,
    demo_key: demoKey,
    eef_pos: eefPos,
    output_name: outName,
    keep_indices: liveIndices,
  };
  if (gripperVals) {
    payload.gripper = gripperVals;
  }
  const res = await fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    fileStatus.textContent = "Save failed.";
    return;
  }
  const data = await res.json();
  downloadLink.textContent = `Download ${data.output_name}`;
  downloadLink.href = data.download_url;
  downloadLink.click();
});

setSelectionMode(selectionMode);
setGridVisible(gridVisible);
setAxisMode("free");
