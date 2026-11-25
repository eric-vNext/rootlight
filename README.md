# Rootlight

A GEDCOM family-tree explorer that runs entirely in your browser. Nothing is uploaded.

The Timeline's world-event photos and summaries ship with the app (`img/world/` and `js/world-data.js`, made by `node scripts/bake-world.mjs` on macOS). Anything missing is fetched from Wikipedia and Wikimedia Commons: only the fixed list of events, never anything from your file, and only images Commons marks as public domain or CC0. Offline, it falls back to generated artwork.

**Ask about the family (Claude app only).** When Rootlight runs inside Claude (as an artifact or an installed app), an **✧ Ask** button opens a panel for plain-language questions like “Who lived longest?” or “How am I related to Walter?”. Answers name people as links you can click. It's off until you turn it on, and you choose what Claude may see: only the people a question is about plus their close family (the default), or the whole tree. It sends names, dates, places, jobs and family links to Anthropic's Claude on your Claude account, never photos or notes, and each answer lists who was sent. **Include living relatives** is off by default: living people are then sent without names, dates, places or jobs (just an ID and their family links), and their names are taken out of your question. Answers still show their names on your screen. Relationships are computed by Rootlight, not guessed by the model. On the regular website the button doesn't appear and nothing is sent.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8765
```

Then visit http://localhost:8765. Add `?sample` to the URL to jump straight into the demo family.

## Views

| Key | View | What it shows |
| --- | --- | --- |
| 1 | **Tree** | An hourglass with ancestors above, descendants below, and siblings and spouses on either side. Cards glide when you change focus. |
| 2 | **Fan** | An ancestor fan you can colour by surname, birth country, century or paternal/maternal line, with an "ancestor bingo" completeness score. |
| 3 | **Stars** | A force-directed constellation of relatives. The **Time Machine** slider (or ▶ play) shows who was alive in any year. |
| 4 | **Timeline** | A cinematic river of time. Lifespans flow beneath eras and 50 key world events, each shown with a public-domain photograph, plus who in the family was alive to see it and how old they were. Drag the gold marker, tap a medallion, or press ▶ to play through history. |
| 5 | **Almanac** | Stats, fun facts, a surname cloud, a birth-month wheel, and "on this day". |

**Photos.** GEDCOM files only name their pictures, so give Rootlight the files: open a `.gdz` or `.zip` bundle, drop or choose a photo folder, or use the 📷 button after opening a file. Photos replace initials on tree cards, in search, on the timeline and in the story panel, which also gets a gallery and viewer. Each picture is shrunk once and kept in your browser (IndexedDB), so reopening the file brings them back. Originals are never stored or uploaded.

The **story panel** writes a short biography for each person. It also shows their family and a life-and-times timeline, plus how they're related to the home person.

## Keyboard

`/` or `⌘K` search · `A` ask (in the Claude app) · `↑` father · `⇧↑` mother · `↓` child · `←` `→` siblings · `R` random relative · `H` home · `S` story panel · `T` theme · `Backspace` back

In search, `⇧↵` asks "how are we related?" and lights up the path between the two people.

## Files

- `js/gedcom.js`: the GEDCOM parser (UTF-8/UTF-16/ANSI, CONC/CONT, note records), the family model, and the relationship calculator
- `js/media.js`: opens `.gdz`/`.zip` bundles, photo folders and loose images (zip reader included, no libraries), and matches photo references to the files supplied
- `js/photos.js`: shrinks and stores matched photos, fills avatars, and runs the photo viewer
- `js/asktree.js`: builds the text sent to Claude for Ask (person lines, tree facts, retrieval, computed relationships) and reads person links back out of answers
- `js/ask.js`: the Ask panel, shown only when the Claude runtime offers it
- `js/appicon.js`: draws the sprout logo as the installed app's Dock and window icon (only runs inside the installed app)
- `test/`: `node test/media.test.js`, `node test/zip.test.js`, `node test/match.test.js` and `node test/asktree.test.js`
- `js/world.js`: eras, world events, and the Wikimedia Commons image lookup
- `js/views/*.js`: one file per view
- `js/panel.js`: the story panel
- `js/app.js`: navigation, search, keyboard and persistence
- `sample/ashworth-family.ged`: a fictional demo family
