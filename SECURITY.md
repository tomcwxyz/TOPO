# Security

TOPO is early-stage software handling potentially sensitive personal context. Treat current builds as experimental.

## Initial security posture

- Local operation is the default.
- Network services should bind to loopback by default.
- Non-loopback access must require explicit opt-in and authentication.
- Secrets, passphrases and encryption keys must not be placed in URL query strings.
- Cloud AI providers must be treated as disclosure boundaries: filtering output after extraction does not prevent source content being sent to that provider.
- Sensitivity metadata must be enforced when resolving context, not merely displayed in the UI.
- Audit/history data is potentially sensitive and must be included in any at-rest protection model.
- Analytics/telemetry are off by default.
- TOPO will not claim zero-knowledge or end-to-end encryption unless the implementation actually provides those guarantees.

## Threat-model work required before remote use

Before any remote, sync or managed service is considered production-ready, document and test:

- local process and filesystem attackers;
- browser extension compromise;
- malicious/imported content and prompt injection;
- cloud model disclosure;
- unauthorised MCP/HTTP clients;
- cross-user/workspace isolation if multi-user operation exists;
- backup/export leakage;
- log/history leakage;
- secret storage and rotation.

## Reporting

Please avoid opening a public issue for a vulnerability that exposes real user data, credentials or an exploitable remote-access path. Until a dedicated security reporting channel is established, contact the repository owner privately through GitHub.
