"""PPO trainer template for a Kindling env server (src/rl/protocol.ts), from Grudge's tools/ml/train.py. CPU only
(torch on the CPU: never GPU compute on the machine driving the desktop).

WORKERS env processes run NENV games each and step in lockstep; one batched forward pass picks every agent's action
per step. The network is an MLP body (HIDDEN, tanh) with one categorical head per action head from the env's INFO
spec and a value head. HEAD0_BIAS starts each head biased toward action 0 (Grudge: "do what the scripted CPU would"),
so the agent begins at the scripted bot's strength and learns where to deviate.

  ENV_CMD="node --experimental-transform-types --no-warnings tools/env.ts" RUN=runs/x python3 train.py
  BASELINE=1 ... python3 train.py        # always action 0: the scripted bot's own win rate, for comparison

Env vars: ENV_CMD (required), RUN, WORKERS, NENV, T (rollout length), HIDDEN ("256,256"), LR, ENT, MAX_UPDATES,
THREADS, HEAD0_BIAS (default 0 = off), CWD (working directory for the env command).
Checkpoints: RUN/latest.pt every 10 updates (resumed automatically), RUN/uNNNNN.pt every 100; RUN/log.jsonl.
"""

import json
import os
import shlex
import subprocess
import sys
import time
from collections import deque

import numpy as np
import torch
import torch.nn as nn

ENV_CMD = shlex.split(os.environ.get("ENV_CMD", ""))
CWD = os.environ.get("CWD", os.getcwd())
RUN = os.environ.get("RUN", "runs/default")
WORKERS = int(os.environ.get("WORKERS", 4))
NENV = int(os.environ.get("NENV", 8))
T = int(os.environ.get("T", 128))
HIDDEN = [int(x) for x in os.environ.get("HIDDEN", "256,256").split(",")]
GAMMA, LAM = float(os.environ.get("GAMMA", 0.995)), float(os.environ.get("LAM", 0.95))
EPOCHS, MINIBATCH = int(os.environ.get("EPOCHS", 4)), int(os.environ.get("MINIBATCH", 4096))
CLIP, VF = 0.2, 0.5
ENT = float(os.environ.get("ENT", 0.003))
LR = float(os.environ.get("LR", 2.5e-4))
HEAD0_BIAS = float(os.environ.get("HEAD0_BIAS", 0))
BASELINE = bool(os.environ.get("BASELINE"))
torch.set_num_threads(int(os.environ.get("THREADS", 2)))


