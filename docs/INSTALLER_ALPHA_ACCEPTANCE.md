# Installer-first alpha acceptance

This checklist is for TOPO `0.1.1-alpha.1` clean-machine testing. It deliberately describes **only graphical user actions**.

## Windows x64

- [ ] Download the signed TOPO installer from the draft/release page.
- [ ] Windows shows TOPO's expected verified publisher identity; the test does not require bypassing SmartScreen or Defender.
- [ ] Install for the current user without an administrator terminal.
- [ ] Open TOPO from the normal app shortcut.
- [ ] First-run setup appears before the main memory manager.
- [ ] If Ollama is absent, **Install local engine** opens the normal Windows Ollama installer/download flow.
- [ ] After Ollama starts, **Check again** detects it.
- [ ] **Install qwen3:4b** downloads the recommended model from inside TOPO.
- [ ] **Set up browser capture** installs the bundled local bridge without a script or terminal.
- [ ] **Open extension folder** opens the exact folder to choose in Chrome/Edge.
- [ ] ChatGPT capture reaches TOPO and can be processed into candidates.
- [ ] Uninstalling TOPO does not silently delete `~/.topo/topo.sqlite`.

## Linux x64

Test at minimum on a current Ubuntu LTS-family desktop and one second mainstream desktop distribution used by the pilot.

- [ ] Install the `.deb` through the graphical package installer, or run the AppImage by opening it from the desktop/file manager.
- [ ] No post-install terminal instruction is required.
- [ ] Open TOPO from the desktop/app launcher.
- [ ] First-run setup appears before the main memory manager.
- [ ] If Ollama is absent, **Install local engine** opens the normal graphical PolicyKit authorisation prompt.
- [ ] The bundled, release-pinned Ollama installer completes without asking the user to paste a shell command.
- [ ] **Check again** detects the local engine.
- [ ] **Install qwen3:4b** downloads the recommended model from inside TOPO.
- [ ] **Set up browser capture** writes Native Messaging registration in the user's browser config without root access.
- [ ] **Open extension folder** opens the exact folder to choose in Chrome/Chromium/Edge.
- [ ] ChatGPT capture reaches TOPO and can be processed into candidates.

## Product-quality check

After setup, use supported AI tools normally for one working session and confirm:

- [ ] captured interactions arrive without manual export/import;
- [ ] candidate memory is source-grouped and reviewable quickly;
- [ ] no obvious assistant-only statement becomes user memory;
- [ ] a confirmed preference or project constraint is recalled through purpose-bound context;
- [ ] review results can be recorded against `docs/CAPTURE_EVALUATION.md`.

A build fails installer acceptance if the workaround is "open a terminal", "run this script", "ignore Defender/SmartScreen", or "disable a security control".
