# Releasing Redline

Releases are built by [the Release workflow](../.github/workflows/release.yml)
when a version tag is pushed. It makes a draft GitHub release with:

- **macOS:** a universal `.dmg` (Apple silicon and Intel)
- **Windows:** an `.msi` and a setup `.exe`

A maintainer reviews the draft and publishes it.

## Cutting a release

1. Set the new version in `package.json` (the app and installers read it from
   there) and merge that change to `main`.
2. Tag the merge commit and push the tag:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. Wait for both installer jobs, then open the draft release on GitHub, write
   the notes and publish it.

Every 0.x release, and any tag with a hyphen like `v1.1.0-beta.1`, is marked
as a pre-release. The draft's notes already explain how to open an unsigned
build; take that part out once Redline is signed. To
rebuild an existing tag, run the workflow by hand from the Actions tab and
give it the tag.

You can also release without pushing a tag: run the Release workflow by hand
on `main`, give it the version tag (it must match `package.json`), and tick
**publish**. It creates the tag, builds both installers and publishes the
release once they're attached.

## Signing

Without signing, macOS Gatekeeper and Windows SmartScreen warn people when
they open Redline. Signing turns on by itself once these repository secrets
exist; nothing in the workflow needs to change.

### macOS

Needs an Apple Developer Program membership.

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | A "Developer ID Application" certificate exported as `.p12`, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | The password you gave the `.p12` export |
| `APPLE_SIGNING_IDENTITY` | The certificate's name, like `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | The Apple ID used to notarize |
| `APPLE_PASSWORD` | An app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | The 10-character team ID |

The first three sign the app. The last three also notarize it, which macOS
needs before it opens a downloaded app without a warning.

### Windows

Needs a code-signing certificate from a certificate authority.

| Secret | What it is |
| --- | --- |
| `WINDOWS_CERTIFICATE` | The certificate as a `.pfx`, base64-encoded |
| `WINDOWS_CERTIFICATE_PASSWORD` | The `.pfx` password |

Certificates that live in a hardware token or a cloud service (such as Azure
Trusted Signing) can't be exported as a `.pfx`; those need a custom
`bundle.windows.signCommand` instead. Open an issue if you need that.

To base64-encode a file for a secret:

```sh
base64 -i certificate.p12 | pbcopy        # macOS
[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Clipboard  # PowerShell
```
