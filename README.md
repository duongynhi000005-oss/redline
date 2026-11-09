# Redline

A fast, keyboard-first desktop app for Redmine, in the style of Linear. It
runs natively on macOS and Windows and works with any Redmine server using
your own API key: no admin rights and no plugins.

Redline is in early development, working towards its first release.

## What it does

- Lists your issues, your teams' issues and cycles (Redmine versions), grouped
  and filtered the way Linear does.
- Opens, edits and comments on issues, and creates new ones, from the keyboard
  or the command menu (Cmd+K on macOS, Ctrl+K on Windows).
- Keeps a local copy of what you can see, so lists are instant and work while
  the server is slow, and pulls changes in the background.

The goal is for everything in Redmine to have a place in Redline.
[docs/parity.md](docs/parity.md) tracks each Redmine area, what its API
allows, and where it lives in Redline.

## Supported Redmine versions

Redmine 6.1 and later, with the REST API turned on (Administration > Settings
> API). Older releases aren't supported. See
[ADR 0005](docs/adr/0005-supported-redmine-versions.md).

## Platforms

macOS and Windows 10 and 11.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to build Redline and run it against a
local Redmine, and [docs/architecture.md](docs/architecture.md) for how it
fits together.

## License

[Apache-2.0](LICENSE)