def env_info():
    if not ENV_CMD:
        sys.exit("set ENV_CMD to the env server command")
    out = subprocess.run(ENV_CMD, cwd=CWD, env={**os.environ, "INFO": "1"}, capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


class Envs:
    """WORKERS env server processes, stepped in lockstep."""

    def __init__(self, obs, heads):
        self.obs, self.heads = obs, heads
        self.procs = []
        for k in range(WORKERS):
            env = {**os.environ, "NENV": str(NENV), "SEED": str(1 + k * 1_000_003 + int(time.time()) % 100_000)}
            env.pop("INFO", None)
            self.procs.append(subprocess.Popen(ENV_CMD, cwd=CWD, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE))

    def _read(self, p, n):
        b = p.stdout.read(n * 4)
        if len(b) != n * 4:
            raise RuntimeError("env worker died")
        return np.frombuffer(b, dtype=np.float32)

    def reset(self):
        return np.concatenate([self._read(p, NENV * self.obs) for p in self.procs]).reshape(-1, self.obs)

    def step(self, acts):
        a = acts.astype(np.int32).reshape(WORKERS, NENV * len(self.heads))
        for p, row in zip(self.procs, a):
            p.stdin.write(row.tobytes())
            p.stdin.flush()
        obs, rew, done, res = [], [], [], []
        for p in self.procs:
            obs.append(self._read(p, NENV * self.obs))
            tail = self._read(p, NENV * 3).reshape(3, NENV)
            rew.append(tail[0])
            done.append(tail[1])
            res.append(tail[2])
        return (np.concatenate(obs).reshape(-1, self.obs), np.concatenate(rew), np.concatenate(done),
                np.concatenate(res))


class Net(nn.Module):
    def __init__(self, obs, heads):
        super().__init__()
        layers, n = [], obs
        for h in HIDDEN:
            layers += [nn.Linear(n, h), nn.Tanh()]
            n = h
        self.body = nn.Sequential(*layers)
        self.heads = nn.ModuleList([nn.Linear(n, k) for k in heads])
        self.value = nn.Linear(n, 1)
        for head in self.heads:
            nn.init.orthogonal_(head.weight, 0.01)
            nn.init.zeros_(head.bias)
            if HEAD0_BIAS:
                head.bias.data[0] = HEAD0_BIAS
        nn.init.orthogonal_(self.value.weight, 1.0)

    def forward(self, x):
        h = self.body(x)
        return [head(h) for head in self.heads], self.value(h).squeeze(-1)


def main():
    info = env_info()
    OBS, HEADS = info["obs"], info["heads"]
    N = WORKERS * NENV
    os.makedirs(RUN, exist_ok=True)
    with open(os.path.join(RUN, "spec.json"), "w") as f:
        json.dump({**info, "hidden": HIDDEN}, f)
    net = Net(OBS, HEADS)
    opt = torch.optim.Adam(net.parameters(), lr=LR, eps=1e-5)
    update, frames = 0, 0
    mean, var, count = np.zeros(OBS), np.ones(OBS), 1e-4
    ck = os.path.join(RUN, "latest.pt")
    if os.path.exists(ck) and not BASELINE:
        s = torch.load(ck, weights_only=False)
        net.load_state_dict(s["net"])
        opt.load_state_dict(s["opt"])
        update, frames = s["update"], s["frames"]
        mean, var, count = s["mean"], s["var"], s["count"]
        print(f"resumed update {update}, {frames} decisions", flush=True)

    def norm(o):
        return np.clip((o - mean) / np.sqrt(var + 1e-8), -8, 8).astype(np.float32)

    envs = Envs(OBS, HEADS)
    obs = envs.reset()
    results, rets = deque(maxlen=400), deque(maxlen=400)
    ep_ret = np.zeros(N)
    t_start = time.time()

    if BASELINE:
        games = 0
        while games < int(os.environ.get("GAMES", 500)):
            obs, rew, done, res = envs.step(np.zeros((N, len(HEADS)), np.int64))
            for k in np.nonzero(done)[0]:
                results.append(res[k])
                games += 1
        r = np.array(results)
        print(json.dumps({"baseline_games": games, "win": float((r > 0).mean()), "loss": float((r < 0).mean())}))
        return

    log = open(os.path.join(RUN, "log.jsonl"), "a")
    H = len(HEADS)
    while update < int(os.environ.get("MAX_UPDATES", 10**9)):
        update += 1
        buf_o = np.zeros((T, N, OBS), np.float32)
        buf_a = np.zeros((T, N, H), np.int64)
        buf_lp, buf_v, buf_r, buf_d = (np.zeros((T, N), np.float32) for _ in range(4))
        raw = np.zeros((T, N, OBS), np.float64)
        t0 = time.time()
        for t in range(T):
            raw[t] = obs
            o = norm(obs)
            with torch.no_grad():
                logits, v = net(torch.from_numpy(o))
                ds = [torch.distributions.Categorical(logits=lg) for lg in logits]
                acts = [d.sample() for d in ds]
                lp = sum(d.log_prob(a) for d, a in zip(ds, acts))
            a = torch.stack(acts, -1).numpy()
            buf_o[t], buf_a[t], buf_lp[t], buf_v[t] = o, a, lp.numpy(), v.numpy()
            obs, rew, done, res = envs.step(a)
            buf_r[t], buf_d[t] = rew, done
            ep_ret += rew
            for k in np.nonzero(done)[0]:
                results.append(res[k])
                rets.append(ep_ret[k])
                ep_ret[k] = 0
        t_roll = time.time() - t0
        # Running observation normaliser.
        flat = raw.reshape(-1, OBS)
        bm, bv, bc = flat.mean(0), flat.var(0), flat.shape[0]
        delta, tot = bm - mean, count + bc
        mean = mean + delta * bc / tot
        var = (var * count + bv * bc + delta**2 * count * bc / tot) / tot
        count = tot
        # GAE.
        with torch.no_grad():
            _, last_v = net(torch.from_numpy(norm(obs)))
        last_v = last_v.numpy()
        adv = np.zeros((T, N), np.float32)
        gae = np.zeros(N, np.float32)
        for t in reversed(range(T)):
            nv = last_v if t == T - 1 else buf_v[t + 1]
            nonterm = 1.0 - buf_d[t]
            gae = buf_r[t] + GAMMA * nv * nonterm - buf_v[t] + GAMMA * LAM * nonterm * gae
            adv[t] = gae
        ret = adv + buf_v
        bo = torch.from_numpy(buf_o.reshape(-1, OBS))
        ba = torch.from_numpy(buf_a.reshape(-1, H))
        blp = torch.from_numpy(buf_lp.reshape(-1))
        badv = torch.from_numpy(adv.reshape(-1))
        bret = torch.from_numpy(ret.reshape(-1))
        badv = (badv - badv.mean()) / (badv.std() + 1e-8)
        n = bo.shape[0]
        stats = []
        for _ in range(EPOCHS):
            perm = torch.randperm(n)
            for i in range(0, n, MINIBATCH):
                idx = perm[i:i + MINIBATCH]
                logits, v = net(bo[idx])
                ds = [torch.distributions.Categorical(logits=lg) for lg in logits]
                lp = sum(d.log_prob(ba[idx, h]) for h, d in enumerate(ds))
                ratio = (lp - blp[idx]).exp()
                pg = -torch.min(ratio * badv[idx], ratio.clamp(1 - CLIP, 1 + CLIP) * badv[idx]).mean()
                vl = (v - bret[idx]).pow(2).mean()
                ent = sum(d.entropy() for d in ds).mean()
                loss = pg + VF * vl - ENT * ent
                opt.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(net.parameters(), 0.5)
                opt.step()
                stats.append((pg.item(), vl.item(), ent.item(), ((ratio - 1).abs() > CLIP).float().mean().item()))
        frames += T * N
        pg, vl, ent, cf = np.mean(stats, 0)
        r = np.array(results) if results else np.zeros(1)
        row = {
            "update": update,
            "decisions": frames,
            "hours": round((time.time() - t_start) / 3600, 3),
            "games": len(results),
            "win": round(float((r > 0).mean()), 3),
            "loss": round(float((r < 0).mean()), 3),
            "ret": round(float(np.mean(rets)) if rets else 0, 2),
            "action0_share": round(float((buf_a == 0).all(-1).mean()), 3),
            "ent": round(float(ent), 3),
            "vl": round(float(vl), 3),
            "clipfrac": round(float(cf), 3),
            "sps": round(T * N / t_roll),
        }
        print(json.dumps(row), flush=True)
        log.write(json.dumps(row) + "\n")
        log.flush()
        if update % 10 == 0 or update == int(os.environ.get("MAX_UPDATES", 0)):
            s = {"net": net.state_dict(), "opt": opt.state_dict(), "update": update, "frames": frames,
                 "mean": mean, "var": var, "count": count, "hidden": HIDDEN, "heads": HEADS, "obs": OBS}
            torch.save(s, ck + ".tmp")
            os.replace(ck + ".tmp", ck)
            if update % 100 == 0:
                torch.save(s, os.path.join(RUN, f"u{update:05d}.pt"))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
