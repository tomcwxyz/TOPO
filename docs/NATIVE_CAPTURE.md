# TOPO browser native capture bridge

The browser extension should continue capturing when TOPO Desktop is not open.

The primary browser path is therefore:

~~~text
ChatGPT / Claude / Gemini
          |
     TOPO extension
          |
   Native Messaging
          |
 topo-native-host
          |
 ~/.topo/capture-inbox/
          |
    TOPO Desktop
   extract + compare
          |
      memory inbox
~~~

## Why a companion host?

A browser extension cannot safely discover TOPO's private desktop discovery files, and requiring the Tauri window to be running would make capture fragile.

The native messaging companion is deliberately small. It:

- accepts only the shared `CapturedInteraction` contract;
- requires at least one user-authored turn;
- writes the latest snapshot for an interaction atomically;
- never performs memory extraction;
- never confirms memory;
- never reads canonical TOPO claims;
- can be launched by the browser while TOPO Desktop is closed.

The desktop remains responsible for extraction, deduplication, retention and review.

## Local spool

The default inbox is:

~~~text
~/.topo/capture-inbox/
~~~

Each interaction has one JSON file keyed by its stable interaction ID. A later snapshot replaces the earlier snapshot atomically, so streaming browser re-renders do not create an unbounded queue.

On Unix, the directory is mode 0700 and capture files are mode 0600. Windows installation should apply the current user's ACL through the installer.

## Browser registration

The TOPO desktop installer will register the companion executable as the native messaging host:

~~~text
uk.co.goodship.topo.capture
~~~

Registration differs by browser and OS and belongs to the desktop installer/release work, not the extension itself.

The host manifest must restrict `allowed_origins` to released TOPO extension IDs. Development manifests should be separate from release manifests.

## Processing

TOPO Desktop should watch or periodically drain the inbox.

A file is not deleted merely because it was discovered. Processing should be:

1. parse and validate;
2. deduplicate against already processed source/turn IDs;
3. run extraction;
4. persist the Source and candidate/evidence changes transactionally;
5. mark the capture processed;
6. archive/delete raw capture according to retention policy.

If extraction fails, the file remains retryable and the desktop shows the failure in Connections/Capture diagnostics.
