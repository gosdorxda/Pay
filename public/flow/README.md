# Flow card art

`src/components/HowItWorksFlow.tsx` looks for three images here:

| file              | card                                        |
| ----------------- | ------------------------------------------- |
| `pumpfun.png`     | Pump.fun trading                            |
| `pay.png`         | Engine card — title is the admin brand name |
| `drand.png`       | drand beacon                                |

Drop the files in with these names — no code change needed, they are served from
`/flow/<name>.png`.

- Square art, **64px or larger** (it renders at 24px), PNG/WebP/SVG, transparent
  background preferred because it sits inside the cards' tinted badge.
- Anything else (JPG, different name) works too: either rename the file or change
  the `ART` constant at the top of `HowItWorksFlow.tsx`.
- Until a file exists the badge keeps its lucide icon (the `<img>` 404 is caught
  by `onError`), so nothing breaks while the assets are missing.
