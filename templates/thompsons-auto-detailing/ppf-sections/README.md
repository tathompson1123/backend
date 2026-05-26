# NANOPRO Liquid PPF — Wix section snippets

Each file here is **one section of the PPF page, fully self-contained** (its own fonts + CSS + JS).
They're built to drop into individual **Wix "Embed HTML"** elements so the page ports cleanly
instead of as one giant iframe.

Generated from `../liquid-ppf-v2.html` by `../_split.cjs`. If you edit the master page, re-run
`node ../_split.cjs` to regenerate these.

## Order (top → bottom of the page)

| File | Section | Notes |
|---|---|---|
| `00-header-nav.html` | Topbar + nav | **Optional** — usually better to use Wix's native header. |
| `01-hero.html` | Hero | Cinematic photo + headline + SMS button. |
| `02-what-it-is.html` | What it is | PPF chemistry / acrylic strength. |
| `03-hydrophobic.html` | Hydrophobic | Water-beading animation. |
| `04-before-after.html` | Before & After | Drag slider (has JS). |
| `05-thickness.html` | Thickness | Cross-section + rock-bounce. |
| `06-comparison.html` | NANOPRO vs PPF | Two-column compare. |
| `07-our-promise.html` | Our promise | 10-yr warranty / free fixes / seamless. |
| `08-benefits.html` | Benefits | Scannable chip strip. |
| `09-process.html` | How we apply | 4 steps. |
| `10-packages.html` | Packages | Partial front / Full front / Full body. |
| `11-faq.html` | FAQ | Accordion. |
| `12-cta.html` | CTA | Final SMS call-to-action. |
| `13-footer.html` | Footer | **Optional** — usually better to use Wix's native footer. |

## How to put it on Wix at `thompsonsautodetailing.com/ppf`

1. In the Wix **editor**, open your Liquid Paint Protection page → **Page Settings → URL slug → `ppf`**.
2. For each section, **Add → Embed Code → Embed HTML → "Code"**, paste that file's contents,
   set the element **full-width**, and drag its height to fit. Stack them in the order above.
3. Skip `00` and `13` if you're keeping Wix's native header/footer (recommended).
4. **Publish.**

## Things to do before/after publishing

- **Images are placeholders** (Unsplash). Swap the `src="https://images.unsplash.com/..."` URLs
  in `01`, `02`, `03`, `04` for your own work photos.
- **SMS button** (`sms:+13604631391...`) only does something on phones — test from your phone.
- If you keep the header/footer snippets, **repoint their links** (`liquid-ppf.html`, etc.) to your
  real Wix page URLs.
- Each embed is its own iframe, so the reveal-on-scroll fade triggers when each section loads —
  expected and fine.
