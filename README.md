# kgscrape

Download a [KnowledgeGate](https://www.knowledgegate.ai/) course into a local
SQLite file so you can practise offline and export it to PDF.

* Every **PYQ** and **practice** question of the course, with options, exam
  labels, year, paper and section metadata.
* Course → subject → chapter → topic hierarchy preserved.
* PDF notes indexed with a direct in-app link (videos are ignored on purpose).
* PDF export with a table of contents, answer key and per-option explanations.
* Offline practice sessions in the terminal with per-topic/per-exam accuracy
  tracking.
* English only (the platform also serves Hindi, see `--lang`).

---

## Install

```bash
./install.sh          # creates .venv via uv, installs the CLI
```

or manually:

```bash
uv sync
uv run kgscrape --help
```

The script also copies your browser cookie export to `data/cookies.json` if
there is no working copy yet.

## 1. Provide your session

The scraper talks to the KnowledgeGate API with your own cookies - there is no
login inside the tool and no password is ever stored.

1. Sign in at <https://www.knowledgegate.ai/> in your browser.
2. Export the cookies for `knowledgegate.ai` (any cookie export extension works;
   the file must be a JSON array of `{name, value, domain, path}` objects).
3. Save them as `cookies.json` in the project root (or point `--cookies` at
   them).

The only cookies that matter are `accessToken` and `refreshToken`.  The access
token expires after an hour; the tool refreshes it automatically through
`POST /auth/refresh-token` and writes the fresh pair back to `data/cookies.json`.

```bash
uv run kgscrape doctor      # checks cookies, session and API reachability
```

## 2. Scrape a course

```bash
uv run kgscrape scrape --url "https://www.knowledgegate.ai/learn/SSC-JE-IMD-SCIENTIFIC-ASSISTANT-COMPUTER-SCIENCE?tab=content"
```

Options:

| flag | default | meaning |
|---|---|---|
| `--url` | the SSC-JE course | any `knowledgegate.ai/learn/<slug>` URL |
| `--db` | `data/kg.db` | SQLite file |
| `--kinds` | `pyq,practice` | which collections to download |
| `--concurrency` | `8` | parallel requests (max 16) |
| `--lang` | `en` | `en` or `hi` |
| `--no-resume` | off | re-download questions that are already stored |
| `--no-notes` | off | skip the notes index |

The run is resumable: re-running only fetches what is missing.  A full course of
~19 400 questions takes about 13-15 minutes at concurrency 8.

Check the result against the live course:

```bash
uv run kgscrape verify
```

## 3. Practise offline

```bash
uv run kgscrape practice --scope topic --slug basic-concept-of-analogy --count 20
uv run kgscrape practice --scope course --count 50        # mixed practice
uv run kgscrape stats --group-by topic
uv run kgscrape stats --group-by exam
```

Nothing here touches your KnowledgeGate account - attempts are stored locally.

## Web app

A local Next.js UI over the same `data/kg.db`: timed practice sessions, A-E
keyboard shortcuts, self-marking, permanent manual answer keys, Google/Gemini
lookup links, session history and accuracy/speed analytics.

```bash
cd web
cp .env.example .env.local     # optional, defaults to ../data/kg.db
npm install
npm run dev                    # http://localhost:3000
```

`KG_DB_PATH` overrides the database location (relative to `web/`). The web app
reads and writes the same SQLite file as the CLI; WAL mode handles the
concurrency.

## 4. Export

```bash
# full course with a table of contents and an answer key
uv run kgscrape export pdf --scope course --out out/course.pdf --with-solutions

# one chapter, questions only
uv run kgscrape export pdf --scope chapter --slug analogy --questions-only -o out/analogy.pdf

# answer key only
uv run kgscrape export pdf --scope course --answer-key-only -o out/key.pdf

# machine readable
uv run kgscrape export json --scope course -o out/course.json
```

`--scope` is one of `course`, `subject`, `chapter`, `topic`; `--slug` selects
the subject/chapter/topic slug.

## 5. Notes

```bash
uv run kgscrape notes                  # table of every note with its in-app link
uv run kgscrape notes --markdown       # markdown index
uv run kgscrape notes --download       # PDF bundle (needs a Plus/Pro admission)
```

Downloading the PDF bundle requires an active Plus or Pro admission - the free
plan gets HTTP 403 from `GET /course-notes/{courseListingId}/file`.  The
per-note links work in a signed-in browser.

---

## The answer key problem

KnowledgeGate **never sends the answer key to free accounts**.  A question
detail payload looks like this on the free tier:

```json
{"answer": null, "solution": null, "canViewSolution": false}
```

Around 30 different endpoint shapes were tested (`?includeSolution=true`,
`shape=solution|full|review`, `/answer`, `/reveal`, `/hint`, `/attempts`,
search and analytics routes, plus the public mirrors).  None of them expose the
key.  There are only two honest ways to get it:

**A. Upgrade to Plus/Pro.**  The same payload then carries
`answer.correctOption(s)`, `answer.correctAnswer`, the `solution` document and
`option.feedback`.

**B. Actually answer the question.**  The platform's own "attempt" endpoint
reports whether the option you picked was correct and returns a worked
explanation for it:

```
POST /api/v1/course-content/student/course/{slug}/{kind}/subtopic/{scopeId}
     /question/{questionId}/attempt
{"answer": <option id>}
```

`kgscrape unlock` uses this route:

```bash
uv run kgscrape unlock --limit 50            # asks questions to learn the key
uv run kgscrape unlock --dry-run             # just list the candidates
uv run kgscrape unlock --kinds pyq --subject general-intelligence-reasoning
```

The free tier budget, measured on the live API:

| bucket | attempts / day |
|---|---|
| `pyq` | 5 |
| `practice` | 15 |

That budget counts *attempts*, and finding the key of a 4-option question can
take up to 4 attempts (the explanation returned for a wrong option often names
the right one, which `kgscrape unlock` detects and uses - so usually 1-2).  So
a full unlock of 19 410 questions is a multi-year drip on the free tier; the
sensible strategy is to unlock the chapters you actually revise.

The unlocker records every derived answer with a source marker:

* `verified` - the API confirmed the option is correct.
* `inferred` - the option was named in the explanation of a wrong attempt.

Because it writes real attempt records, it affects your leaderboard and
analytics - it is opt-in and always asks first.

---

## How it works

```
course URL -> slug
  -> GET  /course-content/student/course/{slug}/summary        course + modules
  -> GET  /course-content/student/course/{slug}/modules/{mod}   subject/chapter/topic tree
  -> GET  /course-content/student/course/{slug}/{kind}/subtopic/{scopeId}/question/{id}
  -> POST /course-content/student/course/{slug}/{kind}/subtopic/{scopeId}/question/{id}/attempt
```

The scope id is the **collection's `originId`** (the topology UUID), not the id
of the topic node in the tree - using the wrong one returns HTTP 400.

### Database schema

| table | content |
|---|---|
| `course` | one row per course |
| `subject` | modules (13 for the SSC-JE course) |
| `chapter` | chapters inside a subject |
| `topic` | topics inside a chapter, with the collection `scope_id` |
| `question` | one row per question (19 410) |
| `option` | the four options with `is_correct` and `feedback` |
| `question_tag` | exam / year / paper / section tags |
| `note` | PDF notes with the in-app link |
| `attempt`, `session` | local practice history |
| `scrape_state` | resume bookkeeping |

`data/kg.db` is plain SQLite in WAL mode, so the Next.js frontend can read it
while the scraper writes.

## Layout

```
web/            Next.js practice UI and analytics

kgscraper/
  api.py        typed wrappers for every endpoint
  auth.py       cookie session, JWT expiry, automatic refresh
  client.py     httpx client with retries, backoff and a concurrency cap
  config.py     paths, concurrency, language
  notes.py      notes index + optional download
  practice.py   terminal practice sessions and statistics
  richtext.py   ProseMirror/Quill doc -> text / markdown / html
  scraper.py    the course walk
  store.py      SQLite schema and queries
  unlocker.py   answer-key extraction through real attempts
  web.py        in-app link builder
  export/       PDF and JSON exporters
  cli.py        the command line interface
```

## Commands

| command | what it does |
|---|---|
| `kgscrape doctor` | check the environment, the session and the API |
| `kgscrape scrape` | download a whole course |
| `kgscrape verify` | compare the local counts with the live course |
| `kgscrape unlock` | derive answer keys (writes attempts to your account) |
| `kgscrape notes` | list / download the PDF notes |
| `kgscrape practice` | run an offline practice session |
| `kgscrape stats` | accuracy per topic, exam, year, ... |
| `kgscrape export pdf` | render a PDF with TOC and answer key |
| `kgscrape export json` | dump everything as JSON |

## Notes and limitations

* Videos are never downloaded - they are skipped while indexing.
* The notes PDF bundle needs Plus/Pro; per-note links always work.
* Mock tests are not part of the scrape (the free tier returns no mock ids).
* The answer key needs a paid plan or the opt-in unlock drip.
* Everything is English; the API also serves Hindi translations.
