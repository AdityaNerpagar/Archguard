# Third-party notices

ArchGuard does not copy code from these projects. It installs them as npm
dependencies and uses them through their public APIs, unmodified. Their full
license texts ship inside each package in `node_modules`.

| Project | Version | License | Used for |
| --- | --- | --- | --- |
| [LikeC4](https://github.com/likec4/likec4) | 1.59.4 | MIT | Reading the architecture model |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | 16.10.4 | MIT | Finding imports in JavaScript/TypeScript code |
| [yaml](https://github.com/eemeli/yaml) | 2.9.1 | ISC | Reading docker-compose and Kubernetes files |

Optional, installed separately by the user and run as a command-line program
(not bundled or distributed with ArchGuard):

| Project | Tested version | License | Used for |
| --- | --- | --- | --- |
| [Emerge](https://github.com/glato/emerge) | 2.0.7 | MIT | `archguard actual` |

Transitive dependencies are mostly MIT, ISC, Apache-2.0 and BSD licensed.
One, `lightningcss` (pulled in by LikeC4), is MPL-2.0; it is used unmodified,
which MPL-2.0 permits without extra obligations.

To re-check before a release:

```
npx license-checker --production --summary
```
