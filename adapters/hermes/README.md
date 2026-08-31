# TOPO for Hermes Agent

TOPO integrates with Hermes as a **general plugin**, not a Hermes memory provider.

That is intentional:

- Hermes keeps its native working/hot memory.
- TOPO provides governed, cross-tool confirmed context when relevant.
- Hermes turns are captured as source material for TOPO extraction/review.
- RACK remains responsible for reusable AI working practices.

## Hooks

The plugin uses:

- `pre_llm_call` — asks running TOPO Desktop for a small purpose-bound context packet.
- `post_llm_call` — sends the successful turn/conversation snapshot to TOPO's raw capture inbox.

It captures user/assistant text only. Tool payloads and hidden system prompts are not copied into TOPO by this plugin.

## Consent

There are two independent opt-ins:

1. Hermes general plugins are opt-in through Hermes' own plugin enablement.
2. TOPO Desktop controls local permissions:
   - **Share context** for pre-turn retrieval.
   - **Capture interactions** for post-turn source capture.

If TOPO is closed or capture is disabled, the plugin keeps the latest failed snapshots in:

~~~text
~/.hermes/topo-capture-queue.json
~~~

They are retried when a later Hermes turn can reach TOPO. This does not bypass TOPO's session permission.

## Development install

Copy this directory to:

~~~text
~/.hermes/plugins/topo/
~~~

Then enable it:

~~~bash
hermes plugins enable topo
~~~

Restart the Hermes process after installation.

## Memory relationship

Do not set TOPO as `memory.provider`. Hermes memory providers are exclusive; TOPO is designed to sit alongside the selected provider.

A good eventual operating model is:

- Hermes memory: bounded fast working cache.
- TOPO: durable governed context and provenance.
- RACK: practices/instructions for how the agent works.
