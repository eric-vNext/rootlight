# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two groups, often linked by the same file:

- **Genealogy hobbyists** who build their trees in Ancestry, RootsMagic, Family Tree Maker, FamilySearch, MyHeritage and similar apps. They export a GEDCOM and want a more engaging way to browse and show their own work.
- **The relatives they share it with.** These are mostly non-experts who are handed a `.ged` or `.gdz` file and want to see where they fit, who their ancestors were, and what their lives looked like.

## Product Purpose

Rootlight opens a GEDCOM file in the browser and turns it into something people want to explore. It offers an hourglass family tree, an ancestor fan, a constellation of relatives, a river-of-time timeline against world history, an almanac of stats and facts, and a generated story for every person. Success means a relative who has never used a genealogy app opens the file, finds themselves, and keeps wandering. A hobbyist should come away with a better way to show their research than the app they built it in.

## Positioning

A storytelling explorer, not a research or editing tool. Genealogy apps are built for collecting and correcting data. Rootlight takes that finished data and brings it to life: written biographies, how two people are related, who was alive for the Titanic or the Moon landing and how old they were, and family photos in place of initials. It does all of this without accounts and without the file ever leaving the visitor's computer.

## Operating Context

- **Input:** a GEDCOM export (5.5, 5.5.1 or 7.0). It can be a `.ged` file, or a `.gdz`/`.zip` bundle that includes photos. A photo folder can also be supplied alongside the file. Exports come from many different apps and are often messy: mixed encodings, one-sided family links, and Windows absolute paths for photos.
- **How it opens:** a file is dropped or chosen in the browser. The last file and its shrunk photos are remembered in that browser, so the visitor can reopen them without re-supplying anything.
- **Where it runs:** hosted on GitHub Pages at https://eric-vnext.github.io/rootlight/. `?sample` opens a fictional demo family.

## Capabilities and Constraints

**Firm constraints**
- **Data stays in the browser.** Nothing from a user's file or photos is ever uploaded. The only outside requests are for a fixed list of world events (summaries from Wikipedia, public-domain or CC0 images from Wikimedia Commons). Photo references that are web links are never fetched.
- **Static site, no build step.** Plain HTML, CSS and JavaScript that also runs from `file://`. D3 comes from cdnjs. There is no framework and no bundler.
- **Read-only.** Rootlight views GEDCOM data and never edits or exports it. Photos come only from the GEDCOM's own references plus the files the user supplies. Adding photos to a person by hand is deliberately not offered yet.

**Supported but not a binding rule:** phone layouts. A mobile layout exists and is maintained, but it is not a hard constraint on every decision.

**Terminology:** "home person" is the person every relationship label is measured from. "Focus" is the person currently centered in view. "Story panel" is the per-person biography side panel.

**Undecided:**
- Showing users what went wrong when photos are missing, unmatched or ambiguous (phase 6 of the photo plan).
- How the default home person is chosen. Today it is the person with the most known ancestors.

## Brand Commitments

- **Name:** Rootlight.
- **Founding brief:** the original request was for a "really unique and fun user experience" for browsing a family tree. The tone should be warm and wondering rather than clinical. Copy speaks to the family ("welcome, Maya's family"), not to a database.

## Evidence on Hand

- `sample/ashworth-family.ged`: a fictional family of 53 people. It contains no real people and no photos.
- World-event imagery is fetched from Wikimedia Commons at runtime, limited to public domain or CC0, with credits shown.
- There are no testimonials, user counts, press or real-family examples. Future work must not invent any.

## Product Principles

1. **Stories over records.** Every view should answer a human question: who were they, how are we connected, what was their world like? Raw fields alone are not enough.
2. **The file never leaves the visitor's computer.** Privacy is part of the promise. Any outside request must be fixed, non-personal and disclosed.
3. **Meet messy exports gracefully.** Real GEDCOMs are inconsistent. Repair what can be repaired, never guess where a guess could mislead (for example, a wrong face on an ancestor), and fall back quietly.
4. **Delight for non-experts, respect for hobbyists.** A relative should be able to explore with zero instruction. A hobbyist's data should be shown faithfully, never distorted for effect.
5. **Zero friction to start.** No accounts, no install, no build. Open a file and you're in.
