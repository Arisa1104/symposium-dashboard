# Symposium Editorial Suite

Unified editorial workbench for the **College Music Symposium** journal publishing and production team.

All tools execute 100% client-side in the browser with no backend server required.

## Tools Included

1. **Table Formatter**
   - Direct Word (.docx) table extractor and paste cleaner.
   - Interactive cell grid editor: add rows/columns, merge/split cells, inline editing.
   - Outputs clean Joomla/CMS table markup and standalone stylesheet.

2. **Article Formatter**
   - Direct OOXML `.docx` manuscript converter to Joomla-ready HTML.
   - Parses headings (H2/H3), numbered lists, blockquotes, and pullquotes.
   - In-line footnote tooltips (`<span class="tooltip-cms">`) and linked endnote list.
   - Automatic APA & Chicago/bibliography reference styling.

3. **Reference Formatter**
   - Parses pasted references or bibliography lists.
   - Extracts DOIs (with clean hyperlinking) and splits authors, publication years, titles, and journal volume/issue/page citations into hanging-indent items.

4. **Editorial Board Formatter**
   - Cleans raw text copied from the CMS website.
   - Strips term years (`(2022-2025)`) and role specialties.
   - Sorts board members alphabetically by last name in `"First Last, University"` or HTML list format.

5. **Italic Highlighter**
   - Scans `.docx` files, identifies all italicized text runs in body text, tables, and footnotes, and applies yellow highlights for proofreading.
   - Generates a downloadable updated `.docx`.

## Development & Build

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build
```

## Deployment on Vercel

This repository is ready for automatic deployment on [Vercel](https://vercel.com):

1. Go to [vercel.com/new](https://vercel.com/new).
2. Import **`Arisa1104/symposium-dashboard`**.
3. Keep default settings (Framework Preset: **Vite**, Build Command: `npm run build`, Output Directory: `dist`).
4. Click **Deploy**.
