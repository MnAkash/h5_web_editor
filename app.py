#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Web-based H5 trajectory editor (FastAPI + three.js frontend).

Run:
  python3 app.py --host 0.0.0.0 --port 8000

Then open:
  http://localhost:8000
"""
from __future__ import annotations

import argparse
import os
import shutil
import uuid
from typing import List, Optional

import h5py
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
INDEX_PATH = os.path.join(BASE_DIR, "index.html")
DATA_DIR = os.path.join(BASE_DIR, "_h5_editor_data")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
OUTPUT_DIR = os.path.join(DATA_DIR, "outputs")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

app = FastAPI()
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class SaveRequest(BaseModel):
    file_id: str
    demo_key: str
    eef_pos: List[List[float]]
    output_name: str
    keep_indices: Optional[List[int]] = None
    gripper: Optional[List[float]] = None


@app.get("/")
def index() -> FileResponse:
    return FileResponse(INDEX_PATH)


@app.post("/api/upload")
async def upload_h5(file: UploadFile = File(...)) -> JSONResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")
    file_id = uuid.uuid4().hex
    ext = os.path.splitext(file.filename)[1].lower() or ".h5"
    dst_path = os.path.join(UPLOAD_DIR, f"{file_id}{ext}")
    with open(dst_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    with h5py.File(dst_path, "r") as f:
        if "data" not in f:
            raise HTTPException(status_code=400, detail="Missing /data group")
        keys = [k for k in f["data"].keys()]
    return JSONResponse({"file_id": file_id, "filename": file.filename, "demo_keys": sorted(keys)})


@app.get("/api/demo")
def get_demo(file_id: str, demo_key: str) -> JSONResponse:
    path = _resolve_upload(file_id)
    with h5py.File(path, "r") as f:
        if "data" not in f or demo_key not in f["data"]:
            raise HTTPException(status_code=404, detail="Demo key not found")
        obs = f["data"][demo_key]["obs"]
        if "eef_pos" not in obs:
            raise HTTPException(status_code=404, detail="Missing eef_pos")
        eef_pos = np.asarray(obs["eef_pos"], dtype=np.float64)
        gripper = None
        if "gripper" in obs:
            g = np.asarray(obs["gripper"])
            if g.shape[0] >= eef_pos.shape[0]:
                g = g[: eef_pos.shape[0]]
                if g.ndim == 1:
                    gripper = g.astype(np.float64).tolist()
                else:
                    rest = int(np.prod(g.shape[1:]))
                    if rest == 1:
                        gripper = g.reshape((g.shape[0],)).astype(np.float64).tolist()
    if eef_pos.ndim != 2 or eef_pos.shape[1] != 3:
        raise HTTPException(status_code=400, detail="eef_pos must be Nx3")
    return JSONResponse({"eef_pos": eef_pos.tolist(), "gripper": gripper})


@app.post("/api/save")
def save_h5(req: SaveRequest) -> JSONResponse:
    src_path = _resolve_upload(req.file_id)
    out_name = _sanitize_name(req.output_name or "edited.h5")
    if not out_name.endswith(".h5") and not out_name.endswith(".hdf5"):
        out_name += ".h5"
    dst_path = os.path.join(OUTPUT_DIR, out_name)

    new_pos = np.asarray(req.eef_pos, dtype=np.float64)
    if new_pos.size == 0:
        new_pos = new_pos.reshape((0, 3))
    if new_pos.ndim != 2 or new_pos.shape[1] != 3:
        raise HTTPException(status_code=400, detail="eef_pos must be Nx3")

    with h5py.File(src_path, "r") as fin, h5py.File(dst_path, "w") as fout:
        if "data" not in fin or req.demo_key not in fin["data"]:
            raise HTTPException(status_code=404, detail="Demo key not found")
        src_demo_sel = fin["data"][req.demo_key]
        if "obs" not in src_demo_sel or "eef_pos" not in src_demo_sel["obs"]:
            raise HTTPException(status_code=400, detail="Missing obs/eef_pos")
        orig_len = int(src_demo_sel["obs"]["eef_pos"].shape[0])
        keep_indices = req.keep_indices
        if keep_indices is None:
            keep_indices = list(range(orig_len))
        if any((i < 0 or i >= orig_len) for i in keep_indices):
            raise HTTPException(status_code=400, detail="keep_indices out of range")
        if len(set(keep_indices)) != len(keep_indices):
            raise HTTPException(status_code=400, detail="keep_indices must be unique")
        if new_pos.shape[0] != len(keep_indices):
            raise HTTPException(status_code=400, detail="eef_pos length mismatch")
        keep_idx = np.asarray(keep_indices, dtype=np.int64)
        gripper_data = None
        gripper_shape = None
        if "gripper" in src_demo_sel["obs"]:
            gripper_shape = src_demo_sel["obs"]["gripper"].shape
            if req.gripper is not None:
                g = np.asarray(req.gripper, dtype=np.float64)
                if g.size == 0:
                    g = g.reshape((0,))
                if g.ndim != 1 or g.shape[0] != len(keep_indices):
                    raise HTTPException(status_code=400, detail="gripper length mismatch")
                if len(gripper_shape) == 1:
                    gripper_data = g
                else:
                    rest = int(np.prod(gripper_shape[1:]))
                    if rest != 1:
                        raise HTTPException(status_code=400, detail="gripper must be scalar")
                    gripper_data = g.reshape((len(keep_indices),) + gripper_shape[1:])

        def _slice_by_indices(data: np.ndarray, name: str) -> np.ndarray:
            if data.ndim == 0 or data.shape[0] < orig_len:
                raise HTTPException(status_code=400, detail=f"{name} length mismatch")
            if data.shape[0] > orig_len:
                data = data[:orig_len]
            return np.take(data, keep_idx, axis=0)

        for key in fin.keys():
            if key != "data":
                fin.copy(key, fout)
        fout.create_group("data")
        for demo_name in fin["data"].keys():
            src_demo = fin["data"][demo_name]
            dst_demo = fout["data"].create_group(demo_name)
            if "actions" in src_demo:
                if demo_name == req.demo_key:
                    actions = _slice_by_indices(src_demo["actions"][...], "actions")
                    dst_demo.create_dataset(
                        "actions",
                        data=actions,
                        dtype=actions.dtype,
                        compression="gzip",
                    )
                else:
                    src_demo.copy("actions", dst_demo)
            dst_obs = dst_demo.create_group("obs")
            src_obs = src_demo["obs"]
            for obs_key in src_obs.keys():
                data = src_obs[obs_key][...]
                if demo_name == req.demo_key:
                    if obs_key == "eef_pos":
                        data = new_pos
                    elif obs_key == "gripper" and gripper_data is not None:
                        data = gripper_data
                    else:
                        data = _slice_by_indices(data, f"obs/{obs_key}")
                dst_obs.create_dataset(obs_key, data=data, dtype=data.dtype, compression="gzip")

    return JSONResponse({"output_name": out_name, "download_url": f"/api/download/{out_name}"})


@app.get("/api/download/{name}")
def download(name: str) -> FileResponse:
    out_name = _sanitize_name(name)
    path = os.path.join(OUTPUT_DIR, out_name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, filename=out_name)


def _resolve_upload(file_id: str) -> str:
    for ext in (".h5", ".hdf5"):
        path = os.path.join(UPLOAD_DIR, f"{file_id}{ext}")
        if os.path.exists(path):
            return path
    raise HTTPException(status_code=404, detail="Uploaded file not found")


def _sanitize_name(name: str) -> str:
    base = os.path.basename(name.strip())
    return base.replace("..", "").replace("/", "").replace("\\", "")


def main() -> None:
    parser = argparse.ArgumentParser(description="H5 editor web server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
