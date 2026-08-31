# TOPO for OpenClaw

TOPO is an ordinary OpenClaw plugin, **not** an OpenClaw memory-slot plugin.

OpenClaw's existing `memory-core` (or another selected memory implementation) stays responsible for fast agent-native working memory. TOPO adds durable governed context and provenance across tools.

## Hooks

- `before_prompt_build` — requests a small purpose-bound confirmed TOPO context packet.
- `agent_end` — after a successful run, sends user/assistant conversation turns to TOPO's raw capture inbox.

The plugin does not capture tool payloads or hidden system prompts.

## Install from this checkout

~~~bash
openclaw plugins install --link ./integrations/openclaw --force
openclaw plugins enable topo
~~~

Because TOPO uses conversation hooks, OpenClaw requires explicit conversation-hook access for non-bundled plugins. Merge this into `openclaw.json`:

~~~json
{
  "plugins": {
    "entries": {
      "topo": {
        "enabled": true,
        "hooks": {
          "allowConversationAccess": true
        }
      }
    }
  }
}
~~~

If you want context injection, do not set `allowPromptInjection: false` for this plugin.

Restart and inspect:

~~~bash
openclaw gateway restart
openclaw plugins inspect topo --runtime --json
~~~

## TOPO consent

TOPO Desktop independently controls:

- **Share context** — permits `before_prompt_build` retrieval.
- **Capture interactions** — permits `agent_end` source capture.

If TOPO is unavailable, the plugin queues the latest failed interaction snapshot per session under:

~~~text
~/.openclaw/topo-capture-queue.json
~~~

A later OpenClaw turn retries that queue. It cannot bypass TOPO's session-scoped capture permission.

## Memory relationship

Recommended roles:

- OpenClaw memory: bounded hot/working memory for the agent.
- TOPO: durable governed context, evidence, ageing and cross-agent memory.
- RACK: reusable practices and instructions for how the agent works.

TOPO should not be configured in `plugins.slots.memory`.
