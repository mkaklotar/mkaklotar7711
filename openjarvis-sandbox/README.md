# OpenJarvis offline sandbox

A disposable, offline Docker setup for trying [OpenJarvis](https://github.com/open-jarvis/OpenJarvis)
without giving it your files, your accounts, your network, or anything else on your machine.

It pins OpenJarvis to the commit that was code-reviewed (`427c2dd`, 2026-11-19), turns on the
security controls the default install leaves off, and ships **probes that prove the
containment holds** rather than asking you to trust the config.

## What you get

| Layer | Setting | Why |
|---|---|---|
| Network | `internal` Docker network, `gateway_mode_ipv4=isolated`, no published ports | No internet, and no access to services on your machine. A plain `internal: true` network still lets the container reach anything on your machine listening on `0.0.0.0`; the probe caught this, and the isolated gateway fixes it. |
| Process | uid 10001, all Linux capabilities dropped, `no-new-privileges`, pid/mem/CPU limits | No root, no privilege escalation. |
| Filesystem | Read-only image; writable only `/tmp`, the `workspace` volume and the state volume | Nothing on your disk is mounted. |
| Config | Hardened `config.toml` read-only at **both** paths OpenJarvis reads from | An agent with shell access cannot loosen its own policy. Some OpenJarvis commands read `OPENJARVIS_CONFIG` and some read the default path, so both are pinned. |
| Skills | Working directory is read-only | OpenJarvis auto-loads `./skills` as *trusted* workspace skills; nothing can plant one. |
| OpenJarvis | `profile = "shared"`, capability RBAC on with default-deny, file tools limited to `workspace`, analytics off, update check off | The personal/default profile has RBAC **off**. |

Two modes, selected with `OJ_MODE`:

- **`locked`** (default): chat and read-only tools. Shell, code execution, file writes, network,
  channels, scheduling and admin tools are denied.
- **`exec`**: adds shell, code execution and file writes so you can try the code-assistant agents.
  Still offline, unprivileged and read-only outside `workspace`. **Commands run without asking you**,
  because `jarvis ask` auto-approves tool calls. The container is the only boundary.

## Requirements

- Docker Engine **28 or newer** (Docker Desktop on Windows/macOS is fine). Check with `docker version`.
- About 10 GB free disk: OpenJarvis image ~2.3 GB, Ollama image ~5.4 GB, plus the model.
- 8 GB+ RAM. The default model `qwen3:1.7b` is small enough to run on CPU.

## Steps

All commands run from this folder. On Windows PowerShell, replace `OJ_MODE=exec docker ...`
with `$env:OJ_MODE="exec"; docker ...` and clear it afterwards with `Remove-Item Env:OJ_MODE`.

```bash
# 1. Build (fetches the pinned OpenJarvis commit from GitHub)
docker compose build

# 2. Download the model (the only step where Ollama has internet)
docker compose --profile setup run --rm ollama-pull

# 3. Prove the sandbox holds. Every line must be PASS; GAP lines are expected (see below).
docker compose run --rm jarvis probe
OJ_MODE=exec docker compose run --rm jarvis probe

# 4. Chat (locked mode)
docker compose run --rm jarvis

# 5. Smoke test with the real model: this must be refused in locked mode
docker compose run --rm jarvis ask --agent orchestrator --tools shell_exec "Run the id command"

# 6. Try code execution, contained
OJ_MODE=exec docker compose run --rm jarvis ask --agent orchestrator --tools shell_exec "Run the id command"
```

**If step 3 shows any FAIL or WARN, stop.** A `WARN host service ... connected` line means the
sandbox can reach something running on your machine. Most likely your Docker version ignores the
isolated-gateway option. Update Docker before going further.

Small models often answer in text instead of calling a tool, so step 5 may not exercise the
policy. For a deterministic check that doesn't depend on the model, see the next section.

### Deterministic end-to-end check (no model needed)

`probes/fake_ollama.py` stands in for Ollama and always asks the agent to run `shell_exec("id")`.
The real `jarvis ask` agent then has to go through the policy:

```bash
docker compose stop ollama
docker compose --profile e2e up -d ollama-fake
docker compose run --rm --no-deps jarvis ask --agent orchestrator --tools shell_exec --no-stream "go"
#   locked -> TOOL RESULT >>> Capability 'code:execute' denied for agent 'orchestrator' ...
OJ_MODE=exec docker compose run --rm --no-deps jarvis ask --agent orchestrator --tools shell_exec --no-stream "go"
#   exec   -> TOOL RESULT >>> uid=10001(jarvis) ...
docker compose --profile e2e rm -sf ollama-fake
```

### Installing a skill

Installing is a separate step. The fetch container has internet but no model and no agent:

```bash
docker compose --profile fetch run --rm skill-fetch hermes:arxiv
docker compose run --rm jarvis skill list          # back offline
```

It never passes `--yes-dangerous` or `--with-scripts`. A skill that **declares** shell, network-listen
or file-write access is refused and its `scripts/` directory is never copied. But a skill that simply
*doesn't declare* them installs fine (see the gaps below). Treat every community skill as untrusted text.

### Using a different model

Change `default_model` in **both** `config/locked.toml` and `config/exec.toml`, then run
`docker compose build` and `OJ_MODEL=qwen3:4b docker compose --profile setup run --rm ollama-pull`.
If you edit the configs without rebuilding, the probe fails on purpose, because the two config
copies no longer match.

### Moving files in and out

Nothing from your disk is mounted. To hand the agent a file, copy it into the `workspace`
volume with a throwaway container:

```bash
docker run --rm -v oj-sandbox_workspace:/w -v "$PWD/input:/in:ro" busybox cp -r /in/. /w/
docker run --rm -v oj-sandbox_workspace:/w -v "$PWD/output:/out" busybox cp -r /w/. /out/
```

### Wiping everything

```bash
docker compose --profile setup --profile fetch --profile e2e down -v   # containers, network, model, state, workspace
docker image rm oj-sandbox-jarvis:427c2dd
```

## Rules that keep it safe

Every one of these undoes part of the sandbox:

- Don't add `ports:`, host-folder mounts, or `/var/run/docker.sock` (that one is root on your machine).
- Don't run `jarvis connect` (Gmail, Drive, …) or put real API keys in here. Use throwaway accounts if you must.
- Don't pass `--yes-dangerous` or `--with-scripts` to skill installs.
- Don't run `jarvis gui` or `jarvis self-update` inside the container.
- Don't move the jarvis service onto the `egress` network to "fix" something.

## What this does not protect against

- **The model's output.** If it tells you to run something on your own machine, that's on you to check.
- **What you paste in.** Anything you type or copy into the workspace is visible to the agent.
- **Kernel-level escapes.** A container shares your kernel. For hostile code, use a VM.
- **Upstream changes.** Everything here is verified against commit `427c2dd`. If you bump
  `OJ_COMMIT` in the Dockerfile, re-review and re-run the probes.

## Upstream gaps the probe reproduces

These are weaknesses in OpenJarvis itself. The sandbox is built so they can't reach your machine,
but they matter if you ever run it outside one:

| Gap | Where |
|---|---|
| Default (personal) profile has capability RBAC off; combined with auto-approve, a model can run shell commands | `core/config.py` `CapabilitiesConfig.enabled = False` |
| `jarvis ask` and the GUI server auto-approve every tool confirmation (only `jarvis chat` asks) | `cli/ask.py:442`, `:480`; `server/agent_manager_routes.py` ×4 |
| Skill install gate trusts the skill's own capability declaration | `skills/importer.py:123-145` |
| Skill text reaches the model without the prompt-injection fence | `SkillTool` inherits `is_local = True` |
| The email/news digest collector marks its output as trusted | `tools/digest_collect.py:428` |

## Files

```
Dockerfile               pinned build, unprivileged runtime
compose.yaml             networks, hardening, setup/fetch/e2e profiles
entry.sh                 `probe` runs the checks; anything else goes to `jarvis`
config/locked.toml       hardened config, locked mode
config/exec.toml         hardened config, exec mode
config/policy-*.json     capability grants per mode
probes/containment.py    is the container a sandbox?
probes/security_probe.py do OpenJarvis's gates hold under this config?
probes/fake_ollama.py    deterministic tool-calling "model" for the e2e check
```
