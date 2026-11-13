# Checks and GitHub Pages deployment

`.github/workflows/ci-pages.yml` runs on every push, every pull request, and a manual dispatch. It installs the committed JavaScript and Python locks, lints, type-checks, runs front-end/model tests and native pandapower tests, provisions the integrity-pinned Pyodide runtime, checks numerical parity in the Node WASM runtime, and builds the static site.

Only a successful verification job on `main` can upload and deploy the Pages artifact. Pull requests, including forks, get read-only repository permissions and cannot deploy. The deployment job has only `pages: write` and `id-token: write`; source checkout disables persisted Git credentials. No API key or other user secret is needed by CI. These job separation and permission requirements follow [GitHub's custom Pages workflow contract](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The execution environment is Ubuntu 24.04, Node.js 22.17.1 and CPython 3.13.5. The interpreter versions are fixed. The GitHub-hosted Ubuntu image itself receives GitHub updates; its exact image version is recorded in each Actions run rather than claimed to be immutable. Dependencies install from `package-lock.json` and `requirements-lock.txt`. Browser runtime files install from the versions and SHA-256 hashes in `runtime-lock.json`.

## Reference integrity and evidence

The committed `public/fixtures/case9.json`, `case14.json` and their `-reference.json` files must exist before CI starts. The workflow never regenerates them. Native tests solve reference networks directly, and the WASM proof compares against the separately committed reference values. A post-test diff guard fails if a test modifies the committed fixture directory.

JUnit native test results and runtime proof JSON are retained in the `test-evidence` artifact for seven days when available. The Pages artifact is retained for one day. This is reproducibility evidence, not an assertion that a live browser or direct provider call was exercised.

The numerical WASM step runs Pyodide under Node with package fetching disabled after local provisioning. The deployed browser proof is a separate acceptance test because CORS, worker loading and browser behavior can differ. The direct OpenAI image test requires a visitor's transient key and is intentionally not run with a CI secret. After deployment, bounded HTTP checks verify the entry point, a sample and the runtime manifest are reachable; they are availability checks, not numerical or vision proofs.

## Immutable action references

The following official tag references were resolved through GitHub's public repository API on 2026-11-13. The corresponding `action.yml` inputs and runtimes were inspected. Workflow `uses` entries contain full commit hashes, not moving tags.

| Official action | Tag checked | Pinned commit |
| --- | --- | --- |
| [actions/checkout](https://github.com/actions/checkout/blob/d23441a48e516b6c34aea4fa41551a30e30af803/action.yml) | v6 | `d23441a48e516b6c34aea4fa41551a30e30af803` |
| [actions/setup-node](https://github.com/actions/setup-node/blob/249970729cb0ef3589644e2896645e5dc5ba9c38/action.yml) | v6 | `249970729cb0ef3589644e2896645e5dc5ba9c38` |
| [actions/setup-python](https://github.com/actions/setup-python/blob/ece7cb06caefa5fff74198d8649806c4678c61a1/action.yml) | v6 | `ece7cb06caefa5fff74198d8649806c4678c61a1` |
| [actions/upload-artifact](https://github.com/actions/upload-artifact/blob/ea165f8d65b6e75b540449e92b4886f43607fa02/action.yml) | v4 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| [actions/upload-pages-artifact](https://github.com/actions/upload-pages-artifact/blob/7b1f4a764d45c48632c6b24a0339c27f5614fb0b/action.yml) | v4 | `7b1f4a764d45c48632c6b24a0339c27f5614fb0b` |
| [actions/configure-pages](https://github.com/actions/configure-pages/blob/983d7736d9b0ae728b81ab479565c72886d7745b/action.yml) | v5 | `983d7736d9b0ae728b81ab479565c72886d7745b` |
| [actions/deploy-pages](https://github.com/actions/deploy-pages/blob/d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e/action.yml) | v4 | `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e` |

The selected Pages upload composite also pins its internal upload action to the same `ea165f8...` commit. It packages `dist/` according to the official Pages artifact format. The setup/checkout actions run using the runner's Node 24 action runtime; the application's tools still run using the explicitly installed Node 22.17.1. The Pages and artifact actions use their official declared action runtimes.

## Repository settings

Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The `github-pages` environment should allow deployments from `main`. Pages enablement is performed during repository setup; the workflow does not request an administrative token or try to enable it itself.

The Vite base path is `/sld-power-flow/`; changing the repository name requires updating the base path. The deployment action returns the URL used by the environment and HTTP checks. The root application uses hash navigation, so no server rewrite is required.

New pushes to a feature branch replace pending checks for that branch. Main-branch checks/deployments are serialized without cancelling an active production deployment. A failed job stops publication and remains visible in Actions; manual dispatch can rerun the same workflow after the cause is fixed.

Local workflow syntax and expression validation passed with checksum-verified actionlint 1.7.12. Its optional shellcheck/pyflakes integrations were unavailable and disabled. A local syntax check does not establish that the hosted workflow has completed successfully; the first GitHub Actions run provides that evidence.
