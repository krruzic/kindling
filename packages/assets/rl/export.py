"""Exports a train.py checkpoint to the JSON the TypeScript policy runtime loads (src/rl/policy.ts).

  python3 export.py <checkpoint.pt> <out.json> [head names, comma separated]

Layout: {obs, mean, std, clip, body: [{in, out, w (row-major), b, act: "tanh"}...], heads: [{in, out, w, b}...],
headNames, meta: {update, frames, hidden}}. Weights rounded to 5 decimals (small files, no visible change).
"""

import json
import os
import sys

import numpy as np
import torch


def layer(sd, k, act=None):
    w = sd[k + ".weight"].numpy()
    out = {
        "in": int(w.shape[1]),
        "out": int(w.shape[0]),
        "w": [round(float(v), 5) for v in w.reshape(-1)],
        "b": [round(float(v), 5) for v in sd[k + ".bias"].numpy()],
    }
    if act:
        out["act"] = act
    return out


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    s = torch.load(sys.argv[1], weights_only=False)
    sd = s["net"]
    body = sorted({int(k.split(".")[1]) for k in sd if k.startswith("body.")})
    heads = sorted({int(k.split(".")[1]) for k in sd if k.startswith("heads.")})
    out = {
        "obs": int(len(s["mean"])),
        "mean": [round(float(v), 6) for v in s["mean"]],
        "std": [round(float(v), 6) for v in np.sqrt(s["var"] + 1e-8)],
        "clip": 8,
        "body": [layer(sd, f"body.{i}", "tanh") for i in body],
        "heads": [layer(sd, f"heads.{i}") for i in heads],
        "meta": {"update": int(s["update"]), "frames": int(s["frames"]), "hidden": s.get("hidden")},
    }
    if len(sys.argv) > 3:
        out["headNames"] = sys.argv[3].split(",")
    os.makedirs(os.path.dirname(os.path.abspath(sys.argv[2])), exist_ok=True)
    with open(sys.argv[2], "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(sys.argv[2], os.path.getsize(sys.argv[2]) // 1024, "KB, update", out["meta"]["update"])


if __name__ == "__main__":
    main()
