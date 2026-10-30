# The Grants Ledger

Published static files for [The Grants Ledger](https://jcurry44.github.io/grants-ledgers/). This repository does not include the upstream data or page generators.

## Maintaining the research workflow

- Edit `hub.html`, then copy it to `index.html`; both entry points must remain identical.
- `assets/research-workflow.css` contains the compact homepage, application-check, and backup-control styles. Preserve its stylesheet link when regenerating the hub.
- `research/index.html` and `assets/research.css` contain the $350 research-brief pilot. Inquiries open an email draft; there is no checkout or payment processing.
- `db/coverage.json` supplies named-recipient counts and dollars for grant averages. Filed totals still include unitemized disclosures and redacted individual awards. An unavailable named-grant average is displayed as a dash, never estimated from the total.
- Project notes and application checks are stored in the visitor's browser. The visible project backup includes these fields. Older backups remain importable; missing checks default to unknown. There is no cloud sync.

After upstream regeneration, reapply these UI and data interpretation changes before publishing. The generated foundation pages and recovered-record pages also contain reviewed wording about recovery limits.

## Verification

Run the dependency-free regression suite with Node.js:

```sh
node --test tests/*.test.cjs
```

The tests exercise grant-average classification against the published coverage data and representative raw grant rows, project backup/import behavior, unsafe URL handling, and CSV export fields. Also verify that `hub.html` and `index.html` match.

For browser testing, serve the checkout over HTTP. Existing absolute links point to the public GitHub Pages site, so take care when following links during local verification. Check the homepage at desktop and narrow mobile widths, the nonprofit-to-shortlist flow, application checks in a research brief, and the pilot page.
