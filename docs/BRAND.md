# TOPO brand system

TOPO belongs to the wider Good Ship family, but it should not look like a reskinned sibling product. Its visual identity comes from its role: TOPO is where useful context accumulates, can be traced, and can be carried elsewhere.

The core idea is **memory as terrain**.

A capture leaves a trace. Extraction reveals features. Connections become paths. Repeated context builds terrain. Retrieval is finding a way back to something. Portability means carrying the map rather than being trapped inside the territory.

This metaphor should shape the visual system and interaction behaviour without replacing clear product language. We still say **Capture**, **Memory Page**, **Context**, **Review** and **Share** when those are the clearest words.

## Relationship to the wider tools

The family relationship is conceptual and tonal rather than a shared component skin.

- **TOPO — what you know.** Capture, structure and carry context and memory.
- **RACK — how you work.** Compose and maintain AI working practices.
- **CRUX — how you know it is working.** Observe, test and understand AI behaviour.
- **Ship Check — whether something is safe and ready to ship.**

Shared family traits: warm editorial presentation, near-black text, off-white foundations, plain language, restrained interface furniture, strong typography, local/open principles and a discreet `from Good Ship` relationship where appropriate.

TOPO's distinctive traits: contours, traces, annotations, moss/lichen accent colours, field-note reading surfaces and interactions that feel revealed or laid down rather than filed into a dashboard.

## Visual principles

### 1. Terrain, not dashboard

The application should feel like a landscape being gradually formed. Avoid grids of interchangeable SaaS cards where a quieter reading surface will work.

Memory Pages are the main terrain. Utility controls for capture, extraction and sharing sit around that terrain rather than competing with it.

### 2. Trace, not decoration

Contour lines are TOPO's primary graphic device. Use them sparingly in mastheads, empty states, onboarding, social images and occasional transitional moments. They should imply accumulated structure, not outdoor-adventure branding.

Do not turn every panel into a map.

### 3. Paper, annotation, marginalia

Surfaces should feel closer to a field notebook, marked-up map or editorial page than a control panel. Prefer hairlines, left rules, small markers and generous negative space to thick borders and nested boxes.

Metadata can behave like marginalia: smaller, quieter and visibly secondary to the thing being remembered.

### 4. Memory is readable

Memory Pages should optimise for reading first and editing second. Headings can use an editorial serif; interface controls remain a legible system sans; technical paths and subjects use monospace only where it adds meaning.

### 5. Quiet confidence

TOPO should not use novelty motion, glowing AI effects, gradients that imply magic, or constant status animation. The product is about provenance, control and durable context. Motion should clarify when a trace arrives, a page changes, or a connection is made.

## Colour

The initial desktop implementation defines these tokens in `apps/desktop/src/topo-brand.css`.

| Token | Value | Role |
| --- | --- | --- |
| `--topo-ink` | `#1d1d18` | Primary text and strong marks |
| `--topo-ink-soft` | `#59594f` | Secondary copy and metadata |
| `--topo-paper` | `#f1ede2` | Main background |
| `--topo-paper-raised` | `#f8f4ea` | Inputs and raised paper surfaces |
| `--topo-paper-deep` | `#e8e2d3` | Tags and subtle grouping |
| `--topo-moss` | `#68744d` | TOPO accent / traces |
| `--topo-moss-deep` | `#4f5a3b` | Accessible accent text and primary actions |
| `--topo-lichen` | `#dce4c7` | Confirmed / positive / settled states |
| `--topo-clay` | `#9a5847` | Errors and destructive emphasis |
| `--topo-clay-soft` | `#f0ddd6` | Error background |
| `--topo-warm` | `#eee0b3` | Candidate / unresolved state |

The moss accent is intentionally muted. TOPO should not become a generic green outdoor brand.

## Typography

The brand layer deliberately avoids a webfont dependency for the desktop app.

- **Display / reading headings:** Iowan Old Style, Palatino, Georgia fallback stack.
- **Interface:** Inter / system sans.
- **Technical annotations:** system monospace.

Large TOPO headlines should be editorial, tightly spaced and relatively light in weight. Small interface labels remain compact, uppercase and tracked where they act as map legends or annotations.

