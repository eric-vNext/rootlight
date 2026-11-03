# Rootlight

A GEDCOM family-tree explorer that runs entirely in your browser. Nothing is uploaded.

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
| 4 | **Timeline** | Lifespans set against world events. Hover to see everyone's age in that year. |
| 5 | **Almanac** | Stats, fun facts, a surname cloud, a birth-month wheel, and "on this day". |

The **story panel** writes a short biography for each person. It also shows their family and a life-and-times timeline, plus how they're related to the home person.

## Keyboard

`/` or `⌘K` search · `↑` father · `⇧↑` mother · `↓` child · `←` `→` siblings · `R` random relative · `H` home · `S` story panel · `T` theme · `Backspace` back

In search, `⇧↵` asks "how are we related?" and lights up the path between the two people.

## Files

- `js/gedcom.js`: the GEDCOM parser (UTF-8/UTF-16/ANSI, CONC/CONT, note records), the family model, and the relationship calculator
- `js/views/*.js`: one file per view
- `js/panel.js`: the story panel
- `js/app.js`: navigation, search, keyboard and persistence
- `sample/ashworth-family.ged`: a fictional demo family
