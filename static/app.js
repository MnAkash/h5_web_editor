import * as THREE from "/static/vendor_three.module.js";
import { OrbitControls } from "/static/vendor_orbitcontrols.js";
import { TransformControls } from "/static/vendor_transformcontrols.js";

const viewer = document.getElementById("viewer");
const fileInput = document.getElementById("h5File");
const fileStatus = document.getElementById("fileStatus");
const demoSelect = document.getElementById("demoSelect");
const pointInfo = document.getElementById("pointInfo");
const xInput = document.getElementById("xInput");
const yInput = document.getElementById("yInput");
const zInput = document.getElementById("zInput");
const applyBtn = document.getElementById("applyBtn");
const deselectBtn = document.getElementById("deselectBtn");
const axisButtons = Array.from(document.querySelectorAll(".axisBtn"));
const sizeInput = document.getElementById("sizeInput");
const outputName = document.getElementById("outputName");
const saveBtn = document.getElementById("saveBtn");
const downloadLink = document.getElementById("downloadLink");

let fileId = null;
let eefPos = [];
let selectedIdx = null;
let axisMode = "free";
let pointSize = parseFloat(sizeInput?.value || "0.001");
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
let handle = new THREE.Object3D();
scene.add(handle);
let pointTexture = null;
let clickStart = null;

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

function buildScene(points) {
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
  fitCamera(points);
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

function setSelected(idx) {
  selectedIdx = idx;
  if (!pointsGeom) return;
  const colors = pointsGeom.getAttribute("color");
  for (let i = 0; i < colors.count; i++) {
    colors.setXYZ(i, baseColor.r, baseColor.g, baseColor.b);
  }
  if (idx !== null && idx >= 0) {
    colors.setXYZ(idx, selectedColor.r, selectedColor.g, selectedColor.b);
    const pos = getPoint(idx);
    handle.position.set(pos[0], pos[1], pos[2]);
    transform.attach(handle);
    pointInfo.textContent = `Index ${idx}`;
    xInput.value = pos[0].toFixed(5);
    yInput.value = pos[1].toFixed(5);
    zInput.value = pos[2].toFixed(5);
  } else {
    transform.detach();
    pointInfo.textContent = "None";
  }
  colors.needsUpdate = true;
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

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  clickStart = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (event.button !== 0) return;
  if (!pointsGeom || !clickStart) return;
  const dx = event.clientX - clickStart.x;
  const dy = event.clientY - clickStart.y;
  clickStart = null;
  if (transform.dragging) return;
  if (Math.hypot(dx, dy) > 4) return;
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
    setSelected(idx);
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
    undoStack.push({ idx: dragStart.idx, prev: dragStart.pos, next: [...current] });
  }
  dragStart = null;
});

async function uploadFile() {
  const file = fileInput.files[0];
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

fileInput.addEventListener("change", uploadFile);

async function loadDemo() {
  if (!fileId) return;
  const demoKey = demoSelect.value;
  const res = await fetch(`/api/demo?file_id=${fileId}&demo_key=${demoKey}`);
  if (!res.ok) return;
  const data = await res.json();
  eefPos = data.eef_pos;
  buildScene(eefPos);
  setSelected(null);
}

demoSelect.addEventListener("change", loadDemo);

applyBtn.addEventListener("click", () => {
  if (selectedIdx === null) return;
  const prev = [...getPoint(selectedIdx)];
  const pos = [parseFloat(xInput.value), parseFloat(yInput.value), parseFloat(zInput.value)];
  if (pos.some((v) => Number.isNaN(v))) return;
  updatePoint(selectedIdx, pos);
  handle.position.set(pos[0], pos[1], pos[2]);
  undoStack.push({ idx: selectedIdx, prev, next: [...pos] });
});

deselectBtn.addEventListener("click", () => {
  setSelected(null);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setSelected(null);
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    const last = undoStack.pop();
    if (!last) return;
    setSelected(last.idx);
    updatePoint(last.idx, last.prev);
    handle.position.set(last.prev[0], last.prev[1], last.prev[2]);
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
  };
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

setAxisMode("free");
