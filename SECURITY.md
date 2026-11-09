# Security policy

Redline stores people's Redmine API keys and shows their private project
data, so we take security reports seriously.

## Supported versions

Redline is pre-1.0. Only the latest release gets security fixes.

| Version        | Supported |
| -------------- | --------- |
| Latest release | Yes       |
| Older releases | No        |

## Reporting a vulnerability

**Please don't report security problems in public issues, discussions or
pull requests.**

Report them privately through GitHub:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the problem, how to reproduce it, which Redline and Redmine
   versions you used, and what an attacker could do with it.

Please don't include real API keys or another person's data in the report.

## What to expect

- We'll acknowledge your report within 5 working days.
- We'll keep you updated as we investigate and agree a disclosure date with
  you, normally once a fixed release is out.
- With your permission, we'll credit you in the release notes.

## In scope

- Leaking or mishandling a Redmine API key, username or custom header value
  (storage, logs, crash reports, network requests to anyone other than the
  configured Redmine server)
- Script injection through Redmine content (issue text, comments, custom
  fields, attachments' names) reaching the app's web view
- Tauri command or permission misuse that lets web content reach the file
  system, shell or other native capabilities
- Insecure update or installer behaviour

Problems in Redmine itself should go to the
[Redmine project](https://www.redmine.org/projects/redmine/wiki/Security_Advisories).
