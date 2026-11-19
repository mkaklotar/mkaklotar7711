"""A fake Ollama server that always asks the agent to run `shell_exec("id")`.

Lets you check, deterministically and without downloading a model, that the
real `jarvis ask` agent path enforces the sandbox policy: a model can *ask*
for a tool, and only the policy decides whether it runs.

Turn 1: reply with a tool call `shell_exec {"command": "id"}`.
Turn 2 (a tool result is in the conversation): reply with
        "TOOL RESULT >>> <whatever the tool returned>" and stop.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = "qwen3:1.7b"


def chat_reply(payload: dict) -> dict:
    messages = payload.get("messages", [])
    tool_msgs = [m for m in messages if m.get("role") == "tool"]
    if tool_msgs:
        message = {"role": "assistant",
                   "content": "TOOL RESULT >>> " + str(tool_msgs[-1].get("content", ""))}
    else:
        message = {"role": "assistant", "content": "",
                   "tool_calls": [{"function": {"name": "shell_exec",
                                                "arguments": {"command": "id"}}}]}
    return {"model": payload.get("model", MODEL), "message": message, "done": True,
            "done_reason": "stop", "prompt_eval_count": 1, "eval_count": 1}


class Handler(BaseHTTPRequestHandler):
    def _send(self, body: dict, ndjson: bool = False) -> None:
        data = (json.dumps(body) + ("\n" if ndjson else "")).encode()
        self.send_response(200)
        self.send_header("Content-Type",
                         "application/x-ndjson" if ndjson else "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/api/tags"):
            self._send({"models": [{"name": MODEL, "model": MODEL}]})
        else:
            self._send({"version": "fake-ollama"})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0") or 0)
        payload = json.loads(self.rfile.read(length) or b"{}")
        if self.path.startswith("/api/chat"):
            self._send(chat_reply(payload), ndjson=bool(payload.get("stream")))
        else:  # /api/show and anything else: harmless empty object
            self._send({})

    def log_message(self, fmt: str, *args) -> None:
        print("fake-ollama:", fmt % args, flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 11434), Handler).serve_forever()
