# TOPO with agent runtimes

TOPO should complement an agent's native memory, not replace it.

The working model is:

~~~text
agent-native memory
  bounded, fast, runtime-specific
           |
           | immediate working recall
           v
        agent turn
       /          \
RACK practices    TOPO context
how to work       what is known
       \          /
        agent turn
           |
           | user + assistant source capture
           v
          TOPO
   extract → review → durable memory
~~~

## Permissions

TOPO Desktop keeps three local permissions separate:

1. **Share context** — local tools can request purpose-bound confirmed ordinary/personal context.
2. **Capture interactions** — compatible local agents can submit raw user/assistant interaction sources to the capture inbox.
3. **Accept contributions** — local tools can explicitly propose candidate claims.

None implies another. All reset when TOPO Desktop restarts.

Agent lifecycle plugins should normally use **Share context + Capture interactions**.

They should not extract their own durable TOPO memories. TOPO's capture/extraction pipeline owns that decision.

## Hermes Agent

TOPO is a Hermes **general plugin**, not a `MemoryProvider`.

- `pre_llm_call` → purpose-bound TOPO retrieval.
- `post_llm_call` → raw successful conversation snapshot capture.
- Hermes' chosen memory provider remains active.

Development adapter: [../adapters/hermes/README.md](../adapters/hermes/README.md).

## OpenClaw

TOPO is an ordinary OpenClaw plugin alongside `memory-core` or another selected memory slot.

- `before_prompt_build` → purpose-bound TOPO retrieval for user turns.
- `agent_end` → raw successful conversation snapshot capture.
- TOPO does not occupy `plugins.slots.memory`.

Non-bundled OpenClaw plugins require explicit conversation-hook access in OpenClaw configuration in addition to TOPO's own permissions.

Development adapter: [../integrations/openclaw/README.md](../integrations/openclaw/README.md).

## Deferred capture

If TOPO Desktop is closed or the capture permission is off, each agent adapter keeps a small latest-snapshot queue in its own application state.

It retries only when a later turn can reach a running TOPO Desktop instance. This preserves the TOPO session consent boundary: plugins do not write directly into canonical memory or silently drop raw captures into TOPO while TOPO is not running.

## RACK relationship

RACK and TOPO remain complementary:

- **RACK** provides practices, instructions and repeatable working methods.
- **TOPO** provides governed context, provenance and durable cross-tool memory.
- **Agent-native memory** provides local working continuity.

A future agent installation flow can install/configure both the RACK practice adapter and TOPO lifecycle plugin together, while retaining separate permissions.
