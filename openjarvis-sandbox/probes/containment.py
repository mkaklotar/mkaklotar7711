"""Containment probe: is this container actually a sandbox?

Runs inside the jarvis container and checks the boundary itself, independent
of anything OpenJarvis does. Every check must PASS before you trust a test run.
Exit code 1 if any check fails.
"""

from __future__ import annotations

import os
import socket
import urllib.request

RESULTS: list[tuple[str, str, str]] = []


def record(name: str, ok: bool, detail: str, *, warn_only: bool = False) -> None:
    status = "PASS" if ok else ("WARN" if warn_only else "FAIL")
    RESULTS.append((status, name, detail))


def proc_status(field: str) -> str:
    with open("/proc/self/status") as fh:
        for line in fh:
            if line.startswith(field + ":"):
                return line.split(":", 1)[1].strip()
    return ""


def can_write(path: str) -> bool:
    try:
        with open(path, "a"):
            pass
    except OSError:
        return False
    try:
        os.remove(path)
    except OSError:
        pass
    return True


def can_connect(host: str, port: int, timeout: float = 4.0) -> tuple[bool, str]:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, "connected"
    except OSError as exc:
        return False, type(exc).__name__ + ": " + str(exc)[:60]


def host_candidates() -> tuple[list[str], str]:
    """Addresses that could be your machine, as seen from this network.

    A normal bridge gives the host x.y.z.1. With gateway_mode_ipv4=isolated the
    host has no address here and Docker hands .1 to a container instead, so
    .1 counts only if it is not Ollama and not us.
    """
    candidates: list[str] = []
    try:  # default route, if any (an internal network normally has none)
        with open("/proc/net/route") as fh:
            for line in list(fh)[1:]:
                fields = line.split()
                if fields[1] == "00000000" and fields[2] != "00000000":
                    gw = bytes.fromhex(fields[2])[::-1]
                    candidates.append(".".join(str(b) for b in gw))
    except OSError:
        pass
    note = ""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("ollama", 11434))  # UDP connect sends nothing
            own = s.getsockname()[0]
        dot_one = ".".join(own.split(".")[:3] + ["1"])
        ollama_ip = socket.gethostbyname("ollama")
        if dot_one in (own, ollama_ip):
            note = f"{dot_one} is a container here (isolated gateway: host has no address)"
        else:
            candidates.append(dot_one)
    except OSError:
        pass
    candidates.append("host.docker.internal")
    return list(dict.fromkeys(candidates)), note


def main() -> int:
    # --- identity and privileges ------------------------------------------
    record("runs as non-root", os.getuid() != 0, f"uid={os.getuid()}")
    record("no-new-privileges set", proc_status("NoNewPrivs") == "1",
           f"NoNewPrivs={proc_status('NoNewPrivs')}")
    cap_eff = proc_status("CapEff")
    record("no Linux capabilities", int(cap_eff or "1", 16) == 0, f"CapEff={cap_eff}")

    # --- filesystem --------------------------------------------------------
    record("image filesystem is read-only", not can_write("/etc/oj-probe"),
           "write to /etc refused")
    record("security config is immutable",
           not can_write(os.environ.get("OPENJARVIS_CONFIG", "/etc/openjarvis/locked.toml")),
           os.environ.get("OPENJARVIS_CONFIG", ""))
    env_cfg = os.environ.get("OPENJARVIS_CONFIG", "")
    home_cfg = os.path.join(os.environ.get("OPENJARVIS_HOME", ""), "config.toml")
    try:
        same = open(env_cfg, "rb").read() == open(home_cfg, "rb").read()
        detail = "identical" if same else "DIFFERENT CONTENT"
    except OSError as exc:
        same, detail = False, f"{type(exc).__name__}: {exc}"[:70]
    record("default-path config matches hardened config", same,
           f"{home_cfg} vs {env_cfg}: {detail}")
    record("default-path config is immutable", not can_write(home_cfg), home_cfg)
    record("cwd cannot gain a ./skills dir",
           not can_write(os.path.join(os.getcwd(), "skills")),
           f"cwd={os.getcwd()} (OpenJarvis trusts ./skills)")
    record("workspace is writable", can_write("/home/jarvis/workspace/.probe"),
           "/home/jarvis/workspace")
    record("docker socket not mounted", not os.path.exists("/var/run/docker.sock"),
           "/var/run/docker.sock absent")

    # --- network -------------------------------------------------------------
    ok, detail = can_connect("1.1.1.1", 443)
    record("no internet (raw IP)", not ok, detail)
    ok, detail = can_connect("pypi.org", 443)
    record("no internet (DNS name)", not ok, detail)

    try:
        with urllib.request.urlopen("http://ollama:11434/api/version", timeout=5) as r:
            body = r.read(200).decode()
        record("Ollama reachable on sandbox network", True, body.strip())
    except Exception as exc:  # noqa: BLE001
        record("Ollama reachable on sandbox network", False, str(exc)[:70])

    # Host services: an internal Docker network still has the host's bridge
    # address on-link. Anything on your machine listening on 0.0.0.0 may be
    # reachable from here. This is a WARN, not a FAIL: it depends on your host.
    ports = [int(p) for p in os.environ.get("OJ_PROBE_HOST_PORTS", "").split(",") if p.strip()]
    targets, note = host_candidates()
    if note:
        record("host has no address on sandbox network", True, note)
    for target in targets:
        for port in ports:
            ok, detail = can_connect(target, port, timeout=2)
            record(f"host service {target}:{port} unreachable", not ok, detail,
                   warn_only=True)

    # --- report --------------------------------------------------------------
    print("\n== Containment probe ==")
    for status, name, detail in RESULTS:
        print(f"  [{status}] {name:<42} {detail}")
    failed = [r for r in RESULTS if r[0] == "FAIL"]
    warned = [r for r in RESULTS if r[0] == "WARN"]
    print(f"  -> {len(RESULTS) - len(failed) - len(warned)} pass, "
          f"{len(warned)} warn, {len(failed)} fail")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
