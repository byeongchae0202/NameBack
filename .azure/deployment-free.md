# NameBack Free Deployment

Deployed on 2026-11-06 to https://gentle-water-00ee82600.8.azurestaticapps.net/.

## Azure Target

- Subscription: `4ca684e9-c0a0-4c05-8a31-e9ae8aeacf4a`
- Resource group: `rg-nameback-free`
- Static Web App: `nameback-web-free`
- Region: `eastasia`
- SKU: **Free**
- Expected incremental Azure cost: **USD 0/month**

The resource group contains only `Microsoft.Web/staticSites`. No Electron EXE,
API, database, monitoring workspace, Application Insights, paid edge service or
GitHub Actions workflow was deployed. Existing resources were not modified.

## Free Limits

Checked against the [official quotas](https://learn.microsoft.com/en-us/azure/static-web-apps/quotas)
and [pricing](https://azure.microsoft.com/en-us/pricing/details/app-service/static/):

- Monthly bandwidth: 100 GB shared across this subscription's Static Web Apps.
- Free apps: 10 per subscription; this deployment brings the observed total to 3.
- Storage: 250 MB per environment; 500 MB across all environments.
- Files: 15,000 per deployment; preview environments: 3.
- Custom domains: 2; no SLA.

Remaining shared bandwidth was not measured. Exceeding Free quotas can stop
the site from being served; paid overage is unavailable on Free. Do not upgrade
the SKU or add paid resources as a fallback.

MP3 files and tags are processed inside the browser, so their bytes do not consume
server upload bandwidth. Hosting still serves application assets to visitors.

## Browser-Only Build

```powershell
node node_modules/typescript/bin/tsc -p tsconfig.renderer.json
npm test
node node_modules/vite/bin/vite.js build --outDir .build/web-free --emptyOutDir
```

The deployment contains 20 files totaling 863,714 bytes. Publish only
`.build/web-free`, not `dist`, which can contain Electron output.

The initial upload used `@azure/static-web-apps-cli@2.1.0`, a deployment token
held only in the terminal environment, `--env production`, and
`--no-use-keychain`. No deployment token was saved to this repository.

## Verification

- Renderer typecheck and all 8 existing safety tests passed.
- Production browser build passed; Vite reported a non-blocking large-chunk warning.
- Azure production environment status: `Ready`; deployed SKU: `Free`.
- Live MP3 analysis and case-insensitive filename collision handling passed.
- ZIP contained `Song.mp3` and `song (2).mp3`; original MP3 bytes were unchanged.
- No server upload requests or browser errors were observed during analysis.
- Desktop rendering checked at 1366 x 900; mobile checked at 390 x 844.
- The existing narrow-screen UI has horizontal overflow; the results table scrolls.
- The integrated browser did not expose a download event; generated ZIP bytes and
  the application's completion state were verified instead. Native save-picker
  interaction was not exercised.

## Read-Only Status Check

```powershell
az staticwebapp show --name nameback-web-free --resource-group rg-nameback-free --subscription 4ca684e9-c0a0-4c05-8a31-e9ae8aeacf4a --query "{sku:sku.name,url:defaultHostname}" -o json
az resource list --resource-group rg-nameback-free --subscription 4ca684e9-c0a0-4c05-8a31-e9ae8aeacf4a --query "[].{name:name,type:type,sku:sku.name}" -o json
```