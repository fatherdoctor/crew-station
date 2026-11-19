# Crew Station Development Guide

This document will help you set up your local development environment and get started with contributing to the project.
Contributions are much appreciated. You don't need to open an issue before starting: send a pull request directly, as a draft if you'd like to talk through the idea first.

- [Crew Station Development Guide](#crew-station-development-guide)
  - [Requirements](#requirements)
  - [Setting Up the Development Environment](#setting-up-the-development-environment)
    - [Installation](#installation-one-time-setup)
    - [Running the Page](#running-the-page)
    - [Running the Checks](#running-the-checks)
    - [Testing Your Changes](#testing-your-changes)
  - [Submitting a Pull Request](#submitting-a-pull-request)
  - [Adding Art](#adding-art)
  - [FAQ](#faq)

## Requirements

Before you begin, please ensure you have the following tools installed on your system:

- A modern web browser with its developer tools
- Git (latest version)
- Node.js, for the check script (no packages to install)
- Any static web server (the examples use Python 3's)
- Python 3 with Pillow and NumPy, only if you use the art scripts in `art-kit/tools/`

There is no build step, no bundler and no dependency install.

---

## Setting Up the Development Environment

### Installation (one-time setup)

1. Fork the repository:
   - Visit https://github.com/fatherdoctor/crew-station
   - Click the "Fork" button in the top right
   - Wait for GitHub to create your fork

2. Clone your fork:
   ```bash
   git clone https://github.com/[your-username]/crew-station.git
   cd crew-station
   ```

### Running the Page

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/. Reload to see your changes, and turn on "Disable cache" in the browser's developer tools while you work.

Useful switches while developing: `?demo=1` rotates the crew through their states, `?night=1` forces night, `?reducedmotion=1` removes particles, and `?bdgrid=1` draws the tile grid. [docs/AGENT-REFERENCE.md](docs/AGENT-REFERENCE.md#url-switches) lists them all.

### Running the Checks

```bash
# Check the assets, atlas, crew, rooms and sample board agree
node tools/check.js

# Check a board file of your own
node tools/check.js --board my-board.json

# Check a script for syntax errors
node --check js/fx.js
```

The check script doesn't see everything. [docs/AGENT-REFERENCE.md](docs/AGENT-REFERENCE.md#change-the-crew) says what it misses.

### Testing Your Changes

The check script can't see the page, so please test in a browser. Before submitting changes:

1. Run `node tools/check.js`; it must exit 0.
2. Load the page at desktop width and at a phone width of about 390 x 844.
3. Keep the console free of errors. A few warnings are normal on a healthy start, and [docs/AGENT-REFERENCE.md](docs/AGENT-REFERENCE.md#console-warnings-on-a-healthy-start) lists them. Look for anything new.
4. Try `?demo=1` and `?night=1` if your change touches the crew, lighting or board data.
5. Switch away from the tab and come back. The floors, halls and figures must still draw.

[docs/AGENT-REFERENCE.md](docs/AGENT-REFERENCE.md#behaviors-that-must-hold) lists the behaviors that must keep working.

---

## Submitting a Pull Request

No issue is needed. To submit a change:

1. Create a branch on your fork.
2. Keep the change focused, and match the style of the code around it.
3. Run through [Testing Your Changes](#testing-your-changes).
4. Open a pull request against `main` saying what changed, how you tested it, and which browsers you used. Include a screenshot for anything visible.

Keep the page static: no build step, framework or backend, and no network calls beyond the board file.

If you'd like early feedback on a bigger idea, open a draft pull request.

By contributing, you agree that your work is released under the [MIT License](LICENSE).

---

## Adding Art

Start with [art-kit/ART-GUIDE.md](art-kit/ART-GUIDE.md) for the style and sizes and [art-kit/TOOLS.md](art-kit/TOOLS.md) for the scripts. [docs/AGENT-REFERENCE.md](docs/AGENT-REFERENCE.md#how-the-art-fits-together) explains how the page uses it.

- Only add art you have the right to release under MIT.
- Hard-edged pixel art with real transparency, no text or logos, and no metadata.
- Any asset the page doesn't use will fail the check, so add its reference at the same time.

---

## FAQ

### Why does the page fail when I open `index.html` directly?

It fetches JSON, which browsers block from `file://`. Use a local web server.

### Why don't my changes show up?

Your browser is probably caching the old files. Turn on "Disable cache" in the developer tools and reload.

### Why does the check say a file is unreferenced?

Everything under `assets/` must be used by the page. Reference the new file, or remove it.

### How do I test a figure's states without changing the board?

Use `?demo=1`, or write a small board file and load it with `?board=`.