## The contour mark

The current contour motif is an abstract SVG embedded as a CSS asset. It is not a literal place and should not become one. That matters: TOPO is about the user's evolving terrain rather than a fixed mountain identity.

Use the contour mark at three scales:

1. **Mark** — a small cropped contour fragment beside or above TOPO.
2. **Field** — a larger, low-contrast contour field behind a masthead or empty state.
3. **Generated terrain** — future visualisations derived from real memory density or connections.

The third is the longer-term direction. Static contours should eventually give way, selectively, to representations based on actual TOPO data while remaining non-essential to understanding or navigation.

## Component behaviour

### Memory Page

A Memory Page is a reading surface, not a card. It should normally have:

- a fine top rule;
- a small trace/waypoint marker;
- title and summary with strong reading hierarchy;
- body copy with generous line-height;
- metadata below or in the margin;
- candidate/change states indicated through restrained colour rather than large banners.

### Capture

Capture is an entry point into the terrain. It may use a short vertical trace rule. Pending interactions are a sequence of traces, not a task backlog.

### Extraction

Extraction should communicate local processing clearly and calmly. Avoid anthropomorphic AI language. Prefer "Extract locally", "Review what was found" and explicit model/status information.

### Connections and sharing

Permissions are part of the map legend: clear, specific and reversible. Context sharing, capture authority and contribution authority remain visually and conceptually separate.

### Empty states

Use space and a quiet contour field. Empty-state language should explain what will accumulate here and the next meaningful action, rather than celebrating emptiness with generic illustrations.

## Motion

Default motion should be short and functional.

Useful future patterns:

- a new capture leaves a short trace before settling into the queue;
- extracted Memory Pages appear as if revealed from a layer rather than popping in as cards;
- a confirmed page's waypoint changes state without moving layout;
- newly discovered relationships can briefly draw a connecting path;
- terrain visualisations interpolate slowly when the underlying memory changes.

Always respect `prefers-reduced-motion`. No core state should rely on animation alone.

## Voice

TOPO is calm, specific and human. It explains what is happening without pretending the system has a human memory or mind.

Prefer:

- "3 interactions waiting"
- "Extract locally"
- "2 Memory Pages need review"
- "TOPO can share this context with…"
- "This came from…"

Avoid:

- "Your AI brain"
- "Magical memory"
- "TOPO knows you"
- "Second brain"
- technical architecture terms as primary interface labels when a plain-language equivalent exists.

## Accessibility and restraint

- Keep body text and important state labels at WCAG AA contrast or better.
- Do not use moss/clay colour alone to communicate state.
- Contours are always decorative and `pointer-events: none`; they must never contain necessary information.
- Reading widths should normally stay below roughly 72 characters for Memory Page body text.
- Maintain usable layouts down to narrow desktop/mobile-width windows.
- Respect reduced-motion preferences.

## What TOPO should not become

- a green version of every Good Ship product;
- a climbing app aesthetic;
- a conventional analytics dashboard;
- a graph visualisation everywhere merely because memory has relationships;
- an AI assistant character;
- a skeuomorphic paper notebook;
- a product where the metaphor gets in the way of clear words.

## Implementation sequence

### Brand pass 1 — current branch

- establish tokens and typography;
- add the contour motif to masthead, onboarding and empty states;
- make Memory Pages the dominant reading surface;
- reduce heavy card borders and dashboard furniture;
- distinguish capture/connection utilities from memory content;
- retain the existing product model and behaviour.

### Brand pass 2

- extract reusable brand primitives (`TopoMark`, `Trace`, `Waypoint`, `TerrainField`);
- redesign the header as a smaller persistent product masthead after first-run orientation;
- refine Capture and Memory Page review states around the trace model;
- introduce a discreet `from Good Ship` relationship in About/docs rather than the main wordmark.

### Brand pass 3

- prototype data-derived terrain from real Memory Page/connection density;
- use the same visual grammar for extension, installer, docs, website and social/OG assets;
- define a shared family layer with RACK/CRUX/Ship Check that shares principles and foundations without forcing identical components.

The test for every brand decision is simple: **does this make TOPO feel like a place where context accumulates and remains understandable, or is it merely styling software?**
