# Margin

Upload course material — lecture slides, a textbook chapter, notes, photos of a whiteboard — and get back a study guide built for actually studying:

- **Guide**: the material rewritten in plain English, section by section, with key points and a margin of **Remember** items (the things to memorize), plus “If you remember nothing else” and “Most likely on the exam”.
- **Terms & facts**: searchable glossary, numbers and dates to know, enumerated lists with memory aids, and a timeline.
- **Flashcards**: flip, grade (Again / Got it), missed cards come back sooner. Keyboard and swipe friendly. Optionally include the glossary.
- **Quiz**: multiple choice with explanations, a review of what you missed, and “retake the ones I missed”.
- **Narrator**: reads the guide aloud using your device’s voices, highlights the paragraph being read, and dims the rest. Adjustable speed and voice.

Works on phones and computers, in light and dark mode. Guides and progress are saved in your browser (IndexedDB); the server keeps nothing.

A complete sample guide for *Chapter 3 — Public Fire Protection* is bundled so you can try everything before adding an API key.

## Run it locally

Needs Node 22+ and an [Anthropic API key](https://console.anthropic.com/settings/keys).

```bash
npm install
cp .env.example .env        # then paste your key into .env
npm run dev                 # http://localhost:5173
```

To open it on your phone while it runs on your computer, use the “Network” URL Vite prints (same Wi‑Fi).

Try the UI without a key: `MOCK_GENERATION=1 npm run dev` replays the sample guide instead of calling the API.

## Deploy (use it from anywhere)

**Render** (free tier works): push this repo, then in Render choose **New → Blueprint** and select it. `render.yaml` sets everything up; you’ll be asked for `ANTHROPIC_API_KEY` and `APP_PASSCODE`.

**Anything that runs Docker** (Fly.io, Railway, a VPS): `docker build -t margin . && docker run -p 8787:8787 -e ANTHROPIC_API_KEY=… margin`.

Set `APP_PASSCODE` on any public deployment. Without it, anyone who finds the URL can generate guides on your API key. The app asks for the passcode once and remembers it on that device.

On a phone, use **Share → Add to Home Screen** to open it like an app.

## Configuration

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for generating guides |
| `APP_PASSCODE` | empty | Require a passcode to generate |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for generation |
| `CLAUDE_EFFORT` | `high` | `low` / `medium` / `high` / `xhigh` / `max` — higher is more careful and slower |
| `PORT` | `8787` | Server port |
| `MOCK_GENERATION` | unset | `1` replays the sample instead of calling the API |

## How it works

```
browser ──upload──▶ server/index.ts ──▶ Claude (structured JSON output, streamed)
   ▲                      │
   └──── NDJSON progress ─┘   stage → progress (sections / cards / questions) → done
```

- `server/extract.ts` turns uploads into content blocks. PDFs and images go to Claude as-is, so slides, tables, and diagrams are read visually. Word and PowerPoint files are converted to text, including speaker notes.
- `server/prompt.ts` holds the instructions: be faithful to the source, simplify without dropping testable facts, and write paragraphs that sound right when read aloud.
- `shared/guide.ts` is the guide’s shape. It is used as the JSON schema for Claude’s output and as the type the UI renders.
- `src/` is a React app with no UI framework. The type is Source Serif 4 for reading and IBM Plex Sans / Mono for the interface. The colors are warm paper with one teal accent, and a highlighter yellow used only for things to remember.

Limits: 10 files and 30 MB per guide (the API’s request limit is 32 MB). PDFs up to 600 pages.
