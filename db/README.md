# The Grants Ledger  -  bulk dataset

What `all-grants.csv.gz` contains, column by column, and how to read the ids
inside it. This page documents the export; it is not itself a source of
data, and nothing on it is checked against a filing  -  the filing is always
the authority, and every dollar here reconciles back to one on the
foundation's own page.

The Grants Ledger is a **reconciled** record built from Form 990-PF, the
annual return every private foundation files with the IRS. "Reconciled"
means every year's rows tie to the total that foundation itself filed  - 
not that any individual transcription, recipient identity, or classification
has been independently checked against an outside source. This is not an
audit, and nothing here is a prediction. See [/methodology/](https://jcurry44.github.io/grants-ledgers/methodology/)
for how a page reconciles and [/exceptions/](https://jcurry44.github.io/grants-ledgers/exceptions/)
for every year that needed a judgment call.

## Getting the file

`db/all-grants.csv.gz`  -  gzip-compressed CSV, one row per grant across every
foundation in the collection. Decompress it with any standard tool (`gunzip`,
`7-Zip`, `pandas.read_csv(..., compression="gzip")`, Excel's Power Query,
etc.). As of this regeneration it holds **1,568,035 rows**; expect that
number to grow as the collection does.

## Columns

| # | column | example | meaning |
|---|---|---|---|
| 1 | `year` | `2024` | The foundation's tax year, as filed. |
| 2 | `foundation` | `Baird Foundation` | The foundation's display name. **Not a unique key**  -  this collection has four unrelated pairs of foundations that share a display name (a Buffalo *Baird Foundation* and a Milwaukee one, among them). Group or join on `foundation_slug` instead. |
| 3 | `foundation_slug` | `bairdfound1` | The foundation's stable, collision-free key on this site  -  the same slug that appears in its ledger page's URL (`/f/<slug>/`). Use this to group a foundation's own rows correctly. |
| 4 | `recipient_as_filed` | `3rd Street Youth Center and Clinic` | The recipient name exactly as the foundation filed it  -  including the foundation's own typos and inconsistent capitalization. A filer's error is transcribed faithfully; it is never corrected or normalized in this column. See `entity_id` below for a way to group a recipient's variant spellings together. |
| 5 | `amount` | `200000` | The dollar amount, as filed, in whole dollars. |
| 6 | `category` | `Education & youth` | This site's category for the grant's stated purpose  -  a research classification, not something the filer chose. |
| 7 | `state` | `CA` | The recipient's mailing address as filed, not the recipient's state of operation or the location of the funded work. Blank when the filer did not report a state for that row. |
| 8 | `entity_id` | `E611583546` / `Kdd213bbd29` / *(blank)* | See **Identity, in three shapes** below. |
| 9 | `record_type` | `named_recipient` / `unitemized` | See **Named recipients vs. unitemized disclosures** below. |
| 10 | `irs_object_id` | `202513199349100736` / `pdf:611583546_202012` | See **Citations: `irs_object_id`** below. |

## Identity, in three shapes

An entity's id survives every regeneration, so a bucket file or a shared
`#org=` link never rots. Three shapes appear in `entity_id`, in roughly this
proportion across the current collection:

- **`E` + EIN** (995,714 rows)  -  the recipient has been matched, by tier-B
  identity resolution, to its own IRS Employer Identification Number. The
  strongest identity this collection assigns.
- **`K` + a 10-character hash of the canonicalized name** (538,371 rows)  - 
  no EIN match was made; the id is derived from the recipient's own name as
  filed, so two foundations naming the identical string resolve to the same
  bucket even without an EIN.
- **blank** (33,950 rows)  -  the row names no cross-foundation entity at all.
  This is two different things, both blank for the same reason (nothing to
  index):
  - a grant to a **named individual**  -  a scholarship, a loan, hardship aid  - 
    where `recipient_as_filed` reads
    `[INDIVIDUAL RECIPIENT - WITHHELD FROM INDEX]`. The row is public record
    and its dollar, year, category and state all count exactly as any other
    row; only the person's actual name is withheld from this bulk file, the
    search index, and any cross-foundation profile. See
    [/about/](https://jcurry44.github.io/grants-ledgers/about/) for why.
  - a row whose `record_type` is `unitemized` (below)  -  `recipient_as_filed`
    here is not a masked name, it is the disclosure line itself
    (`STATEMENT D`, `Eligible Patients (See Schedule #2)`, and similar), kept
    in full.

## Named recipients vs. unitemized disclosures

Most filers list every grant by recipient. Some filers, for some rows, file
a lump-sum or reference line instead of a name  -  `STATEMENT D`,
`GRANTS TO VARIOUS ORGANIZATIONS`, `INDIVIDUAL PATIENT PROGRAMS` and similar.
`record_type` marks the difference:

- **`named_recipient`** (1,567,009 rows)  -  an actual recipient name, indexed
  and searchable in the usual way.
- **`unitemized`** (1,026 rows, $62,617,475,644 as of this regeneration)  - 
  no recipient is named on this row. The dollar amount stays in the
  foundation's filed total (a year still reconciles to the dollar with these
  rows included), but the row **is not a searchable entity**: it never
  appears in `db/e/`, the search index, or as a clickable profile anywhere
  on the site, and it is excluded from every named-recipient breakdown
  (categories, states, the cross-foundation "weave"). Treat an `unitemized`
  row as a dollar figure and a citation, not as an organization.

## Citations: `irs_object_id`

Every row carries a citation to the specific filing it was read from. The
column holds one of three forms:

- an **18-digit TEOS object id** (e.g. `202513199349100736`)  -  the id the
  IRS's own Tax Exempt Organization Search assigns to the e-filed return.
  Paste it into `https://apps.irs.gov/pub/epostcard/990/<id>` or the
  ProPublica Nonprofit Explorer to pull the original filing.
- a **scan-reference key** (`pdf:<ein>_<period>` or `char500:<id>`)  -  this
  row was recovered from a foundation's paper attachment, not an e-filed
  schedule. The IRS did not assign this filing an object id in the
  e-file system; the key cites the scanned filing itself
  (`data/raw/` + the recovery evidence file for that foundation). A book's
  ledger page and its Grants-tab mini-note say plainly, per year, which case
  applies  -  see
  [/recovered/](https://jcurry44.github.io/grants-ledgers/recovered/).
- rarely, a **free-text citation** carried over from an early recovery pass
  (one foundation, `364193183_2023 990PF (IRS scan)`)  -  functionally the
  same as a scan-reference key, just not yet in the standard `pdf:`/`char500:`
  shape.

This column is never blank: a row with no readable object id or scan
reference is not published rather than shipped with a guess.

## A defused first character

A `recipient_as_filed` value that begins with `=`, `+`, `-`, `@`, a tab, or a
carriage return is written here with a single leading apostrophe
(`'-Beverly Female Charitable Society`)  -  a spreadsheet app that
autodetects the cell as a formula will render it safely instead. The
apostrophe is not part of the as-filed name; strip it if you need the exact
filed string, or work from `db/fnd/<slug>.json` / `db/e/<bucket>.json`,
which are not written by a spreadsheet-facing csv writer and carry the name
undefused. Where the hub's Excel (.xlsx) download is offered in place of a
CSV, the cell is written with its literal value and no apostrophe  -  a
spreadsheet's own typed cells aren't vulnerable to formula autodetection the
way a CSV opened by one is.

## What is not in this file

- **Dollar figures for a single foundation's own page** are more precisely
  presented on that foundation's own ledger (`/f/<slug>/`), including its
  per-year Methodology reconciliation and, for the small number of books
  whose filed grants schedule does not equal Part I line 25(d), the note
  explaining which line this ledger reconciles to. This file carries every
  row at face value; it does not carry that per-book narrative.
- **A foundation's home state** (where it is based, not where it gave) is
  not a column here  -  it lives in the hub's registry (`db/registry.json`,
  `fleet[].st`) and is out of scope for a grants-level export.
- **Prices, valuations, or any forward-looking figure.** This is a
  historical record of what was filed, never a prediction.
